import { useEffect, useState, type FormEvent } from 'react'
import { Activity, ArrowDownRight, ArrowUpRight, Check, CircleHelp, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { categories, estimateDoubleRate, type Asset, type Category, type Evidence, type Stance } from './stock'
import './App.css'

const filters = ['All assets', ...categories] as const
type Filter = (typeof filters)[number]
type Health = { provider: string; providerStatus: string; providerError: string | null; lastAttemptAt: string | null; lastSuccessAt: string | null; schedule: string }
type SearchResult = { symbol: string; company_name: string; source?: string }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || result.message || `Request failed (${response.status})`)
  return result as T
}

function money(value: number | undefined, currency = 'INR') {
  if (value === undefined || !Number.isFinite(value)) return '--'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: value < 10 ? 2 : 0 }).format(value)
}

function dateLabel(value?: string) {
  if (!value) return '--'
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
}

function timeLabel(value?: string | null) {
  if (!value) return 'No quote captured yet'
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(value))
}

function App() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [health, setHealth] = useState<Health>({ provider: '0xramm-yahoo-proxy', providerStatus: 'not-tested', providerError: null, lastAttemptAt: null, lastSuccessAt: null, schedule: 'Weekdays after NSE close' })
  const [filter, setFilter] = useState<Filter>('All assets')
  const [query, setQuery] = useState('')
  const [ticker, setTicker] = useState('')
  const [company, setCompany] = useState('')
  const [assetCategory, setAssetCategory] = useState<Category>('Semiconductor & Electronics')
  const [showAdd, setShowAdd] = useState(false)
  const [showEvidence, setShowEvidence] = useState(false)
  const [evidenceSummary, setEvidenceSummary] = useState('')
  const [evidenceSource, setEvidenceSource] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [stance, setStance] = useState<Stance>('Mixed')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchError, setSearchError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedTicker, setSelectedTicker] = useState('')
  const [loading, setLoading] = useState(true)

  const loadState = async () => {
    try {
      const [data, status] = await Promise.all([
        api<{ assets: Asset[]; providerError: string | null; lastAttemptAt: string | null; lastSuccessAt: string | null }>('/api/state'),
        api<Health>('/api/health'),
      ])
      setAssets(data.assets)
      setHealth(status)
      setSelectedTicker((current) => data.assets.some((asset) => asset.ticker === current) ? current : data.assets[0]?.ticker ?? '')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Local monitor API is not running.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadState()
    const timer = window.setInterval(() => { void loadState() }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const visible = assets.filter((asset) => (filter === 'All assets' || asset.category === filter) && `${asset.ticker} ${asset.name}`.toLowerCase().includes(query.toLowerCase()))
  const selected = assets.find((asset) => asset.ticker === selectedTicker) ?? assets[0]
  const last = selected?.prices[selected.prices.length - 1]
  const plan = selected?.prediction
  const target = plan?.targetPrice
  const progress = last && plan ? (last.close / plan.baselinePrice) * 100 : undefined
  const tracking = selected?.prices.filter((point) => !plan || point.date >= plan.baselineDate).map((point) => ({ ...point, label: dateLabel(point.date) })) ?? []
  const today = new Date().toISOString().slice(0, 10)
  const todaySnapshots = assets.filter((asset) => asset.prices.some((point) => point.date === today)).length
  const targetHits = assets.filter((asset) => asset.prediction?.outcome === 'hit').length

  const refreshQuotes = async () => {
    setBusy(true)
    setMessage('Requesting quotes from the no-key India market API…')
    try {
      const result = await api<{ captured: number; capturedAt: string }>('/api/refresh', { method: 'POST' })
      await loadState()
      setMessage(`${result.captured} quote${result.captured === 1 ? '' : 's'} captured at ${timeLabel(result.capturedAt)}.`)
    } catch (error) {
      await loadState()
      setMessage(error instanceof Error ? error.message : 'Quote request failed.')
    } finally {
      setBusy(false)
    }
  }

  const searchMarket = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSearchError('')
    try {
      const result = await api<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(ticker || company)}`)
      setSearchResults(result.results || [])
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Search failed. You can still add a known NSE/BSE ticker.')
      setSearchResults([])
    }
  }

  const addAsset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      await api('/api/watchlist', { method: 'POST', body: JSON.stringify({ ticker, name: company, category: assetCategory }) })
      setTicker('')
      setCompany('')
      setSearchResults([])
      setShowAdd(false)
      setMessage('Symbol added. Capture a quote to set its 2× monitoring baseline.')
      await loadState()
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Could not add that symbol.')
    }
  }

  const removeAsset = async (symbol: string) => {
    try {
      await api(`/api/watchlist/${encodeURIComponent(symbol)}`, { method: 'DELETE' })
      await loadState()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not remove symbol.')
    }
  }

  const saveEvidence = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) return
    try {
      await api('/api/evidence', { method: 'POST', body: JSON.stringify({ ticker: selected.ticker, summary: evidenceSummary, source: evidenceSource, url: evidenceUrl, stance }) })
      setEvidenceSummary('')
      setEvidenceSource('')
      setEvidenceUrl('')
      setShowEvidence(false)
      await loadState()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save evidence.')
    }
  }

  const removeEvidence = async (id: string) => {
    try {
      await api(`/api/evidence/${encodeURIComponent(id)}`, { method: 'DELETE' })
      await loadState()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not remove evidence.')
    }
  }

  const selectSearchResult = (result: SearchResult) => {
    setTicker(result.symbol)
    setCompany(result.company_name)
    setSearchResults([])
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Signal Desk home"><span className="brand-mark"><Activity size={17} /></span><span>SIGNAL<span className="brand-light">DESK</span></span></a>
        <div className="topbar-meta"><span className={`market-status ${health.providerStatus === 'connected' ? 'connected' : 'disconnected'}`}><i /> INDIA / {health.providerStatus === 'connected' ? 'FEED CONNECTED' : 'FEED OFFLINE'}</span><button className="icon-button" title="How monitoring works" onClick={() => window.alert('This records one provider quote per India trading date and stores it locally. The first successful quote sets a 2× target and starts a 63-trading-session monitor. It does not predict which stocks will double.') }><CircleHelp size={17} /></button></div>
      </header>

      <main id="top" className="page-content">
        <section className="page-heading">
          <div><p className="eyebrow">INDIA AI COMPUTE SUPPLY CHAIN / LIVE QUOTES</p><h1>Evidence over <span>guesswork.</span></h1><p className="heading-copy">Monitor semiconductor, electronics, AI compute, data-center and power-infrastructure suppliers in India.</p></div>
          <div className="heading-actions"><button className="button button-quiet" onClick={refreshQuotes} disabled={busy || !assets.length}><RefreshCw size={15} className={busy ? 'spin' : ''} /> Refresh quotes</button><button className="button button-primary" onClick={() => { setShowAdd((value) => !value); setSearchError('') }}><Plus size={17} /> Add symbol</button></div>
        </section>

        <div className={`connection-banner ${health.providerStatus === 'connected' ? 'is-connected' : 'is-offline'}`} role="status">
          <span className="connection-light" /><div><strong>{health.providerStatus === 'connected' ? 'Quote feed connected' : 'Quote feed unavailable'}</strong><span>{health.providerError || `Source: ${health.provider} · ${health.schedule}`}</span></div><small>{health.lastSuccessAt ? `Last success ${timeLabel(health.lastSuccessAt)}` : 'No successful quote capture yet'}</small>
        </div>
        {message && <div className="action-message" role="status">{message}<button className="icon-button tiny" title="Dismiss" onClick={() => setMessage('')}><X size={14} /></button></div>}

        <section className="method-strip"><div className="method-icon"><ShieldCheck size={18} /></div><div><strong>Monitoring target, not a model forecast.</strong><span>First successful quote sets the baseline and 2× target. The app records the outcome after 63 captured trading sessions; it does not rank or predict stocks.</span></div><span className="method-tag">DAILY SNAPSHOTS</span></section>

        {showAdd && <form className="add-form" onSubmit={addAsset}>
          <div className="form-heading"><div><span className="eyebrow">NSE / BSE WATCHLIST</span><h2>Add a symbol to monitor</h2></div><button className="icon-button" type="button" title="Close" onClick={() => setShowAdd(false)}><X size={18} /></button></div>
          <label>Ticker<input required value={ticker} onChange={(event) => setTicker(event.target.value)} placeholder="KAYNES.NS or NETWEB.NS" maxLength={32} /></label>
          <label>Company name<input value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Company or supplier name" /></label>
          <label>Theme<select value={assetCategory} onChange={(event) => setAssetCategory(event.target.value as Category)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
          <button className="button button-quiet search-symbol" type="button" onClick={() => void searchMarket(new Event('submit') as unknown as FormEvent<HTMLFormElement>)}><Search size={15} /> Search API</button>
          {searchResults.length > 0 && <div className="search-results">{searchResults.slice(0, 8).map((result) => <button key={result.symbol} type="button" onClick={() => selectSearchResult(result)}><strong>{result.symbol}</strong><span>{result.company_name}</span></button>)}</div>}
          {searchError && <p className="form-error">{searchError}</p>}
          <button className="button button-primary" type="submit"><Plus size={16} /> Add to monitoring</button>
        </form>}

        <section className="stat-row">
          <div className="stat-cell"><span>MONITORED SYMBOLS</span><strong>{String(assets.length).padStart(2, '0')}</strong><small>persisted on this computer</small></div>
          <div className="stat-cell"><span>CAPTURED TODAY</span><strong>{String(todaySnapshots).padStart(2, '0')}</strong><small>India market date</small></div>
          <div className="stat-cell"><span>ACTIVE 2× MONITORS</span><strong>{String(assets.filter((asset) => asset.prediction?.outcome === 'monitoring').length).padStart(2, '0')}</strong><small>63 captured-session horizon</small></div>
          <div className="stat-cell"><span>2× TARGET REACHED</span><strong>{String(targetHits).padStart(2, '0')}</strong><small>observed outcomes</small></div>
        </section>

        <section className="board-layout">
          <div className="watchlist-panel">
            <div className="section-heading"><div><span className="eyebrow">UNIVERSE</span><h2>Monitored list <span className="count-pill">{visible.length}</span></h2></div><div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find ticker" aria-label="Find ticker" /></div></div>
            <div className="category-tabs" role="tablist" aria-label="Filter by theme">{filters.map((item) => <button key={item} className={filter === item ? 'category-tab active' : 'category-tab'} onClick={() => setFilter(item)} role="tab" aria-selected={filter === item}>{item}</button>)}</div>
            <div className="table-scroll"><table className="watchlist-table"><thead><tr><th>Company / ticker</th><th>Last quote</th><th>3-month 2× target</th><th>Progress</th><th /></tr></thead><tbody>
              {visible.map((asset) => {
                const price = asset.prices[asset.prices.length - 1]
                const targetPlan = asset.prediction
                const progressValue = price && targetPlan ? (price.close / targetPlan.baselinePrice) * 100 : undefined
                const rate = estimateDoubleRate(asset.prices)
                return <tr key={asset.ticker} className={selected?.ticker === asset.ticker ? 'selected-row' : ''} onClick={() => setSelectedTicker(asset.ticker)}>
                  <td><div className="equity-cell"><span className={`ticker-mark ${asset.category.toLowerCase().replace(/\s/g, '-')}`}>{asset.ticker.slice(0, 2)}</span><div><strong>{asset.ticker}</strong><span>{asset.name}</span></div></div></td>
                  <td><div className="quote-cell"><strong>{money(price?.close)}</strong><span>{price ? dateLabel(price.date) : 'Awaiting first quote'}</span></div></td>
                  <td><div className="rate-cell"><strong>{money(targetPlan?.targetPrice)}</strong><span>{targetPlan ? `${dateLabel(targetPlan.baselineDate)} baseline` : 'Set on first quote'}</span></div></td>
                  <td><div className="rate-cell"><strong>{progressValue === undefined ? '--' : `${(progressValue - 100).toFixed(1)}%`}</strong><span>{targetPlan?.outcome === 'hit' ? 'Target reached' : targetPlan?.outcome === 'not_reached' ? 'Horizon ended' : `${asset.prices.length} snapshots${rate.windows ? ` · ${Math.round((rate.probability || 0) * 100)}% historical` : ''}`}</span></div></td>
                  <td><button className="icon-button remove-button light-remove" title={`Remove ${asset.ticker}`} onClick={(event) => { event.stopPropagation(); void removeAsset(asset.ticker) }}><Trash2 size={15} /></button></td>
                </tr>
              })}
              {!visible.length && <tr><td className="empty-cell" colSpan={5}>{loading ? 'Loading the persisted watchlist…' : 'No symbols monitored yet. Add an NSE/BSE ticker to start capturing daily quotes.'}</td></tr>}
            </tbody></table></div>
            <div className="table-footnote"><CircleHelp size={14} /> Historical hit rate appears only after enough real daily snapshots; it is not a forecast.</div>
          </div>

          <aside className="focus-panel">{selected ? <>
            <div className="focus-topline"><span className="eyebrow">SELECTED MONITOR</span><span className="monitor-state">{selected.prediction?.outcome === 'hit' ? 'TARGET HIT' : selected.prediction ? 'TRACKING' : 'WAITING FOR QUOTE'}</span></div>
            <div className="focus-identity"><span className={`ticker-mark large ${selected.category.toLowerCase().replace(/\s/g, '-')}`}>{selected.ticker.slice(0, 2)}</span><div><h2>{selected.ticker}</h2><p>{selected.name}</p></div></div>
            <div className="focus-tags"><span>{selected.category}</span><span>{selected.ticker.endsWith('.BO') ? 'BSE' : 'NSE'}</span></div>
            <div className="rate-hero"><div><span>LIVE QUOTE</span><strong>{money(last?.close)}</strong></div><span className="rate-sample">{last ? `As of ${timeLabel(last.capturedAt)}` : 'No real quote captured yet'}</span></div>
            <div className="focus-metrics"><div><span>BASELINE</span><strong>{money(plan?.baselinePrice)}</strong></div><div><span>2× TARGET</span><strong>{money(target)}</strong></div><div><span>OBSERVED MOVE</span><strong className={progress !== undefined && progress >= 200 ? 'positive' : ''}>{progress === undefined ? '--' : `${(progress - 100).toFixed(1)}%`}</strong></div></div>
            <div className="focus-actions"><button className="button button-outline" onClick={refreshQuotes} disabled={busy}><RefreshCw size={14} className={busy ? 'spin' : ''} /> Capture quote</button><button className="button button-outline" onClick={() => setShowEvidence((value) => !value)}><Plus size={15} /> Add evidence</button></div>
            {plan && <p className="plan-note">2× target is a tracking threshold set from the first quote, not an AI prediction. Horizon: 63 daily sessions.</p>}
          </> : <div className="empty-focus"><div className="empty-symbol">+ <span>2×</span></div><h2>Start a monitor</h2><p>Add an NSE/BSE ticker. Its first successful quote will be stored as the baseline.</p><button className="button button-primary" onClick={() => setShowAdd(true)}><Plus size={16} /> Add a symbol</button></div>}</aside>
        </section>

        {selected && <section className="lower-grid">
          <div className="monitor-panel"><div className="section-heading monitor-heading"><div><span className="eyebrow">DAILY QUOTE SNAPSHOTS / {tracking.length} POINTS</span><h2>Three-month outcome <span className="live-dot" /></h2></div><div className="monitor-summary"><strong>{progress === undefined ? '--' : `${progress.toFixed(1)}%`}</strong><span>of baseline price</span></div></div>
            {tracking.length > 1 ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={tracking.map((point) => ({ ...point, label: dateLabel(point.date) }))} margin={{ top: 14, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid vertical={false} stroke="#e9ece9" strokeDasharray="3 4" /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#858a83', fontSize: 11 }} minTickGap={32} /><YAxis tickLine={false} axisLine={false} tick={{ fill: '#858a83', fontSize: 11 }} width={68} tickFormatter={(value: number) => money(value)} domain={['auto', 'auto']} />
              <Tooltip formatter={(value) => money(Number(value))} contentStyle={{ border: '1px solid #e0e4dd', borderRadius: 4, fontSize: 12 }} />{target && <ReferenceLine y={target} stroke="#d76c48" strokeDasharray="5 5" label={{ value: '2× TARGET', fill: '#b95a3b', fontSize: 10, position: 'insideTopRight' }} />}
              <Line type="monotone" dataKey="close" name="Market quote" stroke="#087e72" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: '#087e72', stroke: '#fff', strokeWidth: 2 }} />
            </LineChart></ResponsiveContainer></div> : <div className="chart-empty"><Activity size={22} /><span>{tracking.length ? 'A second daily snapshot is needed to draw the outcome chart.' : 'No real quote snapshots yet. When the feed is available, capture a baseline to begin.'}</span></div>}
            <div className="chart-legend"><span><i className="legend-price" /> Stored provider quote</span><span><i className="legend-target" /> 2× baseline</span><small>One point per India market date · {health.provider}</small></div>
          </div>

          <div className="evidence-panel"><div className="section-heading evidence-heading"><div><span className="eyebrow">SOURCE LOG / {selected.evidence.length} ENTRIES</span><h2>Evidence trail</h2></div><button className="icon-button" title="Add evidence" onClick={() => setShowEvidence((value) => !value)}><Plus size={18} /></button></div>
            {showEvidence && <form className="evidence-form" onSubmit={saveEvidence}><label>Observation<textarea required value={evidenceSummary} onChange={(event) => setEvidenceSummary(event.target.value)} placeholder="What did the source report? Separate fact from interpretation." rows={3} /></label><div className="evidence-form-row"><label>Source<input required value={evidenceSource} onChange={(event) => setEvidenceSource(event.target.value)} placeholder="Exchange filing, company release…" /></label><label>Signal<select value={stance} onChange={(event) => setStance(event.target.value as Stance)}><option>Supports</option><option>Mixed</option><option>Contradicts</option></select></label></div><label>Source URL<input type="url" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="https://" /></label><button className="button button-primary" type="submit"><Check size={15} /> Save source note</button></form>}
            {selected.evidence.length ? <div className="evidence-list">{selected.evidence.map((item) => <EvidenceRow key={item.id} item={item} onRemove={() => void removeEvidence(item.id)} />)}</div> : <div className="evidence-empty"><div className="evidence-empty-icon"><ShieldCheck size={18} /></div><strong>No evidence logged yet</strong><p>Evidence notes are manual and saved with this local monitor. Add exchange filings or company announcements with links.</p><button className="text-button" onClick={() => setShowEvidence(true)}>Log first source <ArrowUpRight size={14} /></button></div>}
          </div>
        </section>}

        <footer className="page-footer"><span><ShieldCheck size={14} /> Monitoring tool only · no 2× prediction is being made</span><span>{assets.length} symbols / {assets.reduce((sum, asset) => sum + asset.prices.length, 0)} daily snapshots</span></footer>
      </main>
    </div>
  )
}

function EvidenceRow({ item, onRemove }: { item: Evidence; onRemove: () => void }) {
  const stanceClass = item.stance.toLowerCase()
  return <article className="evidence-item"><div className="evidence-item-top"><span className={`stance ${stanceClass}`}>{item.stance === 'Supports' ? <ArrowUpRight size={12} /> : item.stance === 'Contradicts' ? <ArrowDownRight size={12} /> : <Activity size={12} />}{item.stance}</span><time>{dateLabel(item.date)}</time><button className="icon-button tiny" title="Remove evidence" onClick={onRemove}><X size={14} /></button></div><p>{item.summary}</p><div className="evidence-source">{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.source}<ArrowUpRight size={12} /></a> : <span>{item.source}</span>}</div></article>
}

export default App
