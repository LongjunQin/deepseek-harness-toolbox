# dsh-cost-display

> 非官方插件 / Unofficial plugin.

在聊天输入框旁显示 `≈¥花费 · 余 ¥余额` 胶囊,点击展开明细:输入(缓存命中/未命中)、
输出各多少 token 与钱,高峰/空闲两档合计,缓存节省,账户余额。

Shows a `≈¥cost · balance` pill next to the composer; click for a breakdown
(cached/uncached input, output, peak/off-peak totals, cache savings, balance).

## 数据来源 Data sources

- **花费**:官方 `tokenUsage` 会话投影(DeepSeek 服务端回报的精确 token 数,
  四桶分账)× 价目表。价目表按 2026-08 官方价写在 `lib/index.js` 顶部
  (v4-flash / v4-pro,高峰=北京 9-12/14-18),官方调价后改那几个数字即可。
  属估算,以官方账单为准。
- **余额**:宿主半边注册 `GET /dsh-cost/summary`,用 `ctx.credentials` 解析
  `DEEPSEEK_API_KEY` 调官方 `/user/balance`(60 秒缓存);浏览器每 5 分钟刷新。
  密钥不出本机。

## 安装 Install

```sh
cd ~/.dsh/profiles/web
corepack pnpm add link:/path/to/deepseek-harness-toolbox/plugins/dsh-cost-display
```

`cordis.patch.yml`:

```yaml
- insert:
    - id: cost-display
      name: dsh-cost-display
```

重启 `dsh web`。Restart `dsh web`.

## 实现要点 Notes

- 宿主半边:`ctx.webServer.register` 精确路由 + `ctx.credentials`;
- 浏览器半边:手写 `window.__ModuleLoader__.load` 工厂,组件经标准 props
  `useProjection("tokenUsage")` 读官方计量,挂 `conversation.input.left` 插槽,
  样式全用官方主题变量(深浅色自动跟随);
- 官方改版若导致胶囊消失,通常只是插槽改名,改 `lib/client.js` 里的插槽名即可。
