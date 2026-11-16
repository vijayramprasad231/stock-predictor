export const categories = ['Metals', 'AI', 'Semiconductors'] as const

export type Category = (typeof categories)[number]
export type Stance = 'Supports' | 'Mixed' | 'Contradicts'
export type PricePoint = { date: string; close: number }
export type Evidence = {
  id: string
  date: string
  summary: string
  source: string
  url: string
  stance: Stance
}
export type Asset = {
  ticker: string
  name: string
  category: Category
  currency: 'USD' | 'INR'
  prices: PricePoint[]
  trackingStartDate?: string
  trackingStartPrice?: number
  evidence: Evidence[]
  source: 'demo' | 'import'
}

export function estimateDoubleRate(prices: PricePoint[], horizon = 126) {
  const windows = Math.max(0, prices.length - horizon)
  if (!windows) return { probability: null, windows: 0, hits: 0 }
  let hits = 0
  for (let start = 0; start < windows; start += 1) {
    const target = prices[start].close * 2
    for (let index = start + 1; index <= start + horizon; index += 1) {
      if (prices[index].close >= target) {
        hits += 1
        break
      }
    }
  }
  return { probability: hits / windows, windows, hits }
}

function parseCsvLine(line: string) {
  const values: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"' && line[index + 1] === '"' && quoted) {
      value += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === ',' && !quoted) {
      values.push(value.trim())
      value = ''
    } else {
      value += character
    }
  }
  values.push(value.trim())
  return values
}

export function parsePriceCsv(text: string): PricePoint[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase().replace(/"/g, '').trim())
  const dateIndex = headers.findIndex((header) => ['date', 'timestamp', 'time'].includes(header))
  const closeIndex = headers.findIndex((header) => ['adj close', 'adjusted close', 'close', 'price'].includes(header))
  if (dateIndex < 0 || closeIndex < 0) return []
  const points = new Map<string, PricePoint>()
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line)
    const dateValue = cells[dateIndex]?.replace(/"/g, '').trim()
    const closeValue = cells[closeIndex]?.replace(/"/g, '').replace(/,/g, '').replace(/\$/g, '').trim()
    const parsedDate = dateValue ? new Date(dateValue) : null
    const close = Number(closeValue)
    if (!parsedDate || Number.isNaN(parsedDate.getTime()) || !Number.isFinite(close) || close <= 0) continue
    const date = parsedDate.toISOString().slice(0, 10)
    points.set(date, { date, close })
  }
  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function makeSeries(base: number, drift: number, wave: number, offset = 0): PricePoint[] {
  const points: PricePoint[] = []
  const cursor = new Date()
  cursor.setHours(12, 0, 0, 0)
  while (points.length < 280) {
    const day = cursor.getDay()
    if (day !== 0 && day !== 6) {
      const index = 279 - points.length
      const movement = 1 + drift * index + wave * Math.sin((index + offset) / 8) + wave * 0.45 * Math.sin((index + offset) / 21)
      points.unshift({ date: cursor.toISOString().slice(0, 10), close: Math.max(base * 0.35, base * movement) })
    }
    cursor.setDate(cursor.getDate() - 1)
  }
  return points
}

export function makeDemoAssets(): Asset[] {
  const samples = [
    { ticker: 'TATASTEEL.NS', name: 'Tata Steel', category: 'Metals' as const, price: 164, drift: 0.00035, wave: 0.09 },
    { ticker: 'HINDALCO.NS', name: 'Hindalco Industries', category: 'Metals' as const, price: 724, drift: 0.00025, wave: 0.075 },
    { ticker: 'PERSISTENT.NS', name: 'Persistent Systems', category: 'AI' as const, price: 6250, drift: 0.00055, wave: 0.12, offset: 6 },
    { ticker: 'KPITTECH.NS', name: 'KPIT Technologies', category: 'AI' as const, price: 1420, drift: 0.0004, wave: 0.14, offset: 11 },
    { ticker: 'KAYNES.NS', name: 'Kaynes Technology India', category: 'Semiconductors' as const, price: 5800, drift: 0.00045, wave: 0.12, offset: 16 },
    { ticker: 'CGPOWER.NS', name: 'CG Power and Industrial Solutions', category: 'Semiconductors' as const, price: 710, drift: 0.0003, wave: 0.095, offset: 21 },
  ]
  return samples.map((sample) => {
    const prices = makeSeries(sample.price, sample.drift, sample.wave, sample.offset)
    const trackingIndex = prices.length - 22
    return {
      ticker: sample.ticker,
      name: sample.name,
      category: sample.category,
      currency: 'INR' as const,
      prices,
      trackingStartDate: prices[trackingIndex].date,
      trackingStartPrice: prices[trackingIndex].close,
      evidence: [],
      source: 'demo' as const,
    }
  })
}
