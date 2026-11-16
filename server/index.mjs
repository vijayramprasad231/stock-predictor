import { createServer } from 'node:http'
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const project = path.resolve(here, '..')
const dataDir = path.join(here, 'data')
const dataFile = path.join(dataDir, 'monitor.json')
const port = Number(process.env.API_PORT || 4174)
const upstream = (process.env.STOCK_API_BASE_URL || 'http://65.0.104.9').replace(/\/$/, '')
const DEFAULT_WATCHLIST = [
  ['NETWEB.NS', 'Netweb Technologies India', 'AI Infrastructure & Compute'],
  ['E2E.NS', 'E2E Networks', 'AI Infrastructure & Compute'],
  ['CGPOWER.NS', 'CG Power and Industrial Solutions', 'AI Infrastructure & Compute'],
  ['ABB.NS', 'ABB India', 'AI Infrastructure & Compute'],
  ['SIEMENS.NS', 'Siemens India', 'AI Infrastructure & Compute'],
  ['CUMMINSIND.NS', 'Cummins India', 'AI Infrastructure & Compute'],
  ['POLYCAB.NS', 'Polycab India', 'AI Infrastructure & Compute'],
  ['KEI.NS', 'KEI Industries', 'AI Infrastructure & Compute'],
  ['BEL.NS', 'Bharat Electronics', 'AI Infrastructure & Compute'],
  ['MOSCHIP.NS', 'MosChip Technologies', 'Semiconductor & Electronics'],
  ['KAYNES.NS', 'Kaynes Technology India', 'Semiconductor & Electronics'],
  ['SYRMA.NS', 'Syrma SGS Technology', 'Semiconductor & Electronics'],
  ['DIXON.NS', 'Dixon Technologies', 'Semiconductor & Electronics'],
  ['DATAPATTNS.NS', 'Data Patterns India', 'Semiconductor & Electronics'],
  ['CYIENTDLM.NS', 'Cyient DLM', 'Semiconductor & Electronics'],
  ['SPEL.NS', 'SPEL Semiconductor', 'Semiconductor & Electronics'],
  ['AVALON.NS', 'Avalon Technologies', 'Semiconductor & Electronics'],
]

let state = {
  watchlist: [],
  snapshots: {},
  predictions: {},
  evidence: {},
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastScheduledCaptureDate: null,
  providerError: null,
  providerMode: '0xramm-yahoo-proxy',
}
let writeQueue = Promise.resolve()

async function loadState() {
  await mkdir(dataDir, { recursive: true })
  try {
    state = { ...state, ...JSON.parse(await readFile(dataFile, 'utf8')) }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not read monitor store:', error.message)
    await saveState()
  }
  if ((state.seedVersion || 0) < 3) {
    const migrated = state.watchlist
      .filter((item) => ['Semiconductor & Electronics', 'AI Infrastructure & Compute', 'AI Infrastructure Suppliers'].includes(item.category))
      .map((item) => ({
        ...item,
        category: item.category === 'AI Infrastructure Suppliers' ? 'AI Infrastructure & Compute' : item.category,
      }))
    state.watchlist = [
      ...migrated,
      ...DEFAULT_WATCHLIST
        .filter(([ticker]) => !migrated.some((item) => item.ticker === ticker))
        .map(([ticker, name, category]) => ({ ticker, name, category, currency: 'INR' })),
    ]
    state.seedVersion = 3
    await saveState()
  }
}

function saveState() {
  writeQueue = writeQueue.then(async () => {
    const tempFile = `${dataFile}.tmp`
    await writeFile(tempFile, JSON.stringify(state, null, 2), 'utf8')
    await rename(tempFile, dataFile)
  })
  return writeQueue
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 32_000) throw new Error('Request body is too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function indiaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function indiaClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return { hour: Number(value.hour), minute: Number(value.minute) }
}

function normalizeSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase().replace(/\s+/g, '')
  if (!/^[A-Z0-9&._-]{1,32}$/.test(symbol)) return null
  return /\.(NS|BO)$/.test(symbol) ? symbol : `${symbol}.NS`
}

function normalizeQuote(raw, ticker, capturedAt) {
  const last = Number(raw?.last_price)
  if (!Number.isFinite(last) || last <= 0) return null
  const quoteDate = String(raw.last_update || '').slice(0, 10)
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(quoteDate) ? quoteDate : indiaDate(new Date(capturedAt)),
    capturedAt,
    close: last,
    changePercent: Number.isFinite(Number(raw.percent_change)) ? Number(raw.percent_change) : null,
    source: '0xramm / Yahoo Finance proxy',
  }
}

