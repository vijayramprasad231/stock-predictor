# Signal Desk

An evidence-first research dashboard for tracking NSE/BSE-listed equities across metals, AI and semiconductors.

## Run locally

```powershell
npm install
npm run dev
```

## Add price history

Add an Indian-listed equity using its Yahoo Finance symbol (`.NS` for NSE or `.BO` for BSE) and upload a CSV with `Date` and `Close` or `Adj Close` columns. Dates should be daily trading dates and prices should be positive numbers in the selected currency (INR by default). The app stores imported quotes and evidence notes in this browser's local storage; it does not fetch live market data or send the data to a service.

Import adjusted closing prices when available so splits and distributions are treated consistently. Use data you have the right to access and export.

## Historical 2x frequency

For each rolling 126-trading-session window, the app checks whether any subsequent close reached at least twice the first close. It displays the number of windows that reached that level divided by the number checked. Windows overlap, historical regimes change, and this frequency is not a forecast or investment recommendation. Less than 127 closes is shown as insufficient history.

## Evidence log

Add dated notes with a source label, optional URL, and whether the item supports, contradicts, or is mixed evidence for the thesis. Keep observed facts distinct from interpretation. Notes are saved locally in the browser.

The initial board is fabricated demo data and is labeled as such. Replace it with actual price history before relying on any displayed values.