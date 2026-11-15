# Architecture

Cashflow is plain JavaScript with no dependencies and no build step beyond inlining. Classic scripts hang
off one global, `window.CF`, so `tools/build.mjs` can fold everything into a single HTML file that runs in
Muse's sandbox.

## Load order

`app/index.html` loads, in this order (the build inlines exactly these tags):

| File | Provides |
|---|---|
| `core/core.css`, `app/style.css` | Structural base, then the app's design tokens and Liquid Glass styling |
| `core/format.js` | `CF.fmt` (money in cents to `$1,234`, dates, hours) and `CF.h`, a tiny DOM builder |
| `core/data.js` | The setup, `CF.data` view-models and `CF.actions` writes (in memory) |
| `core/live.js` | Dev only: live timesheet sync through `tools/serve.mjs`. Does nothing without the dev token |
| `core/muse.js` | The Muse bridge: one `loadAll` at start, every write sent to `./actions` first |
| `core/xlsx.js` | `CF.xlsx`: Excel files built in the browser (claim, job hours, hourly log, yearly statement) |
| `core/viz.js` | `CF.viz`: Sankey, bars, year on year, sparklines, stacks, calendar |
| `core/ui.js` | `CF.ui`: theme, swipes, swipe rows, pull to sync, sheets, toasts, count-up numbers, period |
| `core/forms.js` | `CF.forms`: the entry sheets |
| `app/app.js` | The app: Home, Work, Money, More |

In local previews, `tools/serve.mjs` also loads `core/snapshot.local.js` and `core/templates.local.js`
(your own data and claim form, both gitignored) before `core/data.js`, when they exist.

## Data

Everything is computed from the setup plus raw months:

```
setup (what exists, labels, rates, pay rules)
months['YYYY-MM'] = { job: {timesheet, leave, expenses}, gig: {sessions}, hourly: {sessions}, statement }
sources (income the person adds in the app)
```

`CF.data.month('2026-11')` turns that into a view-model:

```js
{ key, label, long, isNow, isFuture, isSample, hasData,
  streams: [{ id: 'job' | 'gig' | 'hourly' | 'lumpsum' | 'dividends' | 'src-…', label, short, icon, kind, source, amount }],
  income, regular /* income without the lump sum */, expenses: { status, total, categories, source },
  invested, net /* null until spending has synced */, kept, savingsRate,
  job:    { entries, workedMin, expectedMin, daysIn, gross, deducted, net, projected, status, revision, leave, claims, started },
  gig:    { sessions, count, minutes, fees, claim: { due, payFrom, payTo, to } | null },
  hourly: { sessions, minutes, pay, rateCents, period: { first, last, label, payFrom, note } | null },
  lumpsum: { yearly, receiptMonth, amount }, dividends }
```

`CF.data.year(y)`, `yearPrev(y)`, `compare(cur, prev)`, `series(end, n)`, `range()` and `upcoming()` build
on it. Results are cached per month and the cache clears on every change (and when the day rolls over).
`CF.data.subscribe(fn)` fires after each change; the app re-renders then.

Pay rules live in `CF.data.rules`: worked minutes from a timesheet day, prorated monthly pay, a deduction
from gross pay, gig fees and claim dates, hourly pay and payouts that wait for the end of a period. Every
number in them comes from the setup; the code has no country's rules built in.

### Sample data

`CF.data.setSample(true)` (More → Sample data) fills months before the first real one with deterministic,
clearly flagged sample history, so trends can be previewed. With nothing set up it also uses a made-up
setup, so the whole app can be explored.

## Design rules

- One hero per screen, plain-English labels ("Spent", not "Outflows"), no filler copy.
- Tabular numerals for every figure; negative money uses a real minus sign.
- Touch targets of 44 px or more, press feedback on pointer-down, visible focus rings, `aria-label` on icon
  buttons, live regions for page changes.
- Motion is short and interruptible. Under Reduce Motion it becomes opacity only; under Reduce
  Transparency the glass gets frostier instead of solid.
- Checked at 375×812, 390×844, 430×932, 1280×800 and 1512×945, light and dark.
- No console errors, and `node tools/build.mjs` must pass (one file, no external references).

Liquid Glass styling follows Apple's iOS 26 language: on a phone, a glass tab bar with a draggable lens and
a round **+** beside it, with nothing floating at the top; on a laptop, a conventional full-width navbar.
