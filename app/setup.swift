// 一体化首次配置:把随 App 打包的插件装配进用户的 dsh profile,
// 并在缺少 API Key 时引导用户完成配置。所有写入都幂等,可反复运行。
import Cocoa

enum Setup {
  // MARK: 路径

  static var dshHome: URL {
    if let override = ProcessInfo.processInfo.environment["DSH_HOME"], !override.isEmpty {
      return URL(fileURLWithPath: override)
    }
    return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".dsh")
  }
  static var profileDir: URL { dshHome.appendingPathComponent("profiles/web") }
  static var pluginsDir: URL { dshHome.appendingPathComponent("plugins") }
  static var credentialsFile: URL { dshHome.appendingPathComponent(".credentials.yaml") }
  static var patchFile: URL { profileDir.appendingPathComponent("cordis.patch.yml") }
  static var nodeModules: URL { profileDir.appendingPathComponent("node_modules") }

  /// App 包内随附的插件目录
  static var bundledPlugins: URL? {
    guard let res = Bundle.main.resourceURL?.appendingPathComponent("plugins"),
          FileManager.default.fileExists(atPath: res.path) else { return nil }
    return res
  }

  static let corePlugins = ["dsh-cost-display", "dsh-annotate", "dsh-image-relay", "dsh-theme-aluminum"]

  // MARK: API Key

  /// 已配置 = 凭据文件里有非空值,或环境变量里有
  static func hasApiKey() -> Bool {
    if let env = ProcessInfo.processInfo.environment["DEEPSEEK_API_KEY"], !env.isEmpty { return true }
    guard let text = try? String(contentsOf: credentialsFile, encoding: .utf8) else { return false }
    for line in text.split(separator: "\n") {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      guard trimmed.hasPrefix("DEEPSEEK_API_KEY:") else { continue }
      let value = trimmed.dropFirst("DEEPSEEK_API_KEY:".count)
        .trimmingCharacters(in: CharacterSet(charactersIn: " \"'"))
      if !value.isEmpty { return true }
    }
    return false
  }

  /// 写入 API Key:保留文件里的其他条目,只更新这一项
  static func writeApiKey(_ key: String) throws {
    let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    try FileManager.default.createDirectory(at: dshHome, withIntermediateDirectories: true)
    var lines: [String] = []
    if let text = try? String(contentsOf: credentialsFile, encoding: .utf8) {
      lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        .filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("DEEPSEEK_API_KEY:") }
    }
    lines.append("DEEPSEEK_API_KEY: \"\(trimmed)\"")
    let body = lines.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.joined(separator: "\n") + "\n"
    try body.write(to: credentialsFile, atomically: true, encoding: .utf8)
    try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: credentialsFile.path)
  }

  // MARK: profile 与插件装配

  /// 用 --dump-config 触发官方的 profile 初始化(不启动服务)
  static func ensureProfile(dsh: String, environment: [String: String]) {
    if FileManager.default.fileExists(atPath: patchFile.path) { return }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: dsh)
    p.arguments = ["--profile", "web", "--dump-config"]
    p.environment = environment
    p.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser
    p.standardOutput = FileHandle.nullDevice
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return }
    let deadline = Date().addingTimeInterval(60)
    while p.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.2) }
    if p.isRunning { p.terminate() }
  }

  /// 把包内插件同步到 ~/.dsh/plugins/,登记为 profile 依赖,并建符号链接
  static func syncPlugins() -> [String] {
    guard let source = bundledPlugins else { return [] }
    let fm = FileManager.default
    var installed: [String] = []
    try? fm.createDirectory(at: pluginsDir, withIntermediateDirectories: true)
    for name in corePlugins {
      let from = source.appendingPathComponent(name)
      guard fm.fileExists(atPath: from.path) else { continue }
      let to = pluginsDir.appendingPathComponent(name)
      // 版本不同才覆盖(用户手改过的副本也会被 App 内版本覆盖,以 App 为准)
      if bundleVersion(of: from) != bundleVersion(of: to) {
        try? fm.removeItem(at: to)
        try? fm.copyItem(at: from, to: to)
      }
      if fm.fileExists(atPath: to.path) { installed.append(name) }
    }
    registerDependencies(installed)
    linkPlugins(installed)
    return installed
  }

  /// 登记为 profile 的 file: 依赖——否则任何一次 npm/pnpm install 都会把
  /// 我们的符号链接当作"多余包"清掉(实测踩过)
  static func registerDependencies(_ plugins: [String]) {
    let manifest = profileDir.appendingPathComponent("package.json")
    guard let data = FileManager.default.contents(atPath: manifest.path),
          var obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
    var deps = obj["dependencies"] as? [String: Any] ?? [:]
    var changed = false
    for name in plugins {
      // 已有任何形式的依赖声明(开发者的 link:、用户自己的版本)一律不动
      guard deps[name] == nil else { continue }
      deps[name] = "file:" + pluginsDir.appendingPathComponent(name).path
      changed = true
    }
    guard changed else { return }
    obj["dependencies"] = deps
    if let out = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]) {
      try? out.write(to: manifest)
    }
  }

  /// (重)建 node_modules 里指向插件的符号链接;npm 跑完后要再调一次
  static func linkPlugins(_ plugins: [String]) {
    let fm = FileManager.default
    try? fm.createDirectory(at: nodeModules, withIntermediateDirectories: true)
    for name in plugins {
      let target = pluginsDir.appendingPathComponent(name)
      guard fm.fileExists(atPath: target.path) else { continue }
      let link = nodeModules.appendingPathComponent(name)
      if let current = try? fm.destinationOfSymbolicLink(atPath: link.path) {
        // 已有链接:只接管指向本 App 快照目录的;开发者/包管理器建的链接不动
        if current == target.path || !current.hasPrefix(pluginsDir.path) { continue }
      } else if fm.fileExists(atPath: link.path) {
        continue // 实体目录(包管理器安装),不动
      }
      try? fm.removeItem(at: link)
      try? fm.createSymbolicLink(atPath: link.path, withDestinationPath: target.path)
    }
  }

  static func bundleVersion(of dir: URL) -> String? {
    guard let data = fm_contents(dir.appendingPathComponent("package.json")),
          let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
    return obj["version"] as? String
  }

  static func fm_contents(_ url: URL) -> Data? { FileManager.default.contents(atPath: url.path) }

  // MARK: Codex

  static func codexPath() -> String? {
    let fm = FileManager.default
    var dirs = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init)
    let home = NSHomeDirectory()
    dirs += ["/usr/local/bin", "/opt/homebrew/bin", home + "/.local/bin"]
    for dir in dirs where !dir.isEmpty {
      let candidate = dir + "/codex"
      if fm.isExecutableFile(atPath: candidate) { return candidate }
    }
    return nil
  }

  /// Codex 子代理是否已装配到 profile(官方包 + 其 peer 依赖)
  static func codexBridgeReady() -> Bool {
    FileManager.default.fileExists(
      atPath: nodeModules.appendingPathComponent("@deepseek-ai/dsh-subagent-codex").path)
      && FileManager.default.fileExists(
        atPath: nodeModules.appendingPathComponent("@deepseek-ai/dsh-sdk-protocol").path)
  }

  /// 装配官方 Codex 子代理:npm 取两个包,其余 peer 依赖软链到 dsh 安装目录(避免重复实例)
  static func installCodexBridge(npm: String, dshLibDir: URL, environment: [String: String],
                                 log: (String) -> Void) -> Bool {
    let fm = FileManager.default
    let p = Process()
    p.executableURL = URL(fileURLWithPath: npm)
    p.arguments = ["install", "--prefix", profileDir.path, "--no-audit", "--no-fund",
                   "@deepseek-ai/dsh-subagent-codex", "@deepseek-ai/dsh-sdk-protocol"]
    p.environment = environment
    p.standardOutput = FileHandle.nullDevice
    p.standardError = FileHandle.nullDevice
    let manifest = profileDir.appendingPathComponent("package.json")
    let before = fm.contents(atPath: manifest.path)
    do { try p.run() } catch { log("codex 桥接:npm 启动失败 \(error)"); return false }
    let deadline = Date().addingTimeInterval(300)
    while p.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.5) }
    if p.isRunning { p.terminate(); log("codex 桥接:npm 超时"); return false }
    guard p.terminationStatus == 0 else { log("codex 桥接:npm 退出码 \(p.terminationStatus)"); return false }

    // npm 可能规范化 package.json;确保 profile 清单里的 dsh 字段还在
    if let before, let after = fm.contents(atPath: manifest.path),
       let beforeObj = (try? JSONSerialization.jsonObject(with: before)) as? [String: Any],
       var afterObj = (try? JSONSerialization.jsonObject(with: after)) as? [String: Any],
       afterObj["dsh"] == nil, let dsh = beforeObj["dsh"] {
      afterObj["dsh"] = dsh
      if let data = try? JSONSerialization.data(withJSONObject: afterObj, options: [.prettyPrinted, .sortedKeys]) {
        try? data.write(to: manifest)
        log("codex 桥接:已恢复 profile 清单的 dsh 字段")
      }
    }

    // peer 依赖软链到 dsh 自带的同名包
    let scoped = nodeModules.appendingPathComponent("@deepseek-ai")
    try? fm.createDirectory(at: scoped, withIntermediateDirectories: true)
    let peers = ["dsh-invariants", "dsh-session", "dsh-llm", "dsh-subagent",
                 "dsh-subprocess", "dsh-timeout", "cordis"]
    for peer in peers {
      let target = dshLibDir.appendingPathComponent(peer)
      guard fm.fileExists(atPath: target.path) else { continue }
      let link = scoped.appendingPathComponent(peer)
      let current = try? fm.destinationOfSymbolicLink(atPath: link.path)
      if current != target.path {
        try? fm.removeItem(at: link)
        try? fm.createSymbolicLink(atPath: link.path, withDestinationPath: target.path)
      }
    }
    return codexBridgeReady()
  }

  // MARK: 组合配置(cordis.patch.yml)

  static let blockStart = "# >>> DeepSeek Harness.app 自动配置(删除本块并重启即可恢复官方默认) >>>"
  static let blockEnd = "# <<< DeepSeek Harness.app 自动配置 <<<"

  /// 幂等写入插件行:只替换自己的标记块,用户在块外的内容原样保留。
  /// 若用户在块外手工配置过同名插件,返回 false 并且什么都不写——宁可不接管,
  /// 也不制造重复的插件行(重复 id 会让整棵插件树加载失败)。
  @discardableResult
  static func writeComposition(plugins: [String], withCodex: Bool, log: (String) -> Void = { _ in }) -> Bool {
    var rows: [String] = []
    if plugins.contains("dsh-cost-display") {
      rows += ["    # 会话花费与账户余额", "    - id: cost-display", "      name: dsh-cost-display"]
    }
    if plugins.contains("dsh-annotate") {
      rows += ["    # 选中回复文字批注,攒批发送", "    - id: annotate", "      name: dsh-annotate"]
    }
    if withCodex {
      rows += ["    # Codex 子代理:图片理解与生成", "    - id: subagent-codex",
               "      name: '@deepseek-ai/dsh-subagent-codex'",
               "    - id: tool-subagent-codex", "      name: '@deepseek-ai/dsh-tool-subagent'",
               "      config:", "        provider: codex", "        toolName: subagent_codex",
               "        enableRunInBackground: false", "        maxDepth: provider-managed"]
    }
    if plugins.contains("dsh-image-relay") {
      rows += ["    # 图片中继:粘贴图片可用、生图指引、对话内预览", "    - id: image-relay",
               "      name: dsh-image-relay"]
    }
    if plugins.contains("dsh-theme-aluminum") {
      rows += ["    # 铝合金拟物皮肤", "    - id: theme-aluminum", "      name: dsh-theme-aluminum"]
    }
    guard !rows.isEmpty else { return false }

    var kept: [String] = []
    if let text = try? String(contentsOf: patchFile, encoding: .utf8) {
      var inBlock = false
      for line in text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init) {
        if line.contains(blockStart) { inBlock = true; continue }
        if line.contains(blockEnd) { inBlock = false; continue }
        if !inBlock { kept.append(line) }
      }
    }
    // 去掉初始模板里的空数组占位,避免与 insert 列表并存
    kept = kept.filter { $0.trimmingCharacters(in: .whitespaces) != "[]" }
    while let last = kept.last, last.trimmingCharacters(in: .whitespaces).isEmpty { kept.removeLast() }

    // 块外已手工配置过任一同名插件 → 用户自己在管,App 不接管
    let outside = kept.joined(separator: "\n")
    for marker in ["dsh-cost-display", "dsh-annotate", "dsh-image-relay",
                   "dsh-theme-aluminum", "dsh-subagent-codex"] {
      if outside.contains(marker) {
        log("组合配置:检测到手工配置的 \(marker),保持现状不写入")
        return false
      }
    }

    let block = ([blockStart, "- insert:"] + rows + [blockEnd]).joined(separator: "\n")
    let body = (kept.isEmpty ? block : kept.joined(separator: "\n") + "\n\n" + block) + "\n"
    try? body.write(to: patchFile, atomically: true, encoding: .utf8)
    return true
  }
}

