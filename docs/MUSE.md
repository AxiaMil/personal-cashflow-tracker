# Muse integration

Everything a Muse space needs to run Cashflow: how the page talks to the space, the **setup** object that
makes the app yours, and every **server action** with its exact shape.

`tools/reference-backend.mjs` is a working, in-memory version of every action below, and
`tools/test-muse.mjs` runs the real app code against it. When in doubt, the reference backend is the spec.

## The page

`dist/cashflow.html` is the whole front end: one self-contained HTML file built for Muse's sandbox.

- No network access except `./actions`, no external fonts, scripts or images (the build fails otherwise).
- No `localStorage`, cookies or routing. Everything that must last goes through an action.
- Follows the host's light or dark mode (`data-hatch-color-scheme`, the `hatch:space:theme` message) and
  keeps clear of `--header-height`, `--bottom-padding` and the safe areas.
- Phone (375–430 px) and desktop (1024 px and up) layouts. Swipes never start in the 24 px edge strips,
  which belong to the Muse app's back gesture.
- Excel exports download in the browser, so the space needs `allow-downloads`.

## Wire format

Each action is one request, the same one Muse's own generated spaces make:

```http
POST ./actions
content-type: application/json
x-request-id: <actionCallId>

{"action": "saveGigSession", "args": {"entry": {...}}, "actionCallId": "cf-..."}
```

