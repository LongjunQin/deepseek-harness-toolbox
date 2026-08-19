// dsh-theme-aluminum 浏览器半边:注入"铝合金工作台"皮肤(B2 定稿)。
// 两层:①主题变量整套覆盖(html,html* + !important 压过任意定义位置,深浅色均接管);
// ②材质层——按 CSS Modules 可读后缀挂金属渐变/凹槽/玻璃按钮。官方改版若某处失效,
// 通常只是类名后缀变了,对着改选择器即可。
window.__ModuleLoader__.load({
	id: "dsh-theme-aluminum",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const FONT = "'Lucida Grande', 'Helvetica Neue', 'PingFang SC', 'Hiragino Sans GB', sans-serif";
		const FONT_TOKENS = [
			"--dsw-font-family",
			"--dsw-font-base-16-font-family", "--dsw-font-base-strong-16-font-family",
			"--dsw-font-l-20-font-family", "--dsw-font-m-18-font-family",
			"--dsw-font-s-14-font-family", "--dsw-font-s-strong-14-font-family",
			"--dsw-font-xl-24-font-family",
			"--dsw-font-xs-13-font-family", "--dsw-font-xs-strong-13-font-family",
			"--dsw-font-xxs-12-font-family", "--dsw-font-xxs-strong-12-font-family",
			"--dsw-font-xxxs-11-font-family", "--dsw-font-xxxs-strong-11-font-family",
			"--dsw-font-markdown-base-font-family", "--dsw-font-markdown-base-italic-font-family",
			"--dsw-font-markdown-base-strong-font-family", "--dsw-font-markdown-base-strong-italic-font-family",
			"--dsw-font-markdown-small-font-family", "--dsw-font-markdown-small-italic-font-family",
			"--dsw-font-markdown-small-strong-font-family", "--dsw-font-markdown-small-strong-italic-font-family",
			"--dsw-font-markdown-h1-font-family", "--dsw-font-markdown-h2-font-family",
			"--dsw-font-markdown-h3-font-family", "--dsw-font-markdown-h4-font-family",
			"--dsw-font-markdown-table-font-family", "--dsw-font-markdown-table-head-font-family",
		];

		const TOKENS = {
			"--dsw-alias-bg-base": "#fbfbfc",
			"--dsw-alias-bg-layer-1": "#f2f2f4",
			"--dsw-alias-bg-layer-2": "#ececee",
			"--dsw-alias-bg-layer-3": "#e4e4e6",
			"--dsw-alias-bg-overlay": "#fdfdfe",
			"--dsw-alias-bg-skeleton": "#e8e8ea",
			"--dsw-alias-bg-mask-drop": "#e4e6ea",
			"--dsw-alias-bg-mask-photo": "rgba(40,44,50,.4)",
			"--dsw-alias-bg-mask-1": "rgba(40,44,50,.35)",
			"--dsw-alias-bg-mask-2": "rgba(40,44,50,.45)",
			"--dsw-alias-bg-mask-3": "rgba(40,44,50,.55)",
			"--dsw-alias-border-l1": "#cdd1d7",
			"--dsw-alias-border-l2": "#b9bec5",
			"--dsw-alias-border-l3": "#a5aab2",
			"--dsw-alias-border-l4": "#90959d",
			"--dsw-alias-label-primary": "#202429",
			"--dsw-alias-label-primary-dimmed": "#3a3f46",
			"--dsw-alias-label-primary-bluish": "#24282e",
			"--dsw-alias-label-secondary": "#454a51",
			"--dsw-alias-label-tertiary": "#6a7077",
			"--dsw-alias-label-caption": "#82878e",
			"--dsw-alias-label-dimmed": "#9aa0a8",
			"--dsw-alias-label-primary-inverted": "#ffffff",
			"--dsw-alias-brand-primary": "#2b2f35",
			"--dsw-alias-state-business-primary": "#3a3f46",
			"--dsw-alias-button-primary-fill": "#2f3339",
			"--dsw-alias-button-primary-hover": "#22262b",
			"--dsw-alias-interactive-bg-hover": "rgba(30,40,55,.07)",
			"--dsw-alias-interactive-bg-hover-solid": "#e6e8eb",
			"--dsw-alias-interactive-bg-active": "rgba(30,40,55,.12)",
			"--dsw-alias-markdown-code-block": "#eef1f4",
			"--dsw-alias-markdown-inline-code": "#eef1f4",
			"--dsw-alias-markdown-code-block-banner": "#e4e7eb",
			"--dsw-alias-specific-tip": "#f2f4f6",
			"--dsw-alias-scrollbar-bg-l1": "#c4c8ce",
			"--dsw-alias-scrollbar-bg-l2": "#c4c8ce",
			"--dsw-alias-scrollbar-hover-l1": "#a9aeb5",
			"--dsw-alias-scrollbar-hover-l2": "#a9aeb5",
			"--dsw-alias-button-tool-bar-fill": "#eceef1",
			"--dsw-alias-button-tool-bar-fill-invisible": "transparent",
			"--dsw-alias-button-tool-bar-hover": "#dfe2e6",
			"--dsw-alias-button-contrast-fill": "#3a3f46",
			"--dsw-alias-button-elevated-fill": "#fdfdfe",
			"--dsw-alias-button-floating-fill": "#fdfdfe",
			"--dsw-alias-button-floating-hover": "#eef0f3",
			"--dsw-alias-button-ghost-active-border": "#a9adb3",
			"--dsw-alias-button-ghost-active-fill": "#e6e8eb",
			"--dsw-alias-button-ghost-active-hover": "#dfe2e6",
			"--dsw-alias-button-info-fill": "#2f3339",
			"--dsw-alias-button-info-hover": "#22262b",
			"--dsw-alias-bg-module-platform": "#e8eaed",
			"--dsw-alias-bg-multi-select": "#e2e4e8",
			"--dsw-alias-border-inverted": "#3a3f46",
			"--dsw-alias-border-inverted2": "#55595f",
			"--dsw-alias-brand-text": "#202429",
			"--dsw-alias-label-primary-foreground": "#ffffff",
		};

		const tokenLines = Object.entries(TOKENS).map(([k, v]) => `  ${k}: ${v} !important;`)
			.concat(FONT_TOKENS.map((k) => `  ${k}: ${FONT} !important;`)).join("\n");

		const CSS = `
/* ── ① 主题变量接管 ─────────────────────────────────────── */
html, html * {
${tokenLines}
}
html, body { background: #f0f0f2 !important; color-scheme: light !important; }

/* ── ② 材质层 ──────────────────────────────────────────── */
/* 侧栏:淡亚麻金属 */
[class*="_quietBars"] {
  background: linear-gradient(#eef0f2, #e4e6ea) !important;
  border-right: 1px solid #ababaf !important;
  box-shadow: inset -1px 0 0 rgba(255,255,255,.7) !important;
}
/* 新会话按钮:金属凸起(排除内部 Label 子元素,避免双层描边) */
[class*="_newSession"]:not([class*="Label"]) {
  background: linear-gradient(#fdfdfe, #e6e9ed 55%, #d8dce1) !important;
  border: 1px solid #969ba2 !important;
  border-radius: 7px !important;
  box-shadow: inset 0 1px 0 #fff, 0 1px 2px rgba(0,0,0,.18) !important;
  color: #33383f !important;
  text-shadow: 0 1px 0 rgba(255,255,255,.85);
}
/* 会话行 */
[class*="_sessionRow"] { border-radius: 6px !important; }
[class*="_sessionRow"]:hover { background: rgba(30,40,55,.07) !important; }
[class*="_sessionRow"][class*="_selected"] {
  background: linear-gradient(#d0d3d8, #c4c8ce) !important;
  border: 1px solid #adb1b8 !important;
  box-shadow: inset 0 1px 3px rgba(30,35,42,.20), inset 0 -1px 0 rgba(255,255,255,.55) !important;
}
[class*="_sessionRow"][class*="_selected"] * {
  color: #1e2226 !important; text-shadow: 0 1px 0 rgba(255,255,255,.45);
}
/* 会话区 */
[class*="_scrollBody"] { background: #f7f7f8 !important; }
/* 用户气泡:浅蓝渐变 */
[class*="_bubble"] {
  background: linear-gradient(#f4f5f7, #e6e8ec) !important;
  border: 1px solid #c2c6cc !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 1px 3px rgba(30,35,45,.12) !important;
  color: #22262b !important;
}
/* 输入卡:金属面板 */
[class*="_card"]:has(textarea) {
  background: linear-gradient(#fdfdfd, #eeeeef 60%, #e2e2e4) !important;
  border: 1px solid #a0a0a4 !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.95), 0 2px 5px rgba(0,0,0,.16) !important;
}
/* 输入框:保持透明,由金属卡自身承托(强改布局会和原结构打架) */
[class*="_card"]:has(textarea) textarea[class*="_input"] {
  background: transparent !important;
}
/* 底栏胶囊(访问模式/模型):金属凸起 */
button[class*="_trigger"] {
  background: linear-gradient(#fcfcfd, #e6e8eb) !important;
  border: 1px solid #a9adb3 !important;
  border-radius: 999px !important;
  box-shadow: inset 0 1px 0 #fff !important;
}
button[class*="_trigger"]:hover { background: linear-gradient(#ffffff, #eceef1) !important; }
/* 发送按钮:水晶玻璃蓝 */
[class*="_card"]:has(textarea) button[class*="_primary"] {
  background: radial-gradient(circle at 50% 122%, rgba(210,220,235,.42) 10%, transparent 48%), linear-gradient(#5c626b, #2c3036 52%, #1b1e22) !important;
  border: 1px solid #14171a !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.28), 0 2px 5px rgba(0,0,0,.38) !important;
  position: relative; overflow: hidden;
}
[class*="_card"]:has(textarea) button[class*="_primary"]::before {
  content: ""; position: absolute; left: 7%; right: 7%; top: 5%; height: 45%; border-radius: 999px;
  background: linear-gradient(rgba(255,255,255,.34), rgba(255,255,255,.03)); pointer-events: none;
}
/* 加号按钮:金属圆钮(原为深色对比钮) */
[class*="_card"]:has(textarea) button[class*="_add"] {
  background: linear-gradient(#fcfcfd, #e6e8eb) !important;
  border: 1px solid #a9adb3 !important;
  box-shadow: inset 0 1px 0 #fff !important;
  color: #454a51 !important;
}
[class*="_card"]:has(textarea) button[class*="_add"]:hover { background: linear-gradient(#ffffff, #eceef1) !important; }
/* 侧栏列表的滚动渐隐遮罩:原为黑色,浅色皮肤下改为与侧栏同色 */
[class*="_quietBars"] [class*="_fade"] {
  background: linear-gradient(rgba(228,230,234,0), #e4e6ea) !important;
}
/* 顶部标签行:轻金属 */
[class*="_tabs"] { text-shadow: 0 1px 0 rgba(255,255,255,.7); }
/* 侧栏分区标签 */
[class*="_sectionLabel"] { letter-spacing: 1.2px !important; color: #82878e !important; text-shadow: 0 1px 0 rgba(255,255,255,.9); }
`;

		function apply(ctx) {
			ctx.effect(() => {
				const tag = document.createElement("style");
				tag.id = "dsh-theme-aluminum";
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return () => tag.remove();
			});
		}

		exports.apply = apply;
		return module.exports;
	},
});
