// dsh-cost-display 宿主半边:注册 GET /dsh-cost/summary,
// 返回 DeepSeek 账户余额(60 秒缓存)+ 价目表,供浏览器半边渲染。
// 价目表:官方 2026-08 价格(元/百万 tokens),官方调价后改这里即可。
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PRICES = {
  'deepseek-v4-flash': {
    hitPeak: 0.10, hitOff: 0.05,
    missPeak: 3.0, missOff: 1.5,
    outPeak: 9.0, outOff: 4.5,
  },
  'deepseek-v4-pro': {
    hitPeak: 0.30, hitOff: 0.15,
    missPeak: 9.0, missOff: 4.5,
    outPeak: 27.0, outOff: 13.5,
  },
}
const DEFAULT_MODEL = 'deepseek-v4-flash'
const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const CACHE_MS = 60_000

export const name = 'dsh-cost-display'
export const inject = ['webServer']

async function resolveApiKey(ctx) {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    try {
      const hit = await credentials.resolve('DEEPSEEK_API_KEY')
      if (hit !== undefined && hit.value !== '') return hit.value
    } catch {}
  }
  if (typeof process.env.DEEPSEEK_API_KEY === 'string' && process.env.DEEPSEEK_API_KEY !== '') {
    return process.env.DEEPSEEK_API_KEY
  }
  try {
    const raw = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
    const match = raw.match(/DEEPSEEK_API_KEY:\s*['"]?([^'"\s]+)/)
    if (match !== null) return match[1]
  } catch {}
  return undefined
}

export function apply(ctx) {
  let cache
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-cost/summary',
    handler: async (req, res) => {
      let balance = null
      let error
      try {
        const now = Date.now()
        if (cache === undefined || now - cache.at > CACHE_MS) {
          const key = await resolveApiKey(ctx)
          if (key === undefined) {
            error = 'no-api-key'
          } else {
            const resp = await fetch(BALANCE_URL, {
              headers: { Authorization: `Bearer ${key}` },
              signal: AbortSignal.timeout(8000),
            })
            if (resp.ok) {
              const data = await resp.json()
              const info = Array.isArray(data.balance_infos) ? data.balance_infos[0] : undefined
              if (info !== undefined) {
                balance = { currency: info.currency, total: info.total_balance }
              }
            } else {
              error = `balance-http-${resp.status}`
            }
            cache = { at: now, balance, error }
          }
        } else {
          balance = cache.balance
          error = cache.error
        }
      } catch (err) {
        error = String((err && err.message) || err)
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({
        balance,
        error,
        prices: PRICES,
        defaultModel: DEFAULT_MODEL,
        fetchedAt: cache !== undefined ? cache.at : Date.now(),
      }))
    },
  }), 'cost-display: summary route')
}
