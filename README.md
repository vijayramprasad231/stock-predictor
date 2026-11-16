# Signal Desk

Personal NSE equity monitoring for semiconductor/electronics companies and suppliers to AI compute, data centers and power infrastructure. General IT-services companies are excluded. The initial watchlist contains candidate names to research, not stock recommendations. It contains no fabricated prices.

## Run locally

```powershell
npm install
npm run dev
```

This starts the web UI and local Node API together. Keep the process running for scheduled quote capture. The dashboard also has a manual refresh action.

## Data source and limitations

Quotes come from the public `0xramm/Indian-Stock-Market-API`, which proxies Yahoo Finance. It needs no API key, but it is unofficial, can be unavailable or rate-limited, and has no uptime guarantee. Yahoo may change or restrict its endpoints. This is a personal monitoring tool, not an exchange-authorized feed. Verify important prices independently.

Symbols may use `.NS` for NSE or `.BO` for BSE. Search uses the upstream API; when it is unavailable, enter a known ticker manually. Daily quote snapshots and watchlist/evidence data are stored locally in `server/data/monitor.json`, which is git-ignored.

## Snapshot schedule

While the API process is running, it attempts one quote capture on weekdays after 15:45 India time. If the computer or process is off, that date will be missed; use the dashboard's Refresh quotes action to request a capture. The provider may return its latest available quote rather than a confirmed official close. Failed requests stay visibly unavailable; no synthetic prices are inserted.

## Three-month monitor

The first successful quote for a symbol records the baseline and a 2x target. The app stores one point per provider-reported India market date and reports whether the target was reached within 63 captured sessions (approximately three months). Missing market days, holidays, provider failures and missed scheduled runs reduce the observation count. The target is a tracking threshold, not a model forecast or recommendation. There is no predicted probability until a separately validated model and suitable historical data exist.

## Evidence trail

Evidence notes are manual: record the observation, source, optional URL, and whether it supports, contradicts, or is mixed. They are stored in the same local monitor file as the quotes. Back up that file privately if you need to preserve the monitoring history; never commit it or put personal data in this public repository.
