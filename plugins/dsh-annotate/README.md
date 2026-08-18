# dsh-annotate

> 非官方插件 / Unofficial plugin.

像 Codex 那样批注 AI 的回复:选中文字 → 就地写批注 → 攒一批 → 一键发送。

Codex-style annotations for assistant replies: select text, annotate in place,
collect a batch, send them all at once.

## 用法 Usage

1. 在 AI 回复里选中任意文字,选区旁浮出"✎ 加入批注";
2. 点击后就地写批注(可留空=只圈原文;回车确认,Esc 取消);
3. 输入框上方出现批注篮:`✎ N 条批注 · 查看 · 清空 · 发送批注`,
   展开可逐条编辑(点批注文字或 ✎)、删除,可补一句"总体要求";
4. "发送批注"把全部条目组装成一条结构化消息(原文引用+批注逐条列出)发出,
   AI 生成中会自动排队。

批注存页面内存、按会话隔离,刷新页面即清空——适合"看完一轮批完就发"。

## 安装 Install

```sh
cd ~/.dsh/profiles/web
corepack pnpm add link:/path/to/deepseek-harness-toolbox/plugins/dsh-annotate
```

`cordis.patch.yml`:

```yaml
- insert:
    - id: annotate
      name: dsh-annotate
```

重启 `dsh web`。Restart `dsh web`.

## 实现要点 Notes

- 纯浏览器半边:选区浮层是命令式 DOM,批注篮挂 `conversation.input.dock`
  官方插槽,发送经 `conversation.sendSession`(queue 模式);
- 选区过滤按 CSS Modules 类名可读后缀匹配(聊天滚动区内、排除输入区/侧栏),
  官方改版若使浮出按钮消失,改 `selectionAllowed()` 里的选择器即可;
- 原文以「引用」形式定位,不在消息里插入高亮标记(官方前端的 DOM 不宜外改)。
