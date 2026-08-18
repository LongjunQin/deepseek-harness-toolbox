// DeepSeek Harness 原生壳 App
// 职责:启动时检查并自动更新官方 npm 包 → 启动/复用本地 dsh web 服务 → 原生窗口内嵌界面 → 退出时干净关闭服务
// 通用化:dsh/npm/node 路径自动探测(PATH、Homebrew、~/.local、登录 shell 兜底),
// 可用 defaults 覆盖:`defaults write local.longjunqin.deepseek-harness port 8080`、
// `defaults write local.longjunqin.deepseek-harness dshPath /path/to/dsh`
import Cocoa
import WebKit

let kPort: Int = {
  let v = UserDefaults.standard.integer(forKey: "port")
  return v > 0 ? v : 3080
}()
let kURL = URL(string: "http://127.0.0.1:\(kPort)/")!
let kRegistryLatest = URL(string: "https://registry.npmjs.org/@deepseek-ai/dsh/latest")!

final class Logger {
  static let shared = Logger()
  private let handle: FileHandle?
  private let df = ISO8601DateFormatter()
  init() {
    let file = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/Logs/DeepSeekHarness.log")
    if !FileManager.default.fileExists(atPath: file.path) {
      FileManager.default.createFile(atPath: file.path, contents: nil)
    }
    handle = try? FileHandle(forWritingTo: file)
    handle?.seekToEndOfFile()
  }
  var fileHandle: FileHandle? { handle }
  func write(_ s: String) {
    if let d = "[\(df.string(from: Date()))] \(s)\n".data(using: .utf8) { handle?.write(d) }
  }
}
func log(_ s: String) { Logger.shared.write(s) }

// MARK: - 工具路径探测

/// defaults 覆盖 → 当前 PATH → 常见安装目录 → 登录 shell(覆盖 nvm 等只改 shell 配置的安装)
func findExecutable(_ name: String) -> String? {
  let fm = FileManager.default
  if let override = UserDefaults.standard.string(forKey: name + "Path"),
     fm.isExecutableFile(atPath: override) {
    return override
  }
  var dirs: [String] = []
  if let path = ProcessInfo.processInfo.environment["PATH"] {
    dirs += path.split(separator: ":").map(String.init)
  }
  let home = NSHomeDirectory()
  dirs += ["/usr/local/bin", "/opt/homebrew/bin",
           home + "/.local/bin", home + "/.npm-global/bin",
           "/usr/bin", "/bin"]
  for dir in dirs {
    let candidate = dir + "/" + name
    if fm.isExecutableFile(atPath: candidate) { return candidate }
  }
  let probe = Process()
  probe.executableURL = URL(fileURLWithPath: "/bin/zsh")
  probe.arguments = ["-lc", "source ~/.zshrc >/dev/null 2>&1; command -v \(name)"]
  let pipe = Pipe()
  probe.standardOutput = pipe
  probe.standardError = FileHandle.nullDevice
  do { try probe.run() } catch { return nil }
  let deadline = Date().addingTimeInterval(5)
  while probe.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
  if probe.isRunning { probe.terminate(); return nil }
  guard probe.terminationStatus == 0,
        let data = try? pipe.fileHandleForReading.readToEnd(),
        let out = String(data: data, encoding: .utf8) else { return nil }
  let candidate = out.trimmingCharacters(in: .whitespacesAndNewlines)
  return fm.isExecutableFile(atPath: candidate) ? candidate : nil
}

// MARK: - 版本工具

func installedVersion(pkgJSON: String) -> String? {
  guard let data = FileManager.default.contents(atPath: pkgJSON),
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  else { return nil }
  return obj["version"] as? String
}

func fetchLatestVersion(timeout: TimeInterval) -> String? {
  var result: String?
  let sem = DispatchSemaphore(value: 0)
  let req = URLRequest(url: kRegistryLatest, timeoutInterval: timeout)
  URLSession.shared.dataTask(with: req) { data, _, _ in
    if let data, let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
      result = obj["version"] as? String
    }
    sem.signal()
  }.resume()
  _ = sem.wait(timeout: .now() + timeout + 1)
  return result
}

