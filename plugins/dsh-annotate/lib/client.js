// dsh-annotate 浏览器半边:
// 1) 在 AI 回复里选中文字 → 选区旁浮出"加入批注"按钮 → 就地写批注;
// 2) 输入框上方出现批注篮(conversation.input.dock 插槽),可查看/删除/补总体要求;
// 3) "发送批注"把全部条目组装成一条消息经 conversation.sendSession 发出(queue 模式)。
// 批注存页面内存,按会话隔离,刷新即清空。
window.__ModuleLoader__.load({
	id: "dsh-annotate",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");
		const h = React.createElement;

		function clip(s, n) {
			return s.length > n ? s.slice(0, n) + "…" : s;
		}

		// ── 批注仓库:按会话隔离,页面内存 ────────────────────────────
		const store = {
			map: new Map(),
			listeners: new Set(),
			itemsFor(sid) { return this.map.get(sid) || []; },
			add(sid, item) {
				const next = this.itemsFor(sid).slice();
				next.push(item);
				this.map.set(sid, next);
				this.emit();
			},
			remove(sid, idx) {
				const next = this.itemsFor(sid).slice();
				next.splice(idx, 1);
				if (next.length === 0) this.map.delete(sid); else this.map.set(sid, next);
				this.emit();
			},
			update(sid, idx, comment) {
				const next = this.itemsFor(sid).slice();
				if (next[idx] === undefined) return;
				next[idx] = { quote: next[idx].quote, comment };
				this.map.set(sid, next);
				this.emit();
			},
			clear(sid) { this.map.delete(sid); this.emit(); },
			emit() { for (const l of this.listeners) l(); },
			subscribe(l) { this.listeners.add(l); return () => this.listeners.delete(l); },
		};

		let ctxRef;
		let activeSessionId;

		// ── 选区浮层(命令式 DOM,避开 React 树) ─────────────────────
		const CSS = [
			'.dshA-btn{position:fixed;z-index:9999;display:flex;gap:6px;align-items:center;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:4px 10px;font-size:12px;line-height:20px;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer;user-select:none}',
			'.dshA-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshA-editor{position:fixed;z-index:9999;width:320px;box-sizing:border-box;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);font-size:12px;color:var(--dsw-alias-label-primary)}',
			'.dshA-quote{color:var(--dsw-alias-label-tertiary);max-height:42px;overflow:hidden;margin-bottom:6px;border-left:2px solid var(--dsw-alias-border-l2);padding-left:6px;line-height:20px}',
			'.dshA-ta{width:100%;box-sizing:border-box;min-height:52px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:inherit;padding:6px 8px;font-size:12px;font-family:inherit;outline:none}',
			'.dshA-ta:focus{border-color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
			'.dshA-row{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}',
			'.dshA-primary{background:var(--dsw-alias-state-business-primary,#4d6bfe);color:#fff;border:none;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:12px}',
			'.dshA-ghost{background:none;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:6px;padding:4px 12px;cursor:pointer;font-size:12px}',
		].join("\n");

		let overlayRoot = null;
		let btnEl = null;
		let editorEl = null;
		let quoteEl = null;
		let taEl = null;
		let currentQuote = "";
		let anchorRect = null;

		function ensureOverlay() {
			if (overlayRoot !== null) return;
			overlayRoot = document.createElement("div");
			overlayRoot.setAttribute("data-dsh-annotate", "");
			const style = document.createElement("style");
			style.textContent = CSS;
			overlayRoot.appendChild(style);

			btnEl = document.createElement("button");
			btnEl.type = "button";
			btnEl.className = "dshA-btn";
			btnEl.textContent = "✎ 加入批注";
			btnEl.style.display = "none";
			btnEl.addEventListener("click", openEditor);
			overlayRoot.appendChild(btnEl);

			editorEl = document.createElement("div");
			editorEl.className = "dshA-editor";
			editorEl.style.display = "none";
			quoteEl = document.createElement("div");
			quoteEl.className = "dshA-quote";
			taEl = document.createElement("textarea");
			taEl.className = "dshA-ta";
			taEl.placeholder = "写批注…(可留空,回车确认,Esc 取消)";
			taEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); confirmEditor(); }
				if (e.key === "Escape") { e.preventDefault(); hideAll(); }
			});
			const row = document.createElement("div");
			row.className = "dshA-row";
			const cancel = document.createElement("button");
			cancel.type = "button";
			cancel.className = "dshA-ghost";
			cancel.textContent = "取消";
			cancel.addEventListener("click", hideAll);
			const ok = document.createElement("button");
			ok.type = "button";
			ok.className = "dshA-primary";
			ok.textContent = "确认";
			ok.addEventListener("click", confirmEditor);
			row.appendChild(cancel);
			row.appendChild(ok);
			editorEl.appendChild(quoteEl);
			editorEl.appendChild(taEl);
			editorEl.appendChild(row);
			overlayRoot.appendChild(editorEl);

			document.body.appendChild(overlayRoot);
		}

		function place(el, rect, width) {
			const margin = 8;
			let left = rect.left + rect.width / 2 - width / 2;
			left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
			let top = rect.top - 40;
			if (top < margin) top = rect.bottom + margin;
			el.style.left = left + "px";
			el.style.top = top + "px";
		}

		function showButton(rect) {
			ensureOverlay();
			editorEl.style.display = "none";
			btnEl.style.display = "flex";
			place(btnEl, rect, 96);
			anchorRect = rect;
		}

		function openEditor() {
			ensureOverlay();
			btnEl.style.display = "none";
			quoteEl.textContent = "「" + clip(currentQuote, 120) + "」";
			taEl.value = "";
			editorEl.style.display = "block";
			const rect = anchorRect !== null ? anchorRect : { left: window.innerWidth / 2 - 160, width: 0, top: 120, bottom: 140 };
			place(editorEl, rect, 320);
			const sel = window.getSelection();
			if (sel !== null) sel.removeAllRanges();
			taEl.focus();
		}

		function confirmEditor() {
			if (activeSessionId !== undefined && currentQuote !== "") {
				store.add(activeSessionId, { quote: currentQuote, comment: taEl.value.trim() });
			}
			hideAll();
		}

		function hideAll() {
			if (overlayRoot === null) return;
			btnEl.style.display = "none";
			editorEl.style.display = "none";
		}

		function editorOpen() {
			return overlayRoot !== null && editorEl.style.display !== "none";
		}

		function selectionTarget(sel) {
			const node = sel.anchorNode;
			if (node === null) return null;
			return node.nodeType === 1 ? node : node.parentElement;
		}

		/** 选区必须落在聊天滚动区内,且不在输入区、侧栏、设置或本插件浮层里 */
		function selectionAllowed(el) {
			if (el === null) return false;
			if (el.closest("[data-dsh-annotate]") !== null) return false;
			if (el.closest('textarea, input, [contenteditable="true"]') !== null) return false;
			if (el.closest('[class*="omposer"], [class*="_input"], [class*="_sidebar"], [class*="_settings"]') !== null) return false;
			const scroller = document.querySelector('[class*="_scrollBody"]');
			if (scroller !== null && !scroller.contains(el)) return false;
			return true;
		}

		function onMouseUp(e) {
			if (e.target instanceof Element && e.target.closest("[data-dsh-annotate]") !== null) return;
			window.setTimeout(() => {
				if (editorOpen()) return;
				const sel = window.getSelection();
				if (sel === null || sel.isCollapsed || activeSessionId === undefined) { hideAll(); return; }
				const text = sel.toString().trim();
				if (text.length < 2) { hideAll(); return; }
				if (!selectionAllowed(selectionTarget(sel))) { hideAll(); return; }
				currentQuote = text;
				showButton(sel.getRangeAt(0).getBoundingClientRect());
			}, 0);
		}

		function onMouseDown(e) {
			if (overlayRoot === null) return;
			if (e.target instanceof Element && e.target.closest("[data-dsh-annotate]") !== null) return;
			hideAll();
		}

		function onScroll() {
			if (!editorOpen()) hideAll();
		}

		// ── 批注篮(React,挂 conversation.input.dock) ────────────────
		const barStyle = {
			boxSizing: "border-box",
			border: "1px solid var(--dsw-alias-border-l1)",
			background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base))",
			borderRadius: "12px",
			padding: "6px 12px",
			margin: "0 auto 6px",
			fontSize: "13px",
			lineHeight: "22px",
			color: "var(--dsw-alias-label-primary)",
			width: "100%",
			maxWidth: "calc(var(--dsw-composer-card-max-width, 720px))",
		};
		const smallBtn = {
			border: "none",
			background: "none",
			color: "var(--dsw-alias-label-secondary)",
			cursor: "pointer",
			fontSize: "12px",
			padding: "2px 6px",
			borderRadius: "6px",
		};
		const sendBtn = {
			border: "none",
			background: "var(--dsw-alias-state-business-primary, #4d6bfe)",
			color: "#fff",
			cursor: "pointer",
			fontSize: "12px",
			padding: "3px 12px",
			borderRadius: "6px",
		};

		function AnnotateDock(props) {
			const sessionId = props.sessionId;
			const [, force] = React.useReducer((x) => x + 1, 0);
			const [open, setOpen] = React.useState(false);
			const [overall, setOverall] = React.useState("");
			const [sending, setSending] = React.useState(false);
			const [editing, setEditing] = React.useState(null);
			const [editText, setEditText] = React.useState("");
			React.useEffect(() => store.subscribe(force), []);
			React.useEffect(() => {
				activeSessionId = sessionId;
				return () => { if (activeSessionId === sessionId) activeSessionId = undefined; };
			}, [sessionId]);
			const items = store.itemsFor(sessionId);
			if (items.length === 0) return null;

			const send = async () => {
				if (sending) return;
				setSending(true);
				try {
					const conversation = ctxRef !== undefined ? ctxRef.get("conversation") : undefined;
					const sessions = ctxRef !== undefined ? ctxRef.get("sessions") : undefined;
					const binding = sessions !== undefined ? sessions.binding(sessionId) : undefined;
					const session = binding !== undefined && binding !== null ? binding.session : undefined;
					if (conversation === undefined || session === undefined) throw new Error("会话服务不可用");
					const lines = ["【批注】针对你上面的回复,共 " + items.length + " 处,请逐条处理:"];
					items.forEach((it, i) => {
						lines.push((i + 1) + ". 原文:「" + clip(it.quote, 300) + "」");
						if (it.comment !== "") lines.push("   批注:" + it.comment);
					});
					if (overall.trim() !== "") lines.push("总体要求:" + overall.trim());
					await conversation.sendSession(session, lines.join("\n"), [], "queue");
					store.clear(sessionId);
					setOverall("");
					setOpen(false);
				} catch (err) {
					window.alert("批注发送失败:" + ((err && err.message) || err));
				} finally {
					setSending(false);
				}
			};

			const header = h("div", { style: { display: "flex", alignItems: "center", gap: "10px" } },
				h("span", { style: { fontWeight: 600 } }, "✎ " + items.length + " 条批注"),
				h("button", { type: "button", style: smallBtn, onClick: () => setOpen((v) => !v) }, open ? "收起" : "查看"),
				h("span", { style: { flex: 1 } }),
				h("button", { type: "button", style: smallBtn, onClick: () => { store.clear(sessionId); setOpen(false); } }, "清空"),
				h("button", { type: "button", style: sendBtn, disabled: sending, onClick: send }, sending ? "发送中…" : "发送批注"));

			const list = open ? h("div", { style: { marginTop: "6px" } },
				items.map((it, i) => h("div", {
					key: i,
					style: { display: "flex", gap: "8px", alignItems: "flex-start", padding: "4px 0", borderTop: "1px solid var(--dsw-alias-border-l1)" },
				},
					h("span", { style: { color: "var(--dsw-alias-label-tertiary)", flex: "none" } }, String(i + 1) + "."),
					h("div", { style: { flex: 1, minWidth: 0 } },
						h("div", { style: { color: "var(--dsw-alias-label-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, "「" + clip(it.quote, 60) + "」"),
						editing === i
							? h("div", null,
								h("textarea", {
									value: editText,
									autoFocus: true,
									onChange: (e) => setEditText(e.target.value),
									onKeyDown: (e) => {
										if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); store.update(sessionId, i, editText.trim()); setEditing(null); }
										if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
									},
									style: { width: "100%", boxSizing: "border-box", minHeight: "40px", resize: "vertical", border: "1px solid var(--dsw-alias-state-business-primary, #4d6bfe)", borderRadius: "6px", background: "var(--dsw-alias-bg-base)", color: "inherit", padding: "6px 8px", fontSize: "12px", fontFamily: "inherit", outline: "none" },
								}),
								h("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" } },
									h("button", { type: "button", style: smallBtn, onClick: () => setEditing(null) }, "取消"),
									h("button", { type: "button", style: sendBtn, onClick: () => { store.update(sessionId, i, editText.trim()); setEditing(null); } }, "确认")))
							: h("div", {
								title: "点击编辑批注",
								onClick: () => { setEditing(i); setEditText(it.comment); },
								style: it.comment === ""
									? { cursor: "pointer", color: "var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary))" }
									: { cursor: "pointer" },
							}, it.comment === "" ? "(未写批注,点击补写)" : it.comment)),
					h("button", { type: "button", style: smallBtn, title: "编辑这条", onClick: () => { setEditing(i); setEditText(it.comment); } }, "✎"),
					h("button", { type: "button", style: smallBtn, title: "删除这条", onClick: () => { store.remove(sessionId, i); setEditing(null); } }, "✕"))),
				h("textarea", {
					value: overall,
					onChange: (e) => setOverall(e.target.value),
					placeholder: "总体要求(可选,随批注一起发送)…",
					style: { width: "100%", boxSizing: "border-box", minHeight: "40px", resize: "vertical", marginTop: "6px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "6px", background: "var(--dsw-alias-bg-base)", color: "inherit", padding: "6px 8px", fontSize: "12px", fontFamily: "inherit", outline: "none" },
				})) : null;

			return h("div", { style: barStyle }, header, list);
		}

		// ── 装配 ─────────────────────────────────────────────────────
		function apply(ctx) {
			ctxRef = ctx;
			const slots = ctx.get("slots");
			if (slots === undefined) return;
			ctx.effect(() => {
				document.addEventListener("mouseup", onMouseUp);
				document.addEventListener("mousedown", onMouseDown);
				window.addEventListener("scroll", onScroll, true);
				return () => {
					document.removeEventListener("mouseup", onMouseUp);
					document.removeEventListener("mousedown", onMouseDown);
					window.removeEventListener("scroll", onScroll, true);
					if (overlayRoot !== null) { overlayRoot.remove(); overlayRoot = null; btnEl = null; editorEl = null; quoteEl = null; taEl = null; }
				};
			});
			slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "annotate", order: 20 },
				AnnotateDock,
			));
		}

		exports.apply = apply;
		return module.exports;
	},
});
