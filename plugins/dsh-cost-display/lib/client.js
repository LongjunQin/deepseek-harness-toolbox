// dsh-cost-display 浏览器半边:在输入框左侧插槽挂一个"本会话花费 · 余额"胶囊,
// 点击展开明细面板。花费 = tokenUsage 投影(官方精确计量) × 价目表,属估算;余额以官方接口为准。
window.__ModuleLoader__.load({
	id: "dsh-cost-display",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");
		const h = React.createElement;

		/** 北京时间高峰时段:9:00-12:00、14:00-18:00 */
		function isPeakNow() {
			const beijingHour = (new Date().getUTCHours() + 8) % 24;
			return (beijingHour >= 9 && beijingHour < 12) || (beijingHour >= 14 && beijingHour < 18);
		}

		function fmtMoney(v) {
			if (!(v > 0)) return "¥0";
			if (v < 0.01) return "¥" + v.toFixed(4);
			if (v < 1) return "¥" + v.toFixed(3);
			return "¥" + v.toFixed(2);
		}

		function fmtTokens(n) {
			if (!(n > 0)) return "0";
			if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
			if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
			return String(n);
		}

		/** usage 桶 × 价目表 → {hit, miss, out, total};peak 布尔选时段 */
		function costOf(usage, price, peak) {
			const hitTokens = usage.cacheReadTokens || 0;
			const missTokens = (usage.uncachedInputTokens || 0) + (usage.cacheWriteTokens || 0);
			const outTokens = usage.outputTokens || 0;
			const hit = hitTokens * (peak ? price.hitPeak : price.hitOff) / 1e6;
			const miss = missTokens * (peak ? price.missPeak : price.missOff) / 1e6;
			const out = outTokens * (peak ? price.outPeak : price.outOff) / 1e6;
			return { hitTokens, missTokens, outTokens, hit, miss, out, total: hit + miss + out };
		}

		const pillStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: "4px",
			border: "none",
			background: "none",
			borderRadius: "6px",
			padding: "2px 6px",
			fontSize: "12px",
			lineHeight: "20px",
			color: "var(--dsw-alias-label-tertiary)",
			cursor: "pointer",
			whiteSpace: "nowrap",
		};
		const panelStyle = {
			position: "absolute",
			bottom: "calc(100% + 8px)",
			left: "0",
			zIndex: 30,
			minWidth: "260px",
			background: "var(--dsw-alias-bg-base)",
			border: "1px solid var(--dsw-alias-border-l1)",
			borderRadius: "10px",
			boxShadow: "0 8px 24px rgba(0,0,0,.18)",
			padding: "12px 14px",
			fontSize: "12px",
			lineHeight: "20px",
			color: "var(--dsw-alias-label-primary)",
		};
		const rowStyle = { display: "flex", justifyContent: "space-between", gap: "16px" };
		const dimStyle = { color: "var(--dsw-alias-label-tertiary)" };
		const hrStyle = { border: "none", borderTop: "1px solid var(--dsw-alias-border-l1)", margin: "8px 0" };

		function row(label, value, key) {
			return h("div", { style: rowStyle, key },
				h("span", { style: dimStyle }, label),
				h("span", null, value));
		}

		function CostWidget(props) {
			const useProjection = props.useProjection;
			const usage = useProjection !== undefined ? useProjection("tokenUsage") : undefined;
			const [summary, setSummary] = React.useState(null);
			const [open, setOpen] = React.useState(false);
			const boxRef = React.useRef(null);

			React.useEffect(() => {
				let alive = true;
				const load = () => {
					fetch("/dsh-cost/summary")
						.then((r) => r.json())
						.then((d) => { if (alive) setSummary(d); })
						.catch(() => {});
				};
				load();
				const iv = window.setInterval(load, 5 * 60 * 1000);
				return () => { alive = false; window.clearInterval(iv); };
			}, []);

			React.useEffect(() => {
				if (!open) return;
				const onDown = (e) => {
					if (boxRef.current !== null && !boxRef.current.contains(e.target)) setOpen(false);
				};
				window.addEventListener("mousedown", onDown);
				return () => window.removeEventListener("mousedown", onDown);
			}, [open]);

			const prices = summary !== null ? summary.prices : null;
			const model = summary !== null ? summary.defaultModel : "deepseek-v4-flash";
			const price = prices !== null ? prices[model] : null;
			const peak = isPeakNow();
			const u = usage !== undefined ? usage : {};
			const cost = price !== null ? costOf(u, price, peak) : null;
			const costPeak = price !== null ? costOf(u, price, true) : null;
			const costOff = price !== null ? costOf(u, price, false) : null;
			const balance = summary !== null && summary.balance !== null && summary.balance !== undefined
				? summary.balance : null;

			const pillParts = [];
			if (cost !== null) pillParts.push("≈" + fmtMoney(cost.total));
			if (balance !== null) pillParts.push("余 ¥" + balance.total);
			if (pillParts.length === 0) return null;

			const saved = cost !== null
				? cost.hitTokens * ((peak ? price.missPeak : price.missOff) - (peak ? price.hitPeak : price.hitOff)) / 1e6
				: 0;

			return h("div", { ref: boxRef, style: { position: "relative", display: "inline-flex" } },
				h("button", {
					type: "button",
					style: pillStyle,
					title: "本会话花费(估算)与账户余额,点击看明细",
					onClick: () => setOpen((v) => !v),
				}, pillParts.join(" · ")),
				open ? h("div", { style: panelStyle },
					h("div", { style: { fontWeight: 600, marginBottom: "6px" } }, "本会话花费(估算)"),
					row("输入·缓存命中", fmtTokens(cost.hitTokens) + " tok · " + fmtMoney(cost.hit), "hit"),
					row("输入·缓存未命中", fmtTokens(cost.missTokens) + " tok · " + fmtMoney(cost.miss), "miss"),
					row("输出", fmtTokens(cost.outTokens) + " tok · " + fmtMoney(cost.out), "out"),
					h("hr", { style: hrStyle }),
					row("合计(当前" + (peak ? "高峰" : "空闲") + "价)", fmtMoney(cost.total), "total"),
					row("按高峰价／空闲价", fmtMoney(costPeak.total) + " ／ " + fmtMoney(costOff.total), "range"),
					saved > 0.0001 ? row("缓存为你省下", fmtMoney(saved), "saved") : null,
					h("hr", { style: hrStyle }),
					balance !== null
						? row("账户余额", "¥" + balance.total, "bal")
						: row("账户余额", summary !== null && summary.error !== undefined ? "获取失败" : "加载中…", "bal"),
					h("div", { style: { marginTop: "8px", fontSize: "11px", color: "var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary))" } },
						"按 " + model + " 价目估算,以官方账单为准")
				) : null
			);
		}

		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;
			slots.inject("conversation.input.left", () => slots.register(
				{ name: "conversation.input.left", id: "cost-display", order: 90 },
				CostWidget,
			));
		}

		exports.apply = apply;
		return module.exports;
	},
});
