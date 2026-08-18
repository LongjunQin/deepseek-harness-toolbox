// dsh-image-relay 浏览器半边:接管 read_image 的工具卡——直接渲染图片缩略图,
// 点击放大(灯箱),并提供 在工作区查看 / 用系统应用打开 / 在访达中显示 三个按钮。
window.__ModuleLoader__.load({
	id: "dsh-image-relay",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");
		const h = React.createElement;

		/** 深度受限地在工具块里找图片附件引用({attachmentId,...}),跳过 React 元素 */
		function findAttachment(node, depth) {
			if (depth > 7 || node === null || typeof node !== "object") return null;
			if (node.$$typeof !== undefined) return null;
			if (typeof node.attachmentId === "string") return node;
			if (Array.isArray(node)) {
				for (const item of node) {
					const hit = findAttachment(item, depth + 1);
					if (hit !== null) return hit;
				}
				return null;
			}
			for (const key of Object.keys(node)) {
				const hit = findAttachment(node[key], depth + 1);
				if (hit !== null) return hit;
			}
			return null;
		}

		function argsPath(block) {
			const raw = block === null || block === undefined ? ""
				: ("kind" in block ? (block.call !== undefined && block.call !== null ? block.call.argsRaw : undefined) : block.argsRaw) ?? "";
			try {
				const parsed = JSON.parse(raw);
				if (typeof parsed.file_path === "string") return parsed.file_path;
				if (typeof parsed.path === "string") return parsed.path;
			} catch {}
			return undefined;
		}

		const rowStyle = {
			display: "flex", alignItems: "center", gap: "6px",
			fontSize: "14px", lineHeight: "24px", color: "var(--dsw-alias-label-secondary)",
		};
		const dimStyle = { color: "var(--dsw-alias-label-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 };
		const btnStyle = {
			border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)",
			color: "var(--dsw-alias-label-secondary)", cursor: "pointer", borderRadius: "999px",
			padding: "2px 10px", fontSize: "11px", lineHeight: "16px",
		};

		function CardButtons(props) {
			const path = props.path;
			const post = (reveal) => {
				fetch("/dsh-image-relay/open", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ path, reveal }),
				}).catch(() => {});
			};
			return h("div", { style: { display: "flex", gap: "8px", margin: "6px 0 2px 4px" } },
				props.openFile !== undefined && path !== undefined
					? h("button", { type: "button", style: btnStyle, onClick: () => props.openFile(path) }, "在工作区查看") : null,
				path !== undefined
					? h("button", { type: "button", style: btnStyle, onClick: () => post(false) }, "用系统应用打开") : null,
				path !== undefined
					? h("button", { type: "button", style: btnStyle, onClick: () => post(true) }, "在访达中显示") : null);
		}

		function ReadImageCard(props) {
			const block = props.block;
			const [zoom, setZoom] = React.useState(false);
			const path = argsPath(block);
			const att = React.useMemo(() => findAttachment(block, 0), [block]);
			const title = h("div", { style: rowStyle },
				h("span", null, "🖼"),
				h("span", null, "图片预览"),
				path !== undefined ? h("span", { style: dimStyle }, path) : null);
			if (att === null) {
				return h("div", { style: { margin: "2px 0 2px 4px" } }, title,
					h("div", { style: { ...dimStyle, fontSize: "12px", marginLeft: "24px" } }, "(读取中或无图片结果)"));
			}
			const src = "/dsh-image-relay/file?" + new URLSearchParams({
				id: att.attachmentId,
				mt: att.mediaType ?? "image/png",
				b: String(att.bytes ?? ""),
				w: String(att.width ?? ""),
				h: String(att.height ?? ""),
				...att.name !== undefined ? { n: att.name } : {},
			}).toString();
			return h("div", { style: { margin: "2px 0 4px 4px" } },
				title,
				h("img", {
					src,
					alt: path ?? "image",
					title: "点击放大",
					onClick: () => setZoom(true),
					style: { display: "block", maxWidth: "380px", maxHeight: "300px", borderRadius: "10px", border: "1px solid var(--dsw-alias-border-l1)", cursor: "zoom-in", margin: "6px 0 0 4px" },
				}),
				h(CardButtons, { path, openFile: props.openFile }),
				zoom ? h("div", {
					onClick: () => setZoom(false),
					title: "点击关闭",
					style: { position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.78)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" },
				}, h("img", { src, style: { maxWidth: "94%", maxHeight: "94%", borderRadius: "8px" } })) : null);
		}

		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;
			slots.inject("tool.call.toolview", () => slots.register(
				{ name: "tool.call.toolview", key: "read_image" },
				ReadImageCard,
			));
		}

		exports.apply = apply;
		return module.exports;
	},
});