// MARK: - 首次配置窗口

final class SetupWindowController: NSObject, NSTextFieldDelegate {
  private var window: NSWindow!
  private var keyField: NSSecureTextField!
  private var hint: NSTextField!
  private var saveButton: NSButton!
  private var onFinish: (() -> Void)?

  /// 展示配置窗口;完成或跳过后回调
  func present(codexFound: Bool, onFinish: @escaping () -> Void) {
    self.onFinish = onFinish
    let rect = NSRect(x: 0, y: 0, width: 520, height: 372)
    window = NSWindow(contentRect: rect, styleMask: [.titled, .closable], backing: .buffered, defer: false)
    window.title = "DeepSeek Harness · 首次配置"
    window.center()
    window.isReleasedWhenClosed = false

    let content = NSView(frame: rect)
    var y = rect.height - 56.0

    func label(_ text: String, size: CGFloat, bold: Bool, color: NSColor, height: CGFloat) -> NSTextField {
      let field = NSTextField(wrappingLabelWithString: text)
      field.font = bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size)
      field.textColor = color
      field.frame = NSRect(x: 28, y: y - height, width: rect.width - 56, height: height)
      field.isEditable = false
      field.isBezeled = false
      field.drawsBackground = false
      content.addSubview(field)
      y -= height + 10
      return field
    }