func semverParts(_ s: String) -> (release: [Int], pre: [Int]?) {
  let halves = s.split(separator: "-", maxSplits: 1)
  func nums(_ str: Substring) -> [Int] {
    str.split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }
  }
  return (nums(halves[0]), halves.count > 1 ? nums(halves[1]) : nil)
}

func isNewer(_ a: String, than b: String) -> Bool {
  let pa = semverParts(a), pb = semverParts(b)
  if pa.release != pb.release {
    for (x, y) in zip(pa.release, pb.release) where x != y { return x > y }
    return pa.release.count > pb.release.count
  }
  switch (pa.pre, pb.pre) {
  case (nil, nil): return false
  case (nil, _): return true // 正式版 > 同号预发布版
  case (_, nil): return false
  case (let x?, let y?):
    for (i, j) in zip(x, y) where i != j { return i > j }
    return x.count > y.count
  }
}

// MARK: - 服务探测

func portIsOpen(timeout: TimeInterval = 1.0) -> Bool {
  var ok = false
  let sem = DispatchSemaphore(value: 0)
  let req = URLRequest(url: kURL, timeoutInterval: timeout)
  URLSession.shared.dataTask(with: req) { _, resp, _ in
    ok = (resp as? HTTPURLResponse) != nil
    sem.signal()
  }.resume()
  _ = sem.wait(timeout: .now() + timeout + 0.5)
  return ok
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
  var window: NSWindow!
  var webView: WKWebView!
  var statusField: NSTextField!
  var spinner: NSProgressIndicator!
  var serverProcess: Process?
  var dshPath: String?
  var npmPath: String?
  var nodePath: String?

  func applicationDidFinishLaunching(_ notification: Notification) {
    buildMenu()
    buildWindow()
    DispatchQueue.global(qos: .userInitiated).async { self.boot() }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func setStatus(_ s: String) {
    log(s)
    DispatchQueue.main.async { self.statusField.stringValue = s }
  }

  // MARK: 启动流程(后台线程)

  func boot() {
    setStatus("正在定位 dsh…")
    dshPath = findExecutable("dsh")
    npmPath = findExecutable("npm")
    nodePath = findExecutable("node")
    guard let dsh = dshPath else {
      setStatus("未找到 dsh 命令。请先安装官方 DeepSeek Harness:\nnpm install -g @deepseek-ai/dsh\n(装好后重新打开本应用;也可用 defaults write local.longjunqin.deepseek-harness dshPath <路径> 指定)")
      return
    }
    log("dsh: \(dsh)  npm: \(npmPath ?? "未找到")  node: \(nodePath ?? "未找到")  端口: \(kPort)")

    if let npm = npmPath, let pkgJSON = globalPackageJSON(npm: npm),
       let cur = installedVersion(pkgJSON: pkgJSON) {
      setStatus("正在检查更新(当前 \(cur))…")
      if let latest = fetchLatestVersion(timeout: 6) {
        if isNewer(latest, than: cur) {
          setStatus("正在更新 \(cur) → \(latest)…")
          if npmInstall(npm: npm, version: latest) {
            setStatus("已更新到 \(latest)")
          } else {
            setStatus("更新失败,继续使用 \(cur)")
            Thread.sleep(forTimeInterval: 1.5)
          }
        } else {
          log("已是最新版:\(cur)(仓库最新 \(latest))")
        }
      } else {
        log("版本检查超时或失败,跳过")
      }
    } else {
      log("未找到 npm 或全局包信息,跳过更新检查")
    }

    if portIsOpen() {
      log("端口 \(kPort) 已有服务,直接复用(退出时不关闭它)")
    } else {
      setStatus("正在启动本地服务…")
      startServer(dsh: dsh)
      guard serverProcess != nil else { return }
      var waited = 0.0
      while waited < 90 {
        if portIsOpen(timeout: 0.8) { break }
        if let p = serverProcess, !p.isRunning {
          setStatus("服务进程意外退出(状态 \(p.terminationStatus))。日志:~/Library/Logs/DeepSeekHarness.log")
          return
        }
        Thread.sleep(forTimeInterval: 0.25)
        waited += 0.25
      }
      guard portIsOpen() else {
        setStatus("等待服务就绪超时。日志:~/Library/Logs/DeepSeekHarness.log")
        return
      }
    }

    DispatchQueue.main.async {
      self.spinner.stopAnimation(nil)
      self.spinner.isHidden = true
      self.statusField.isHidden = true
      self.webView.isHidden = false
      self.webView.load(URLRequest(url: kURL))
    }
  }

  /// 全局安装的 @deepseek-ai/dsh 的 package.json 路径(经 npm root -g)
  func globalPackageJSON(npm: String) -> String? {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: npm)
    p.arguments = ["root", "-g"]
    p.environment = childEnvironment()
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return nil }
    let deadline = Date().addingTimeInterval(15)
    while p.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.2) }
    if p.isRunning { p.terminate(); return nil }
    guard p.terminationStatus == 0,
          let data = try? pipe.fileHandleForReading.readToEnd(),
          let out = String(data: data, encoding: .utf8) else { return nil }
    let root = out.trimmingCharacters(in: .whitespacesAndNewlines)
    let candidate = root + "/@deepseek-ai/dsh/package.json"
    return FileManager.default.fileExists(atPath: candidate) ? candidate : nil
  }

  func npmInstall(npm: String, version: String) -> Bool {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: npm)
    p.arguments = ["install", "-g", "@deepseek-ai/dsh@\(version)"]
    p.environment = childEnvironment()
    if let h = Logger.shared.fileHandle { p.standardOutput = h; p.standardError = h }
    do { try p.run() } catch { log("npm 启动失败:\(error)"); return false }
    let deadline = Date().addingTimeInterval(240)
    while p.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.5) }
    if p.isRunning { p.terminate(); log("npm install 超时,已中断"); return false }
    return p.terminationStatus == 0
  }

  func startServer(dsh: String) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: dsh)
    p.arguments = kPort == 3080 ? ["web"] : ["web", "--port", String(kPort)]
    p.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser
    p.environment = childEnvironment()
    if let h = Logger.shared.fileHandle { p.standardOutput = h; p.standardError = h }
    do {
      try p.run()
      serverProcess = p
      log("已启动 dsh web,pid \(p.processIdentifier)")
    } catch {
      setStatus("无法启动 dsh:\(error.localizedDescription)")
    }
  }

  /// 子进程环境:标准 PATH + 探测到的工具目录;剥掉代理变量(避免终端里
  /// 面向特定用途的代理环境毒化本地服务联网)
  func childEnvironment() -> [String: String] {
    var env = ProcessInfo.processInfo.environment
    var dirs = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
    for tool in [dshPath, npmPath, nodePath] {
      if let tool { dirs.insert((tool as NSString).deletingLastPathComponent, at: 0) }
    }
    var seen = Set<String>()
    env["PATH"] = dirs.filter { seen.insert($0).inserted }.joined(separator: ":")
    for k in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"] {
      env.removeValue(forKey: k)
    }
    return env
  }

  func applicationWillTerminate(_ notification: Notification) {
    guard let p = serverProcess, p.isRunning else { return }
    log("退出:关闭 dsh,pid \(p.processIdentifier)")
    p.terminate()
    let deadline = Date().addingTimeInterval(3)
    while p.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
    if p.isRunning { kill(p.processIdentifier, SIGKILL) }
  }

  // MARK: 窗口

  func buildWindow() {
    let rect = NSRect(x: 0, y: 0, width: 1280, height: 840)
    window = NSWindow(contentRect: rect,
                      styleMask: [.titled, .closable, .miniaturizable, .resizable],
                      backing: .buffered, defer: false)
    window.title = "DeepSeek Harness"
    window.minSize = NSSize(width: 760, height: 520)
    window.center()
    window.setFrameAutosaveName("DeepSeekHarnessMainWindow")

    let content = NSView(frame: rect)

    let cfg = WKWebViewConfiguration()
    cfg.websiteDataStore = .default()
    cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
    webView = WKWebView(frame: content.bounds, configuration: cfg)
    webView.autoresizingMask = [.width, .height]
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.isHidden = true
    content.addSubview(webView)

    spinner = NSProgressIndicator()
    spinner.style = .spinning
    spinner.translatesAutoresizingMaskIntoConstraints = false
    spinner.startAnimation(nil)
    content.addSubview(spinner)

    statusField = NSTextField(labelWithString: "正在启动…")
    statusField.alignment = .center
    statusField.font = NSFont.systemFont(ofSize: 14)
    statusField.textColor = .secondaryLabelColor
    statusField.lineBreakMode = .byWordWrapping
    statusField.maximumNumberOfLines = 6
    statusField.translatesAutoresizingMaskIntoConstraints = false
    content.addSubview(statusField)

    NSLayoutConstraint.activate([
      spinner.centerXAnchor.constraint(equalTo: content.centerXAnchor),
      spinner.centerYAnchor.constraint(equalTo: content.centerYAnchor, constant: -24),
      statusField.centerXAnchor.constraint(equalTo: content.centerXAnchor),
      statusField.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 14),
      statusField.leadingAnchor.constraint(greaterThanOrEqualTo: content.leadingAnchor, constant: 24),
      statusField.trailingAnchor.constraint(lessThanOrEqualTo: content.trailingAnchor, constant: -24),
    ])

    window.contentView = content
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  // MARK: 链接策略:本地地址留在窗口内,外部链接交给默认浏览器

  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if let url = navigationAction.request.url, let host = url.host,
       host != "127.0.0.1", host != "localhost" {
      NSWorkspace.shared.open(url)
      decisionHandler(.cancel)
      return
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = navigationAction.request.url {
      if let host = url.host, host == "127.0.0.1" || host == "localhost" {
        webView.load(navigationAction.request)
      } else {
        NSWorkspace.shared.open(url)
      }
    }
    return nil
  }

  // MARK: 菜单

  func buildMenu() {
    let main = NSMenu()

    let appItem = NSMenuItem()
    main.addItem(appItem)
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "关于 DeepSeek Harness",
                    action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "隐藏", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(withTitle: "退出 DeepSeek Harness",
                    action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu

    let editItem = NSMenuItem()
    main.addItem(editItem)
    let edit = NSMenu(title: "编辑")
    edit.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
    edit.addItem(.separator())
    edit.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit

    let viewItem = NSMenuItem()
    main.addItem(viewItem)
    let view = NSMenu(title: "显示")
    let reload = NSMenuItem(title: "刷新", action: #selector(reloadPage), keyEquivalent: "r")
    reload.target = self
    view.addItem(reload)
    let inBrowser = NSMenuItem(title: "在浏览器中打开", action: #selector(openInBrowser), keyEquivalent: "")
    inBrowser.target = self
    view.addItem(inBrowser)
    viewItem.submenu = view

    let winItem = NSMenuItem()
    main.addItem(winItem)
    let win = NSMenu(title: "窗口")
    win.addItem(withTitle: "最小化", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
    win.addItem(withTitle: "缩放", action: #selector(NSWindow.zoom(_:)), keyEquivalent: "")
    winItem.submenu = win

    NSApp.mainMenu = main
  }

  @objc func reloadPage() { webView.reload() }
  @objc func openInBrowser() { NSWorkspace.shared.open(kURL) }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