The answer is JSON: `{"data": <result>}` on success, `{"error": "<message>"}` on failure. The error message
is shown to the person as it is, so write it for a human ("This timesheet is approved, so it can't be
changed"), not as a stack trace.

`core/muse.js` is the only file that makes these calls. If the space's runtime ever needs a different
envelope, that file is the one place to change.

### How the app uses them

- **Start-up is one call.** `loadAll` returns everything for about three years, so the first paint already
  has the person's data and the app never fires a request per month. While it waits (up to 1.5 s) it shows
  a quiet placeholder, then the real screen.
- **Writes go to Muse first.** The screen only changes once the action succeeds, so nothing is shown that
  wasn't saved. A refused write shows the error and changes nothing.
- **No extra reads after a write.** The app applies a successful write itself. The one exception is the job's
  timesheet forms: after a save it re-reads that one month to pick up the new revision and status.
- **Back after a while.** When the space comes back to the foreground after a minute or more, the app calls
  `loadAll` again, quietly.
- Any write may instead return fresh data in `loadAll`'s shape (`{months, ...}`); the app takes it as is.

## Setup

The app ships with nothing about any person in it. The setup says which income streams exist, what they're
called and how they pay. With no setup (`loadAll` returns `setup: null`) the app shows a blank slate.

There are five kinds of stream, at most one of each, plus any number of income sources the person adds
in the app. Leave a kind out (or set `"enabled": false`) and it disappears from every screen.

```json
{
  "version": 1,
  "currency": "USD",
  "timeZone": "America/Chicago",
  "paymentIdLabel": "Payment ID",
  "streams": {
    "job": {
      "label": "Acme Studio", "short": "Acme", "icon": "briefcase",
      "monthlyPayCents": 240000, "dayMinutes": 450,
      "deduction": { "label": "Pension", "rate": 0.05 },
      "system": "Acme Timesheets", "startMonth": "2026-03", "endMonth": null,
      "leave": true, "claims": true,
      "leaveTypes": [{ "code": "AL", "name": "Annual leave" }, { "code": "SL", "name": "Sick leave" }],
      "day": { "start": "09:00", "end": "17:00", "breakStart": "12:30", "breakEnd": "13:00" }
    },
    "gig": {
      "label": "Photography", "short": "Photo", "icon": "camera",
      "rateCents": 6000, "sessionMinutes": 90, "venue": "On location", "rateNote": "",
      "claim": { "to": "accounts@agency.example", "dueWorkingDay": 5, "payFromDay": 20, "payToDay": 25 },
      "claimForm": null,
      "presets": [{ "label": "Evening shoot", "start": "18:00", "sessions": 1, "remarks": "Evening shoot" }]
    },
    "hourly": {
      "label": "Tutoring", "short": "Tutoring", "icon": "book",
      "rateCents": 2800, "unitLabel": "Student", "payout": "monthly",
      "presets": [{ "label": "Lesson", "minutes": 60 }]
    },
    "lumpsum": { "label": "Annual bonus", "short": "Bonus", "icon": "award", "yearlyCents": 300000, "receiptMonth": 12 },
    "dividends": { "label": "Dividends", "short": "Dividends", "icon": "leaf", "source": "Brokerage" }
  },
  "expenses": { "label": "Spending app", "detail": "Personal" }
}
```

All money is **integer cents**. Months are `"YYYY-MM"`, days `"YYYY-MM-DD"`, times `"HH:MM"` (24-hour).

| Field | Meaning |
|---|---|
| `currency` | Shown in form labels ("Amount (USD)"). Amounts display with `$`. Default `USD`. |
| `timeZone` | IANA zone that decides what "today" is. Default: the device's. |
| `paymentIdLabel` | What the payment ID in the claim details is called (a payment handle, an IBAN). Default `Payment ID`. |
| **`job`** | A salaried job, paid monthly and prorated by hours: `monthlyPayCents × hours worked ÷ (weekdays × dayMinutes)`. Its days, leave and claims live in a timesheet system that the space syncs with. |
| `job.deduction` | Optional: a contribution taken off gross pay, such as a pension or social security. `{label, rate}` takes `rate × gross`. Optional tiers: nothing up to `freeUpToCents`; between that and `phaseInToCents`, `phaseInRate × (gross − freeUpToCents)` (whole units when `roundDownToDollar`); gross above `capCents` isn't counted. Leave out when nothing is taken. |
| `job.leaveTypes` | The leave types the timesheet system uses, `[{code, name}]`. Default: AL, MC and UL (annual, medical, unpaid). `PH` (public holiday) is always offered as a day code. |
| `job.system` | The timesheet system's name, used in the interface ("Saved to Acme Timesheets"). |
| `job.startMonth` / `endMonth` | Before or after these months there's no timesheet to show. Optional. |
| `job.day` | The usual day, used by the "Full day" and "Half day" presets. |
| `job.leave` / `claims` | Show the leave and work-claims cards. Default `true`. |
| **`gig`** | Work paid per session (lessons, shoots, shifts). Each session logs date, times, count, rate and venue. `rateNote` is an optional note shown with the rate. |
| `gig.claim` | Leave out if the work isn't claimed. Otherwise: who the claim goes to (`to`), the working day of next month it's due (`dueWorkingDay`), and the days of next month it's paid between (`payFromDay`, `payToDay`). Each part is optional. |
| `gig.claimForm` | Leave `null` for a clean claim workbook. To fill the person's own form instead, see [Claim templates](#claim-templates). |
| `gig.presets`, `hourly.presets` | Up to four quick-fill chips on the log form. Without them the app offers single/double (gig) or 1 h/2 h (hourly). |
| **`hourly`** | Work paid by the hour. `unitLabel` names the optional text field on each session (class, student, project). |
| `hourly.payout` | `"monthly"`, or for work paid in one block after a period ends: `{label, periods: [{from, to, paidIn}]}`, months 1–12. `label` follows the stream's name ("paid after the term"). A period paid in a month before its end (Sep–Dec paid in January) is paid the next year. Example: `{"label": "paid after the term", "periods": [{"from": 9, "to": 12, "paidIn": 1}, {"from": 1, "to": 4, "paidIn": 5}, {"from": 5, "to": 8, "paidIn": 9}]}`. |
| **`lumpsum`** | One payment a year (a bonus, grant or award). It counts in its `receiptMonth` (1–12, `0` = not set) but Home and the trends leave it out so one big month doesn't skew the rest. |
| **`dividends`** | Read-only, from `statement.dividendsCents`. `source` names where they come from. |
| `expenses` | Where spending comes from. Leave out if there's no spending source. |
| `label` / `short` | The full name ("Photography") and the short one for chips and charts ("Photo"). |
| `icon` | One of `briefcase` `timer` `hourglass` `camera` `book` `waves` `cap` `award` `leaf` `coin`. |
| `description` | Optional: overrides the one-line description the app writes for a stream. |

The app edits a few fields itself (the job's monthly pay, the lump sum's amount and month) by sending the
whole setup back through `saveSetup`. Keep any fields you add; the app round-trips what it doesn't know.

## Actions

| Action | Args | Returns |
|---|---|---|
| `loadAll` | `{from?, to?}` months, inclusive | `{setup, profile, sources, months, syncedAt}` (below) |
| `saveSetup` | `{setup}` | `{ok: true}` |
| `saveProfile` | `{fullName, bankAccount, paymentId}` | `{ok: true}` |
| `saveGigSession` / `deleteGigSession` | `{entry}` / `{id}` | `{ok: true}` |
| `saveHourlySession` / `deleteHourlySession` | `{entry}` / `{id}` | `{ok: true}` |
| `saveWorkEntry` | `{month, entry, previousDate?}` | `{ok: true}` |
| `deleteWorkEntry` | `{month, date}` | `{ok: true}` |
| `saveLeaveEntry` / `deleteLeaveEntry` | `{month, entry}` / `{month, id}` | `{ok: true}` |
| `saveExpenseEntry` / `deleteExpenseEntry` | `{month, entry}` / `{month, id}` | `{ok: true}` |
| `uploadAttachment` | `{kind: 'leave' \| 'expenses', month, name, type, base64}` | `{ok: true, id, name}` |
| `saveIncomeSource` / `deleteIncomeSource` | `{source}` / `{id}` | `{ok: true}` |
| `saveIncomeEntry` / `deleteIncomeEntry` | `{sourceId, entry}` / `{sourceId, id}` | `{ok: true}` |
| `refresh` | `{month}` | `{ok: true}`, or fresh data in `loadAll`'s shape |
| `getClaimTemplate` | `{}` | `{base64}` of an `.xlsx`, or `null` |

Saves are upserts by `id` (timesheet days by `date`). `saveWorkEntry` with a `previousDate` moves a day.

### `loadAll`

```js
{
  setup: { ... } | null,
  profile: { fullName, bankAccount, paymentId },        // printed on claim forms
  sources: [{ id, label, short, type: 'one-off' | 'monthly' | 'hourly' | 'session', rateCents, startMonth,
              entries: [{ id, date, amountCents, qty, note }] }],
  months: {
    'YYYY-MM': {
      job: { timesheet: Form, leave: Form, expenses: Form, pendingCount },  // the job's forms (any may be null)
      gig: { sessions: [GigSession] },
      hourly: { sessions: [HourlySession] },
      statement: { expensesStatus: 'ok' | 'none' | 'error', expenseCategories: [{ name, totalCents, count }],
                   expensesSyncedAt, investedCents, dividendsCents },
    },
  },
  syncedAt: ISO time of the last sync with outside services,
}
```

Leave a month or a part of it out when there's nothing there. A part that is present replaces what the app
had for that month; a part that's missing is left alone.

```js
GigSession    = { id, date, venue, timeIn, timeOut, sessionsCount, rateCents, remarks }
HourlySession = { id, date, module, timeIn, timeOut, minutes?, rateCents, remarks }   // minutes when there are no times
Form          = { entries: [...], status: 'draft' | 'signed' | 'approved' | ..., revision, syncedAt,
                  balances?: [{ type, entitlement, taken, balance }] }                 // balances: leave only
TimesheetDay  = { date, start, end, breakStart, breakEnd, overtimeMinutes, attendanceCode, privateRemarks }
LeaveEntry    = { id, type: <a code from job.leaveTypes>, from, to, days, reason, attachmentIds }
ExpenseEntry  = { id, date, description, amountCents, attachmentIds }                  // work claims
```

A form whose `status` isn't `draft` is read-only in the app. If the timesheet system refuses a write (a
signed form, or someone else changed it), return an error that says so; never retry on the person's behalf.