    _ = label("欢迎使用 DeepSeek Harness", size: 19, bold: true, color: .labelColor, height: 26)
    _ = label("开始之前需要一个 DeepSeek API Key。密钥只保存在本机 ~/.dsh/.credentials.yaml,不会上传到任何地方。",
              size: 12, bold: false, color: .secondaryLabelColor, height: 34)

    keyField = NSSecureTextField(frame: NSRect(x: 28, y: y - 26, width: rect.width - 56, height: 26))
    keyField.placeholderString = "sk-…"
    keyField.delegate = self
    content.addSubview(keyField)
    y -= 36

    let getKey = NSButton(title: "没有密钥?到 DeepSeek 开放平台申请 →", target: self, action: #selector(openPlatform))
    getKey.bezelStyle = .inline
    getKey.isBordered = false
    getKey.contentTintColor = .linkColor
    getKey.font = NSFont.systemFont(ofSize: 12)
    getKey.frame = NSRect(x: 24, y: y - 20, width: 320, height: 20)
    content.addSubview(getKey)
    y -= 34

    let line = NSBox(frame: NSRect(x: 28, y: y, width: rect.width - 56, height: 1))
    line.boxType = .separator
    content.addSubview(line)
    y -= 18

    _ = label(codexFound ? "✓ 已检测到 Codex" : "· 未检测到 Codex(可选)", size: 13, bold: true,
              color: codexFound ? .systemGreen : .secondaryLabelColor, height: 20)
    _ = label(codexFound
              ? "图片理解与图片生成将自动交给本机 Codex 完成,无需额外设置。"
              : "不装也能用:图片可以照常粘贴与预览,由模型自行分析。日后安装并登录 codex 命令行工具后,重新打开本应用即会自动接入。",
              size: 12, bold: false, color: .secondaryLabelColor, height: 46)

    hint = label("", size: 12, bold: false, color: .systemRed, height: 18)

    saveButton = NSButton(title: "保存并开始", target: self, action: #selector(save))
    saveButton.bezelStyle = .rounded
    saveButton.keyEquivalent = "\r"
    saveButton.frame = NSRect(x: rect.width - 148, y: 20, width: 120, height: 32)
    content.addSubview(saveButton)

    let skip = NSButton(title: "稍后设置", target: self, action: #selector(skip))
    skip.bezelStyle = .rounded
    skip.frame = NSRect(x: rect.width - 262, y: 20, width: 104, height: 32)
    content.addSubview(skip)

    window.contentView = content
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(keyField)
    NSApp.activate(ignoringOtherApps: true)
  }

  @objc private func openPlatform() {
    if let url = URL(string: "https://platform.deepseek.com/api_keys") { NSWorkspace.shared.open(url) }
  }

  @objc private func save() {
    let key = keyField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !key.isEmpty else { hint.stringValue = "请填入 API Key,或选择「稍后设置」。"; return }
    do {
      try Setup.writeApiKey(key)
      finish()
    } catch {
      hint.stringValue = "写入失败:\(error.localizedDescription)"
    }
  }

  @objc private func skip() {
    finish()
  }

  private func finish() {
    window.orderOut(nil)
    let callback = onFinish
    onFinish = nil
    callback?()
  }
}
