export const categories = ['Semiconductor & Electronics', 'AI Infrastructure & Compute'] as const

export type Category = (typeof categories)[number]
export type Stance = 'Supports' | 'Mixed' | 'Contradicts'

export type PricePoint = {
  date: string
  capturedAt: string
  close: number
  changePercent: number | null
  source: string
}

export type Evidence = {
  id: string
  date: string
  summary: string
  source: string
  url: string
  stance: Stance
}

export type Prediction = {
  baselineDate: string
  baselinePrice: number
  targetPrice: number
  horizonTradingDays: number
  createdAt: string
  outcome: 'monitoring' | 'hit' | 'not_reached'
  outcomeDate?: string
}

export type Asset = {
  ticker: string
  name: string
  category: Category
  currency: 'INR'
  prices: PricePoint[]
  prediction: Prediction | null
  evidence: Evidence[]
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
