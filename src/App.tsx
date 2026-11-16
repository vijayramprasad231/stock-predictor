import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Activity, ArrowDownRight, ArrowUpRight, Check, CircleHelp, FileUp, Plus, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { categories, estimateDoubleRate, makeDemoAssets, parsePriceCsv, type Asset, type Category, type Evidence, type PricePoint, type Stance } from './stock'
import './App.css'

const STORAGE_KEY = 'ai-portfolio-assets-in-v3'
const filters = ['All assets', ...categories] as const
type Filter = (typeof filters)[number]

function initialAssets(): Asset[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved) as Asset[]
  } catch {
    localStorage.removeItem(STORAGE_KEY)
  }
  return makeDemoAssets()
}

function money(value: number | undefined, currency: Asset['currency']) {
  if (value === undefined || !Number.isFinite(value)) return '--'
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, maximumFractionDigits: value < 10 ? 2 : 0 }).format(value)
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(`${value}T00:00:00`))
}

function latestPrice(prices: PricePoint[]) {
  return prices[prices.length - 1]
}

function App() {
  const [assets, setAssets] = useState<Asset[]>(initialAssets)
  const [selectedTicker, setSelectedTicker] = useState('')
  const [filter, setFilter] = useState<Filter>('All assets')
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [ticker, setTicker] = useState('')
  const [name, setName] = useState('')
  const [assetCategory, setAssetCategory] = useState<Category>('Metals')
  const [currency, setCurrency] = useState<Asset['currency']>('INR')
  const [formError, setFormError] = useState('')
  const [showEvidenceForm, setShowEvidenceForm] = useState(false)
  const [evidenceSummary, setEvidenceSummary] = useState('')
  const [evidenceSource, setEvidenceSource] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [stance, setStance] = useState<Stance>('Mixed')
  const addCsv = useRef<HTMLInputElement>(null)
  const updateCsv = useRef<HTMLInputElement>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(assets))
    if (!selectedTicker && assets[0]) setSelectedTicker(assets[0].ticker)
  }, [assets, selectedTicker])

  const selected = assets.find((asset) => asset.ticker === selectedTicker) ?? assets[0]
  const visible = assets.filter((asset) => (filter === 'All assets' || asset.category === filter) && `${asset.ticker} ${asset.name}`.toLowerCase().includes(query.toLowerCase()))
  const demoCount = assets.filter((asset) => asset.source === 'demo').length
  const rates = assets.map((asset) => estimateDoubleRate(asset.prices)).filter((rate) => rate.probability !== null)
  const boardRate = rates.length ? rates.reduce((sum, rate) => sum + (rate.probability ?? 0), 0) / rates.length : null

  const updateAsset = (symbol: string, update: (asset: Asset) => Asset) => {
    setAssets((current) => current.map((asset) => asset.ticker === symbol ? update(asset) : asset))
  }

  const addAsset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const symbol = ticker.trim().toUpperCase()
    if (!symbol || assets.some((asset) => asset.ticker === symbol)) {
      setFormError(symbol ? 'That ticker is already on your board.' : 'Enter a ticker symbol.')
      return
    }
    let prices: PricePoint[] = []
    const file = addCsv.current?.files?.[0]
    if (file) {
      try {
        prices = parsePriceCsv(await file.text())
      } catch {
        setFormError('Could not read the CSV. Check the Date and Close columns.')
        return
      }
      if (!prices.length) {
        setFormError('No valid rows found. Expected Date and Close or Adj Close columns.')
        return
      }
    }
    const asset: Asset = {
      ticker: symbol,
      name: name.trim() || symbol,
      category: assetCategory,
      currency,
      prices,
      trackingStartDate: latestPrice(prices)?.date,
      trackingStartPrice: latestPrice(prices)?.close,
      evidence: [],
      source: 'import',
    }
    setAssets((current) => [...current, asset])
    setSelectedTicker(symbol)
    setTicker('')
    setName('')
    setFormError('')
    setShowAdd(false)
  }

  const importPrices = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !selected) return
    try {
      const points = parsePriceCsv(await file.text())
      if (!points.length) {
        window.alert('No valid rows found. The CSV needs Date and Close or Adj Close columns.')
        return
      }
      updateAsset(selected.ticker, (asset) => {
        const existing = asset.source === 'demo' ? [] : asset.prices
        const byDate = new Map(existing.map((point) => [point.date, point]))
        points.forEach((point) => byDate.set(point.date, point))
        const merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
        const baseline = asset.source === 'demo' ? points[points.length - 1] : undefined
        return {
          ...asset,
          prices: merged,
          source: 'import',
          trackingStartDate: baseline?.date ?? asset.trackingStartDate,
          trackingStartPrice: baseline?.close ?? asset.trackingStartPrice,
        }
      })
    } catch {
      window.alert('Could not read the CSV. Check the Date and Close columns.')
    } finally {
      event.target.value = ''
    }
  }

  const addEvidence = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected || !evidenceSummary.trim() || !evidenceSource.trim()) return
    const item: Evidence = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      date: new Date().toISOString().slice(0, 10),
      summary: evidenceSummary.trim(),
      source: evidenceSource.trim(),
      url: evidenceUrl.trim(),
      stance,
    }
    updateAsset(selected.ticker, (asset) => ({ ...asset, evidence: [item, ...asset.evidence] }))
    setEvidenceSummary('')
    setEvidenceSource('')
    setEvidenceUrl('')
    setShowEvidenceForm(false)
  }

  const removeAsset = (symbol: string) => {
    const remaining = assets.filter((asset) => asset.ticker !== symbol)
    setAssets(remaining)
    if (selectedTicker === symbol) setSelectedTicker(remaining[0]?.ticker ?? '')
  }

  const resetDemo = () => {
    const demo = makeDemoAssets()
    setAssets(demo)
    setSelectedTicker(demo[0]?.ticker ?? '')
    setFilter('All assets')
    setQuery('')
  }

  const last = selected ? latestPrice(selected.prices)?.close : undefined
  const target = selected?.trackingStartPrice ? selected.trackingStartPrice * 2 : undefined
  const progress = last && selected?.trackingStartPrice ? (last / selected.trackingStartPrice) * 100 : undefined
  const rate = selected ? estimateDoubleRate(selected.prices) : { probability: null, windows: 0, hits: 0 }
  const tracking = selected?.prices.filter((point) => !selected.trackingStartDate || point.date >= selected.trackingStartDate).map((point) => ({ ...point, label: dateLabel(point.date) })) ?? []
  const evidence = selected?.evidence ?? []

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Signal Desk home"><span className="brand-mark"><Activity size={17} /></span><span>SIGNAL<span className="brand-light">DESK</span></span></a>
        <div className="topbar-meta"><span className="market-status"><i /> INDIA / NSE + BSE</span><button className="icon-button" title="Historical rate method" onClick={() => window.alert('Historical frequency: in rolling windows of 126 trading sessions, count how often a close reached 2x the starting close. Windows overlap and are not independent. This is not a forecast.') }><CircleHelp size={17} /></button></div>
      </header>

      <main id="top" className="page-content">
        <section className="page-heading">
          <div><p className="eyebrow">INDIA EQUITY RESEARCH / V1</p><h1>Signal over <span>speculation.</span></h1><p className="heading-copy">Track NSE and BSE metals, AI and semiconductor names against one hard question: how often did a 2x move happen in the historical record?</p></div>
          <div className="heading-actions"><button className="button button-quiet" onClick={resetDemo}><Activity size={16} /> Load sample</button><button className="button button-primary" onClick={() => { setShowAdd((value) => !value); setFormError('') }}><Plus size={17} /> Add equity</button></div>
        </section>

        {demoCount > 0 && <div className="sample-notice" role="status"><span className="sample-dot" /><strong>SIMULATED SAMPLE DATA</strong><span>Prices are fabricated for interface demonstration. Import a price CSV before interpreting any metric.</span></div>}

        <section className="method-strip"><div className="method-icon"><ShieldCheck size={18} /></div><div><strong>Historical base rate, not a forward probability.</strong><span>Calculated from your CSV: share of rolling 126-session windows that touched 2x. No live quotes, fundamentals model or investment recommendation.</span></div><span className="method-tag">EVIDENCE FIRST</span></section>

        {showAdd && <form className="add-form" onSubmit={addAsset}>
          <div className="form-heading"><div><span className="eyebrow">WATCHLIST</span><h2>Add an equity</h2></div><button className="icon-button" type="button" title="Close" onClick={() => setShowAdd(false)}><X size={18} /></button></div>
          <label>Ticker<input required value={ticker} onChange={(event) => setTicker(event.target.value)} placeholder="e.g. TATASTEEL.NS" maxLength={20} /><span className="field-hint">NSE: .NS · BSE: .BO (Yahoo Finance format)</span></label><label>Company<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Company name" /></label>
          <label>Theme<select value={assetCategory} onChange={(event) => setAssetCategory(event.target.value as Category)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><label>Currency<select value={currency} onChange={(event) => setCurrency(event.target.value as Asset['currency'])}><option value="INR">INR</option><option value="USD">USD</option></select></label>
          <label className="file-field">Optional price CSV<input ref={addCsv} type="file" accept=".csv,text/csv" /></label>{formError && <p className="form-error">{formError}</p>}<button className="button button-primary" type="submit"><Plus size={16} /> Save equity</button>
        </form>}

        <section className="stat-row">
          <div className="stat-cell"><span>ON YOUR BOARD</span><strong>{String(assets.length).padStart(2, '0')}</strong><small>tracked symbols</small></div>
          <div className="stat-cell"><span>PRICE HISTORIES</span><strong>{String(assets.filter((asset) => asset.prices.length).length).padStart(2, '0')}</strong><small>with imported or sample series</small></div>
          <div className="stat-cell"><span>HISTORICAL 2X RATE</span><strong>{boardRate === null ? '--' : `${Math.round(boardRate * 100)}%`}</strong><small>average across measurable names</small></div>
          <div className="stat-cell"><span>LAST OBSERVATION</span><strong className="stat-date">{selected?.prices.length ? dateLabel(selected.prices[selected.prices.length - 1].date) : '--'}</strong><small>latest selected price date</small></div>
        </section>

        <section className="board-layout">
          <div className="watchlist-panel">
            <div className="section-heading"><div><span className="eyebrow">UNIVERSE</span><h2>Watchlist <span className="count-pill">{visible.length}</span></h2></div><div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find ticker" aria-label="Find ticker" /></div></div>
            <div className="category-tabs" role="tablist" aria-label="Filter by theme">{filters.map((item) => <button key={item} className={filter === item ? 'category-tab active' : 'category-tab'} onClick={() => setFilter(item)} role="tab" aria-selected={filter === item}>{item}</button>)}</div>
            <div className="table-scroll"><table className="watchlist-table"><thead><tr><th>Company / ticker</th><th>Theme</th><th>Last close</th><th>Historical 2x rate</th><th /></tr></thead><tbody>
              {visible.map((asset) => {
                const itemRate = estimateDoubleRate(asset.prices)
                return <tr key={asset.ticker} className={selected?.ticker === asset.ticker ? 'selected-row' : ''} onClick={() => setSelectedTicker(asset.ticker)}>
                  <td><div className="equity-cell"><span className={`ticker-mark ${asset.category.toLowerCase().replace(/\s/g, '-')}`}>{asset.ticker.slice(0, 2)}</span><div><strong>{asset.ticker}</strong><span>{asset.name}{asset.source === 'demo' && <em className="demo-chip">DEMO</em>}</span></div></div></td>
                  <td><span className="theme-label">{asset.category}</span></td><td className="price-cell">{money(latestPrice(asset.prices)?.close, asset.currency)}</td>
                  <td><div className="rate-cell"><strong>{itemRate.probability === null ? '--' : `${Math.round(itemRate.probability * 100)}%`}</strong><span>{itemRate.windows ? `${itemRate.windows} rolling windows` : 'Need 127+ closes'}</span></div></td><td><button className="row-select" title={`View ${asset.ticker}`}><span /></button></td>
                </tr>
              })}
              {!visible.length && <tr><td className="empty-cell" colSpan={5}>No equities match this filter. Add an equity or load the sample board.</td></tr>}
            </tbody></table></div>
            <div className="table-footnote"><CircleHelp size={14} /> 2x rate is a historical frequency, not an outlook. Windows overlap and are not independent trials.</div>
          </div>

          <aside className="focus-panel">{selected ? <>
            <div className="focus-topline"><span className="eyebrow">SELECTED NAME</span><button className="icon-button remove-button" title={`Remove ${selected.ticker}`} onClick={() => removeAsset(selected.ticker)}><Trash2 size={15} /></button></div>
            <div className="focus-identity"><span className={`ticker-mark large ${selected.category.toLowerCase().replace(/\s/g, '-')}`}>{selected.ticker.slice(0, 2)}</span><div><h2>{selected.ticker}</h2><p>{selected.name}</p></div></div>
            <div className="focus-tags"><span>{selected.category}</span><span>{selected.source === 'demo' ? 'SYNTHETIC' : 'CSV HISTORY'}</span></div>
            <div className="rate-hero"><div><span>HISTORICAL 2X FREQUENCY</span><strong>{rate.probability === null ? '--' : `${Math.round(rate.probability * 100)}%`}</strong></div><span className="rate-sample">{rate.windows ? `${rate.hits} of ${rate.windows} rolling windows touched 2x` : 'Import at least 127 daily closes'}</span></div>
            <div className="focus-metrics"><div><span>LAST CLOSE</span><strong>{money(last, selected.currency)}</strong></div><div><span>TRACKING TARGET</span><strong>{money(target, selected.currency)}</strong></div><div><span>MOVE FROM START</span><strong className={progress !== undefined && progress >= 100 ? 'positive' : ''}>{progress === undefined ? '--' : `${(progress - 100).toFixed(1)}%`}</strong></div></div>
            <div className="focus-actions"><button className="button button-outline" onClick={() => updateCsv.current?.click()}><FileUp size={15} /> Import prices</button><input ref={updateCsv} className="hidden-input" type="file" accept=".csv,text/csv" onChange={importPrices} aria-label="Import selected equity price history CSV" /><button className="button button-outline" onClick={() => setShowEvidenceForm((value) => !value)}><Plus size={15} /> Add evidence</button></div>
          </> : <div className="empty-focus"><div className="empty-symbol">+ <span>2x</span></div><h2>Build your universe</h2><p>Add a symbol and import daily price history to calculate its historical base rate.</p><button className="button button-primary" onClick={() => setShowAdd(true)}><Plus size={16} /> Add first equity</button></div>}</aside>
        </section>

        {selected && <section className="lower-grid">
          <div className="monitor-panel"><div className="section-heading monitor-heading"><div><span className="eyebrow">FORWARD MONITOR / TRACKING FROM {selected.trackingStartDate ? dateLabel(selected.trackingStartDate).toUpperCase() : 'NO BASELINE'}</span><h2>Progress to 2x <span className="live-dot" /></h2></div><div className="monitor-summary"><strong>{progress === undefined ? '--' : `${progress.toFixed(1)}%`}</strong><span>of target price</span></div></div>
            {tracking.length > 1 ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={tracking} margin={{ top: 14, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid vertical={false} stroke="#e9ece9" strokeDasharray="3 4" /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#858a83', fontSize: 11 }} minTickGap={32} /><YAxis tickLine={false} axisLine={false} tick={{ fill: '#858a83', fontSize: 11 }} width={58} tickFormatter={(value: number) => money(value, selected.currency)} domain={['auto', 'auto']} />
              <Tooltip formatter={(value) => money(Number(value), selected.currency)} contentStyle={{ border: '1px solid #e0e4dd', borderRadius: 4, fontSize: 12 }} />{target && <ReferenceLine y={target} stroke="#d76c48" strokeDasharray="5 5" label={{ value: '2X TARGET', fill: '#b95a3b', fontSize: 10, position: 'insideTopRight' }} />}
              <Line type="monotone" dataKey="close" name="Close" stroke="#087e72" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: '#087e72', stroke: '#fff', strokeWidth: 2 }} />
            </LineChart></ResponsiveContainer></div> : <div className="chart-empty"><Activity size={22} /><span>Import more than one price observation after setting a tracking baseline to see progress here.</span></div>}
            <div className="chart-legend"><span><i className="legend-price" /> Closing price</span><span><i className="legend-target" /> 2x of tracking-start close</span><small>Historical closes and subsequent CSV updates</small></div>
          </div>

          <div className="evidence-panel"><div className="section-heading evidence-heading"><div><span className="eyebrow">SOURCE LOG / {evidence.length} ENTRIES</span><h2>Evidence trail</h2></div><button className="icon-button" title="Add evidence" onClick={() => setShowEvidenceForm((value) => !value)}><Plus size={18} /></button></div>
            {showEvidenceForm && <form className="evidence-form" onSubmit={addEvidence}><label>Observation<textarea required value={evidenceSummary} onChange={(event) => setEvidenceSummary(event.target.value)} placeholder="What did the source report? Separate fact from interpretation." rows={3} /></label><div className="evidence-form-row"><label>Source<input required value={evidenceSource} onChange={(event) => setEvidenceSource(event.target.value)} placeholder="Company filing, regulator, ..." /></label><label>Signal<select value={stance} onChange={(event) => setStance(event.target.value as Stance)}><option>Supports</option><option>Mixed</option><option>Contradicts</option></select></label></div><label>Source URL<input type="url" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="https://" /></label><button className="button button-primary" type="submit"><Check size={15} /> Save source note</button></form>}
            {evidence.length ? <div className="evidence-list">{evidence.map((item) => <EvidenceRow key={item.id} item={item} onRemove={() => updateAsset(selected.ticker, (asset) => ({ ...asset, evidence: asset.evidence.filter((entry) => entry.id !== item.id) }))} />)}</div> : <div className="evidence-empty"><div className="evidence-empty-icon"><ShieldCheck size={18} /></div><strong>No evidence logged yet</strong><p>Capture dated claims from filings, company releases or regulators. Keep the original source attached.</p><button className="text-button" onClick={() => setShowEvidenceForm(true)}>Log first source <ArrowUpRight size={14} /></button></div>}
          </div>
        </section>}

        <footer className="page-footer"><span><ShieldCheck size={14} /> Research workspace only. Not investment advice.</span><span>{assets.length} names / {assets.filter((asset) => asset.prices.length).length} price series</span></footer>
      </main>
    </div>
  )
}

function EvidenceRow({ item, onRemove }: { item: Evidence; onRemove: () => void }) {
  const stanceClass = item.stance.toLowerCase()
  return <article className="evidence-item"><div className="evidence-item-top"><span className={`stance ${stanceClass}`}>{item.stance === 'Supports' ? <ArrowUpRight size={12} /> : item.stance === 'Contradicts' ? <ArrowDownRight size={12} /> : <Activity size={12} />}{item.stance}</span><time>{dateLabel(item.date)}</time><button className="icon-button tiny" title="Remove evidence" onClick={onRemove}><X size={14} /></button></div><p>{item.summary}</p><div className="evidence-source">{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.source}<ArrowUpRight size={12} /></a> : <span>{item.source}</span>}</div></article>
}

export default App
