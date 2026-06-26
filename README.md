# Fincas

A private, on-device **personal financial advisor**. Fincas gives you an
elegant cash-flow forecast, a monthly "money date" where you see where you
actually stand versus your plan, and a Claude assistant that can answer
questions about your finances — all without your financial data ever leaving
your device.

> **Privacy first.** Your accounts, transactions, and statements live in your
> browser's local storage and/or a JSON backup you keep on your device or in
> your own Google Drive. Nothing is sent to GitHub or any server we run. The
> only time data is transmitted is when *you* ask the assistant a question —
> that request goes directly from your browser to Anthropic's API using your
> own API key.

## Features

- **Cash-flow forecast** — a clean chart of your projected balance and monthly
  net for the next 12 months, plus the actual month-by-month numbers in a table.
- **Money date** — after each month, import your bank statement (CSV or PDF) and
  review actuals vs. your plan, broken down by category with variance bars.
- **Claude assistant** — ask things like *"what should I do about expenses
  coming up next month?"* The assistant sees a snapshot of your finances and
  answers with your real numbers.
- **Your plan** — accounts, recurring income & expenses, per-category budgets,
  and savings goals.
- **Beautiful, minimalist design** with an animated splash screen, installable
  as a PWA (app icon included).

## Privacy & storage

| Where your data can live | How |
| --- | --- |
| This device | Automatic — stored in your browser (`localStorage`). |
| Your Google Drive / a file | **Settings → Export backup** writes a JSON file you can keep anywhere and restore later with **Restore backup**. |
| GitHub | **Never.** A strict `.gitignore` also blocks `*.csv`, `*.pdf`, and backup files from ever being committed. |

Your Anthropic API key is stored only in this browser and is used to call
`api.anthropic.com` directly. No backend, no analytics, no tracking.

## Getting started

```bash
npm install
npm run icons   # generate PWA icons from the brand SVG (one-time)
npm run dev     # http://localhost:5173
```

Then in the app: open **Settings**, paste your Anthropic API key
(from console.anthropic.com), pick your currency, and either add your own plan
under **Plan** or click **Load sample data** to explore.

## Build & deploy

```bash
npm run build     # outputs static files to dist/
npm run preview   # preview the production build
```

`dist/` is a static site you can host anywhere (Netlify, Vercel, Cloudflare
Pages, your own server). For **GitHub Pages** under a project path, build with
the base path set:

```bash
FINCAS_BASE=/fincas/ npm run build
```

## Tech

React + TypeScript + Vite, Tailwind CSS, Recharts (charts),
`papaparse` + `pdfjs-dist` (statement parsing), the official
`@anthropic-ai/sdk` (assistant, default model `claude-opus-4-8`), and
`vite-plugin-pwa` (installable offline app).

## Project layout

```
src/
  lib/         types, storage, parsing, categorisation, forecast, Claude client
  components/  Splash, Dashboard, MoneyDate, Plan, Chat, Settings, ImportModal
  store.tsx    local data provider (persists to the browser)
  App.tsx      app shell + navigation
scripts/
  generate-icons.mjs   rasterises the brand SVG into PWA icons
```
