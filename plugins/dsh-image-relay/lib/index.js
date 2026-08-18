// dsh-image-relay:DeepSeek 对话模型不收图,本插件在 llm/stream 瀑布事件上拦截请求,
// 把图片块导出为 ~/.dsh/image-inbox/ 下的本地文件,并替换成一段文字指引——
// 告诉模型"图在这个路径,要看就调用 subagent_codex 让 Codex(有视觉能力)去看"。
// 图片本体仍完整保存在会话附件里,界面显示不受影响;按 sha256 缓存,不重复导出。
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

export const name = 'dsh-image-relay'
export const inject = ['attachments', 'llm', 'webServer']

export function apply(ctx) {
  const inbox = join(homedir(), '.dsh', 'image-inbox')
  const exported = new Map()

  // 常驻提示词分节:模型并不知道 Codex 具备视觉与 ImageGen 能力,不提示的话
  // 生图请求会退化成用 Python 画图。order 150 落在官方工具引导区间(100-199)。
  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt !== undefined) {
    ctx.effect(() => systemPrompt.section({
      name: 'image-relay:codex-image-guide',
      order: 150,
      text: [
        '## 图片任务指引',
        '你的对话模型自身没有图像视觉与图像生成能力,但本机已接入 Codex(subagent_codex 工具),它两者都具备:',
        '- 理解/查看图片:把图片文件的绝对路径和要回答的问题一并交给 subagent_codex。',
        '- 生成/修改图片:一律派 subagent_codex 用它的 ImageGen 能力完成(在任务里写明输出文件的绝对路径,放在当前工作区);不要自己用 Python/matplotlib 等代码绘图,除非用户明确要求程序绘图。',
        '- 图片产出后:调用 read_image 读取该文件,让用户在界面上直接预览,并在回复中给出文件路径。',
      ].join('\n'),
    }))
  }

  function logLine(text) {
    try {
      appendFileSync(join(homedir(), '.dsh', 'image-relay.log'),
        `[${new Date().toISOString()}] ${text}\n`)
    } catch {}
  }

  // 发送准入按 resolveModelInfo().inputModalities 拒图(dsh-host-apiproxy),而
  // DeepSeek 适配器把它写死为 ["text"]。这里在运行时补上 "image" 声明放行准入;
  // 真正的图片块随后在 llm/stream 被替换成文字指引,适配器永远收不到图。
  const llm = ctx.llm
  const originalResolve = llm.resolveModelInfo
  if (typeof originalResolve === 'function') {
    llm.resolveModelInfo = async function (provider, model, signal) {
      const info = await originalResolve.call(this, provider, model, signal)
      if (info !== null && typeof info === 'object'
        && Array.isArray(info.inputModalities) && !info.inputModalities.includes('image')) {
        return { ...info, inputModalities: [...info.inputModalities, 'image'] }
      }
      return info
    }
    ctx.effect(() => () => { llm.resolveModelInfo = originalResolve })
  }

  async function materialize(block) {
    const ref = block.attachment
    if (ref === undefined || ref === null || typeof ref.attachmentId !== 'string') {
      logLine('unrecognized image block: ' + JSON.stringify(block).slice(0, 500))
      return undefined
    }
    const key = ref.attachmentId.replace(/^sha256:/, '')
    const cached = exported.get(key)
    if (cached !== undefined) return cached
    const image = await ctx.attachments.readImage(ref)
    const bytes = image instanceof Uint8Array ? image : image.data
    if (!(bytes instanceof Uint8Array)) {
      logLine('unexpected readImage result: ' + JSON.stringify(Object.keys(image ?? {})))
      return undefined
    }
    mkdirSync(inbox, { recursive: true })
    const file = join(inbox, key.slice(0, 16) + '.' + (EXT[ref.mediaType] ?? 'png'))
    if (!existsSync(file)) writeFileSync(file, bytes)
    exported.set(key, file)
    return file
  }

  function guidance(index, file, ref) {
    const size = typeof ref?.width === 'number' && typeof ref?.height === 'number'
      ? `,${ref.width}x${ref.height}` : ''
    return `\n[图片附件#${index}(${ref?.mediaType ?? 'image'}${size}):用户在此处粘贴了一张图片,已保存为本地文件 ${file} 。你无法直接看到图片内容。需要理解这张图时(读取文字、描述画面、分析红圈红框等标注、比对界面细节),请调用 subagent_codex 工具,把该文件路径和要回答的问题交给 Codex——它具备视觉能力,可以打开并查看这个文件。]\n`
  }

  function isImageBlock(b) {
    return b !== null && typeof b === 'object' && b.type === 'image'
  }

  /** 与适配器 contentHasImage 同口径:消息层图片 + 工具结果里嵌套的图片 */
  function blocksHaveImage(blocks) {
    return Array.isArray(blocks) && blocks.some((b) => isImageBlock(b)
      || (b !== null && typeof b === 'object' && b.type === 'tool-result' && blocksHaveImage(b.content)))
  }

  function messagesHaveImage(messages) {
    return Array.isArray(messages) && messages.some((m) => blocksHaveImage(m.content))
  }

  // 会话快照是深度冻结的,不能就地改写;整体克隆出替换后的块列表(递归进工具结果)
  async function transformedBlocks(blocks, counter) {
    const next = []
    for (const block of blocks) {
      if (isImageBlock(block)) {
        counter.index += 1
        let file
        try {
          file = await materialize(block)
        } catch (error) {
          logLine('materialize failed: ' + ((error && error.stack) || error))
        }
        next.push({
          type: 'text',
          text: file !== undefined
            ? guidance(counter.index, file, block.attachment ?? block)
            : `\n[图片附件#${counter.index}:图片存在但导出失败,当前无法查看其内容。]\n`,
        })
      } else if (block !== null && typeof block === 'object' && block.type === 'tool-result'
        && blocksHaveImage(block.content)) {
        next.push({ ...block, content: await transformedBlocks(block.content, counter) })
      } else {
        next.push(block)
      }
    }
    return next
  }

  async function transformedMessages(messages) {
    const counter = { index: 0 }
    const out = []
    for (const message of messages) {
      if (blocksHaveImage(message.content)) {
        out.push({ ...message, content: await transformedBlocks(message.content, counter) })
      } else {
        out.push(message)
      }
    }
    return out
  }

  // ── 浏览器图片卡的两条路由:按附件引用出图 / 系统级打开 ─────────────
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-relay/file',
    handler: async (req, res) => {
      try {
        const q = new URL(req.url ?? '', 'http://localhost').searchParams
        const ref = {
          attachmentId: q.get('id') ?? '',
          mediaType: q.get('mt') ?? 'image/png',
          bytes: Number(q.get('b')),
          width: Number(q.get('w')),
          height: Number(q.get('h')),
          ...q.get('n') !== null ? { name: q.get('n') } : {},
        }
        const image = await ctx.attachments.readImage(ref)
        const bytes = image instanceof Uint8Array ? image : image.data
        res.writeHead(200, {
          'content-type': ref.mediaType,
          'cache-control': 'public, max-age=31536000, immutable',
        })
        res.end(bytes)
      } catch (error) {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end(String((error && error.message) || error))
      }
    },
  }), 'image-relay: attachment file route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-image-relay/open',
    handler: async (req, res) => {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      let ok = false
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const target = body.path
        const ext = typeof target === 'string' ? extname(target).toLowerCase().slice(1) : ''
        if (typeof target === 'string' && target.startsWith('/')
          && Object.values(EXT).concat('jpeg').includes(ext) && existsSync(target)) {
          spawn('/usr/bin/open', body.reveal === true ? ['-R', target] : [target],
            { stdio: 'ignore', detached: true }).unref()
          ok = true
        }
      } catch {}
      res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok }))
    },
  }), 'image-relay: open route')

  ctx.on('llm/stream', (options, next) => {
    if (options === null || typeof options !== 'object' || !messagesHaveImage(options.messages)) return next()
    return (async function* () {
      const replaced = { ...options, messages: await transformedMessages(options.messages) }
      if (messagesHaveImage(replaced.messages)) {
        yield* await Promise.resolve(next())
        return
      }
      // 重新派发净化后的请求;本监听器对无图请求直接放行,不会递归
      yield* await Promise.resolve(ctx.llm.stream(replaced))
    })()
  })
}
