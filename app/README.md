# DeepSeek Harness.app — macOS 原生壳

> 非官方项目 / Unofficial community project.

把官方 `dsh web`(终端命令+浏览器标签页)变成一个真正的 Mac 应用:

- **双击启动**:自动探测 `dsh`/`npm`/`node` 位置(PATH、Homebrew、`~/.local/bin`、
  登录 shell 兜底,覆盖 nvm 等安装方式),找不到时给出安装指引;
- **每次启动自动更新**:对比 npm 仓库最新版,有新版自动 `npm install -g`
  (查询 6 秒超时,离线时静默跳过,绝不卡启动;更新失败继续用旧版);
- **托管服务生命周期**:端口已有服务则复用;否则以干净环境启动 `dsh web`
  (剥除代理环境变量、标准 PATH),退出/关窗时干净关闭自己启动的服务;
- **原生窗口**:系统 WebKit 内嵌界面,外部链接自动交给默认浏览器,
  Cmd+R 刷新、Cmd+Q 退出;产物仅几 MB,无任何第三方依赖。

- **一体化分发**:四个插件随 App 打包,首次启动自动装配进 `~/.dsh`
  (幂等,检测到用户手工配置过同名插件则不接管);
- **首次配置引导**:缺 API Key 时弹出配置窗(密钥只写本机
  `~/.dsh/.credentials.yaml`),并自动探测本机 codex CLI——有则接入官方
  Codex 子代理(图片理解/生成),没有则优雅降级,日后装了重启即自动接入;

A native shell that turns `dsh web` into a real Mac app: double-click launch,
auto-update of the official npm package on every start, clean server lifecycle
management, and a system-WebKit window. A few MB, zero dependencies.

## 构建 Build

需要 Xcode(swiftc)。Requires Xcode.

```sh
./build.sh                            # 产物生成在 app-src/.build/(隐藏目录,避免被启动台重复索引)
cp -R "./.build/DeepSeek Harness.app" /Applications/
```

## 可配置 Configuration

```sh
# 换端口(默认 3080)
defaults write local.longjunqin.deepseek-harness port 8080
# 手动指定 dsh 路径(自动探测失败时)
defaults write local.longjunqin.deepseek-harness dshPath /path/to/dsh
```

日志:`~/Library/Logs/DeepSeekHarness.log`(更新、启动、退出全过程 + dsh 输出)。