async function fetchUpstream(route, timeoutMs = 8000) {
  const response = await fetch(`${upstream}${route}`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`Market API responded with HTTP ${response.status}`)
  const result = await response.json()
  if (result?.status === 'error') throw new Error(result.message || 'Market API returned an error')
  return result
}

async function captureQuotes({ manual = false } = {}) {
  if (!state.watchlist.length) return { captured: 0, message: 'Add symbols to the watchlist first.' }
  const capturedAt = new Date().toISOString()
  state.lastAttemptAt = capturedAt
  state.providerError = null
  const bySymbol = new Map()
  let captured = 0

  try {
    const symbols = state.watchlist.map((item) => item.ticker)
    for (let offset = 0; offset < symbols.length; offset += 10) {
      const batch = symbols.slice(offset, offset + 10)
      const query = encodeURIComponent(batch.join(','))
      const payload = await fetchUpstream(`/stock/list?symbols=${query}&res=num`)
      for (const quote of payload.stocks || []) {
        if (quote.ticker && !quote.error) bySymbol.set(quote.ticker, quote)
      }
    }

    for (const item of state.watchlist) {
      const quote = normalizeQuote(bySymbol.get(item.ticker), item.ticker, capturedAt)
      if (!quote) continue
      const points = state.snapshots[item.ticker] || []
      const prior = points.findIndex((point) => point.date === quote.date)
      if (prior >= 0) points[prior] = quote
      else points.push(quote)
      points.sort((a, b) => a.date.localeCompare(b.date))
      state.snapshots[item.ticker] = points
      if (!state.predictions[item.ticker]) {
        state.predictions[item.ticker] = {
          baselineDate: quote.date,
          baselinePrice: quote.close,
          targetPrice: quote.close * 2,
          horizonTradingDays: 63,
          createdAt: capturedAt,
          outcome: 'monitoring',
        }
      }
      const prediction = state.predictions[item.ticker]
      if (prediction.outcome === 'monitoring' && quote.close >= prediction.targetPrice) {
        prediction.outcome = 'hit'
        prediction.outcomeDate = quote.date
      } else if (prediction.outcome === 'monitoring') {
        const observed = points.filter((point) => point.date >= prediction.baselineDate).length
        if (observed >= prediction.horizonTradingDays) {
          prediction.outcome = 'not_reached'
          prediction.outcomeDate = quote.date
        }
      }
      captured += 1
    }

    if (!captured) throw new Error('Provider returned no usable quotes for the watchlist')
    state.lastSuccessAt = capturedAt
    state.providerError = null
    await saveState()
    return { captured, capturedAt, manual }
  } catch (error) {
    state.providerError = error.message
    await saveState()
    throw error
  }
}

async function serveStatic(pathname, response) {
  const dist = path.join(project, 'dist')
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1))
  const file = path.resolve(dist, requested)
  if (!file.startsWith(`${dist}${path.sep}`) && file !== path.join(dist, 'index.html')) {
    sendJson(response, 403, { error: 'Forbidden' })
    return
  }
  const target = existsSync(file) ? file : path.join(dist, 'index.html')
  try {
    const content = await readFile(target)
    const ext = path.extname(target)
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
    response.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' })
    response.end(content)
  } catch {
    sendJson(response, 503, { error: 'Build the UI with npm run build first.' })
  }
}