## Claim templates

By default a gig claim downloads as a clean workbook (sessions, totals and the person's claim details).
To fill the person's **own** claim form instead:

1. Ask them for the blank form as an `.xlsx` and return it from `getClaimTemplate` as base64.
2. Describe its cells in `setup.streams.gig.claimForm`:

```json
{
  "sheet": "xl/worksheets/sheet1.xml",
  "header": { "name": "B4", "bank": "B5", "paymentId": "E4", "month": "H4" },
  "rows": { "first": 8, "count": 30 },
  "columns": { "date": "A", "day": "B", "venue": "C", "timeIn": "D", "timeOut": "E",
               "hours": "F", "rate": "G", "fee": "H", "remarks": "I" },
  "totals": { "row": 38, "hours": "F", "fee": "H" },
  "rate": "session",
  "time": "24h",
  "filename": "Claim - {name} - {month}"
}
```

`header` cells take the claim details and the month (as a date). Each session fills one row from
`rows.first`, up to `rows.count` rows, in the given `columns` (leave a column out to skip it). `rate` is
`"hourly"` when the form wants a rate per hour (the app converts from the per-session rate) or `"session"`.
`time` is `"12h"` ("2:30 PM") or `"24h"` ("14:30"). The file keeps every style, merge and drawing of the original.

## Checking a space

After building the space, check:

- With no setup saved, Home says **Nothing set up yet**.
- With a setup, Home lists each stream by the person's own names, and Work has a switcher for each kind
  of work (none when there's only one).
- The **+** button lists exactly the configured streams, plus "New income source".
- Logging a session and deleting it both survive a reload of the space.
- More → Export downloads each file.
- Sync status in the navbar (desktop) or More (phone) says **Synced**, not **Preview**. "Preview" means the
  page couldn't reach `./actions`.
