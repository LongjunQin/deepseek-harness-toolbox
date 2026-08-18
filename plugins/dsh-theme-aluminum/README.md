# dsh-theme-aluminum

DeepSeek Harness 常驻皮肤插件:"铝合金工作台"拟物风(B2 定稿)。
工具感、收敛、信息优先——浅色金属外壳,内容永远是界面上对比度最高的东西。

## 效果

- 侧栏:淡亚麻金属 + 钢蓝渐变选中行(白字);
- 输入卡:金属面板 + 水晶玻璃蓝发送钮 + 金属胶囊(可按的立体、纯信息的平);
- 会话区:浅灰底 + 高对比正文,用户气泡浅蓝渐变;
- 全局:Lucida Grande 字族、浅色滚动条、菜单/弹层同步浅色。

## 实现(lib/client.js,纯浏览器半边)

- **①主题变量层**:`html, html * { --dsw-*: … !important }` 整套覆盖官方 ~70 个
  别名变量与全部字族变量——不管原值定义在哪层、当前是深是浅,一律接管;
- **②材质层**:按 CSS Modules 类名可读后缀挂材质(`_quietBars` 侧栏、
  `_newSession` 按钮、`_sessionRow`+`_selected` 会话行、`_card:has(textarea)`
  输入卡、`_trigger`/`_add`/`_primary` 按钮、`_bubble` 气泡、`_fade` 渐隐条)。

官方改版若某处失效,通常只是类名后缀变了——截图对照,改对应选择器即可。

## 开关

启用:profile 补丁加 `- id: theme-aluminum / name: dsh-theme-aluminum`,重启。
停用:删该行重启,界面回到官方原样(插件不改任何持久数据)。
皮肤会同时接管深色模式(设计即浅色金属);想用官方深色就停用本插件。