async function handle(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
  try {
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return sendJson(response, 200, {
        ok: true,
        provider: state.providerMode,
        providerStatus: state.providerError ? 'unavailable' : state.lastSuccessAt ? 'connected' : 'not-tested',
        lastAttemptAt: state.lastAttemptAt,
        lastSuccessAt: state.lastSuccessAt,
        providerError: state.providerError,
        schedule: 'Weekdays after 15:45 Asia/Kolkata while this monitor service is running',
      })
    }

    if (url.pathname === '/api/state' && request.method === 'GET') {
      const assets = state.watchlist.map((item) => ({
        ...item,
        prices: state.snapshots[item.ticker] || [],
        prediction: state.predictions[item.ticker] || null,
        evidence: state.evidence[item.ticker] || [],
      }))
      return sendJson(response, 200, {
        assets,
        provider: state.providerMode,
        providerError: state.providerError,
        lastAttemptAt: state.lastAttemptAt,
        lastSuccessAt: state.lastSuccessAt,
      })
    }

    if (url.pathname === '/api/search' && request.method === 'GET') {
      const query = (url.searchParams.get('q') || '').trim()
      if (!query) return sendJson(response, 400, { error: 'Enter a company name or ticker.' })
      const results = await fetchUpstream(`/search?q=${encodeURIComponent(query)}`)
      return sendJson(response, 200, results)
    }

    if (url.pathname === '/api/refresh' && request.method === 'POST') {
      return sendJson(response, 200, await captureQuotes({ manual: true }))
    }

    if (url.pathname === '/api/watchlist' && request.method === 'POST') {
      const body = await readJson(request)
      const ticker = normalizeSymbol(body.ticker)
      if (!ticker) return sendJson(response, 400, { error: 'Enter a valid NSE or BSE symbol.' })
      if (state.watchlist.some((item) => item.ticker === ticker)) return sendJson(response, 409, { error: 'This symbol is already monitored.' })
      const categories = ['Semiconductor & Electronics', 'AI Infrastructure & Compute']
      const category = categories.includes(body.category) ? body.category : 'Semiconductor & Electronics'
      state.watchlist.push({ ticker, name: String(body.name || ticker.replace(/\.(NS|BO)$/, '')).slice(0, 100), category, currency: 'INR' })
      await saveState()
      return sendJson(response, 201, { ticker })
    }

    const tickerPath = url.pathname.match(/^\/api\/watchlist\/([^/]+)$/)
    if (tickerPath && request.method === 'DELETE') {
      const ticker = normalizeSymbol(decodeURIComponent(tickerPath[1]))
      state.watchlist = state.watchlist.filter((item) => item.ticker !== ticker)
      await saveState()
      return sendJson(response, 200, { removed: ticker })
    }

    if (url.pathname === '/api/evidence' && request.method === 'POST') {
      const body = await readJson(request)
      const ticker = normalizeSymbol(body.ticker)
      if (!ticker || !state.watchlist.some((item) => item.ticker === ticker)) return sendJson(response, 404, { error: 'Symbol is not monitored.' })
      if (!String(body.summary || '').trim() || !String(body.source || '').trim()) return sendJson(response, 400, { error: 'Observation and source are required.' })
      const item = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        date: indiaDate(),
        summary: String(body.summary).slice(0, 2000),
        source: String(body.source).slice(0, 160),
        url: String(body.url || '').slice(0, 2000),
        stance: ['Supports', 'Mixed', 'Contradicts'].includes(body.stance) ? body.stance : 'Mixed',
      }
      state.evidence[ticker] = [item, ...(state.evidence[ticker] || [])]
      await saveState()
      return sendJson(response, 201, item)
    }

    const evidencePath = url.pathname.match(/^\/api\/evidence\/([^/]+)$/)
    if (evidencePath && request.method === 'DELETE') {
      const id = decodeURIComponent(evidencePath[1])
      for (const ticker of Object.keys(state.evidence)) state.evidence[ticker] = state.evidence[ticker].filter((item) => item.id !== id)
      await saveState()
      return sendJson(response, 200, { removed: id })
    }

    if (url.pathname.startsWith('/api/')) return sendJson(response, 404, { error: 'API route not found.' })
    return serveStatic(url.pathname, response)
  } catch (error) {
    return sendJson(response, 502, {
      error: error.message || 'Market API unavailable.',
      provider: state.providerMode,
      lastSuccessAt: state.lastSuccessAt,
    })
  }
}

async function scheduledCapture() {
  if (!state.watchlist.length) return
  const now = new Date()
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(now)
  const { hour, minute } = indiaClock(now)
  const date = indiaDate(now)
  const isWeekday = !['Sat', 'Sun'].includes(day)
  const alreadyCaptured = state.watchlist.every((item) => (state.snapshots[item.ticker] || []).some((point) => point.date === date))
  const afterClose = hour > 15 || (hour === 15 && minute >= 45)
  if (isWeekday && afterClose && !alreadyCaptured && state.lastScheduledCaptureDate !== date) {
    state.lastScheduledCaptureDate = date
    await saveState()
    await captureQuotes().catch((error) => console.warn('Scheduled quote capture failed:', error.message))
  }
}

await loadState()
const server = createServer(handle)
server.listen(port, '127.0.0.1', () => console.log(`Monitor API listening at http://127.0.0.1:${port}; provider=${upstream}`))
setInterval(() => { void scheduledCapture() }, 60_000).unref()
