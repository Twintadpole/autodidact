# Changelog

## Unreleased: Phase 7D part 1, desktop view (November 2026)

- **More → Desktop view** switches to a layout for a computer; **Phone view** at the top switches back. Each
  device remembers its choice, so a computer opens straight to the desktop view. The phone app is unchanged.
- **Side menu:** Dashboard, Route, Customers, Visits, Invoices, Payments, Expenses & income, Mileage,
  Chemicals, Business details.
- **Tables** with search, sorting, a date filter (this/last month, this/last year, all), filter buttons with
  counts, a **Columns** button to show or hide columns (remembered on that computer) and a **totals row**.
- **Quick-entry row** above the table to add a customer, chemical, expense or income, miles, a draft invoice or a
  payment (the invoice's balance and the customer's usual method are filled in).
- **Click a row to edit it in a side panel** (the same fields as on the phone); invoices open the full invoice
  (lines, PDF, payments, mark sent, void).
- **Visits table:** every visit in the period from the server (with no connection, the visits on that device):
  time on site, readings (out-of-range ones in colour), chemicals and their cost (yours only).
- Dashboard: a few figures for now (this week, owed, profit this month, open issues); the card dashboard is next.

## Unreleased: Phase 7C, money tools (November 2026)

- **More → Money:** this month, last month, this year or last year: income (invoice payments when received,
  plus other income), expenses by category, profit, capital purchases (tools) shown separately, miles driven
  (and their value at your rate per mile), and what's still owed.
- **+ Expense:** amount, category (or your own), vendor, customer, note, receipt photo. **Supplies** for a
  customer can be added to their invoice (a line on their draft, at the amount you choose to bill).
- **+ Income** for money that didn't come through an invoice; **+ Miles** for each day's real driving
  (miles, or odometer start and end).
- **What you earn per hour, by customer, month by month:** the month's profit (billed − the whole month's
  chemicals − mileage estimate (2 × distance from HQ × your rate, per visit) − expenses for them) ÷ the
  month's hours on site = the average. Each visit's $/h = the month's profit split across its visits ÷ that
  visit's time. Visits without a timer use that pool's average time. The current month shows "In progress",
  past months are final; year views list the months. Lowest first. Needs a connection.
- Business details: rate per mile.
- Fixed: deleting a Supplies expense could fail to save.

## Unreleased: Phase 7B, invoices, chemical costs, visit recaps (November 2026)

- **One-time service date:** a pool's Service day can be "One-time date". It shows under that day in its week,
  under **Coming up** before then, and under **Past one-time** after.
- **Business details** (More → Business details): name, logo, phone, email, address, payment instructions,
  payment terms (due on receipt / net 15 / net 30), billing at the start or end of the month, first invoice number.
- **Chemical costs, for you only:** a price per unit on each chemical; each dose keeps its cost from when the
  visit was saved; visit details show the chemical cost. Never on invoices or recaps.
- **Invoices** (More → Invoices, and on each customer): monthly drafts for current customers with a rate,
  or one at a time; extra lines and a note; a PDF made on the phone and shared through Android's share menu;
  Mark sent; payments by check, cash, electronic or other (part payments too); Paid, Overdue and Void.
- **Visit recap** (only when you choose): tasks, water test and chemicals added (never cost), a note for the
  customer and the photos you pick; sent by email link or the share menu; the visit records when it was sent.
- Fixed: deleting a draft invoice could silently fail to save.

## Unreleased: Phase 7A, fuller customer records (November 2026)

- **Only a customer's name is required now.** Address, phones, pool type, gallons and service day can all be left blank.
  A pool without a service day is listed under **Not scheduled** on the Route and isn't counted in the week.
- **Customer class: Current, Prospect or Past.** The Customers screen has filter buttons with counts; a search looks through all three.
  Prospects and past customers stay off the Route, the Issues tab and the weekly count; their history is kept.
  Existing customers are Current.
- **Billing and service details** (all optional): monthly rate, usual payment method, billing email, service start and end dates, distance from HQ.
- **Pool equipment** on the pool's overview: pump, filter, heater, salt cell/chlorinator, cleaner, automation, lights, timer, plus any other item with its own name.
  Each can have brand and model, serial number, install date, notes and photos.
- Additive only: existing records are unchanged.

## Unreleased: visit screen extras (November 2026)

- New **Filter PSI** reading. It has no amber or red range, because normal pressure differs per filter.
- "Baskets emptied" is now two tasks: **Skimmer baskets** and **Pump basket**. Older visits still show "Baskets emptied".
- The customer's **pinned notes** (gate code, dog…) show on the visit screen, above the timer, next to the pool's access notes. The notes lists explain that the pin puts a note there.
- The previous-visit card shows its timer: start – end, pauses and how long they were, and time on site.
- Additive only: existing visits are unchanged.
- **Ready for the Cloudflare login (emailed code).** If that login expires while the app runs from the phone, a "Cloudflare login needed · Log in again" message shows on every screen instead of looking like no signal. Waiting changes stay on the phone and upload after you log in. (Fixed: the app's offline copy no longer intercepts Cloudflare's return step after the emailed code, which kept the login from being saved.)
- **Uploads can't get stuck any more.** Each upload has a time limit (1 minute, or 3 with photos). It shows "Timed out" on the Sync screen and is retried. If another tab has held the upload lock for 90 seconds (for example a tab Chrome paused mid-upload), this tab takes over. A repeated upload is still ignored by the server.

## v0.1.0-alpha (November 2026)

First version in daily use, at https://poolapp.evolutiondfw.com.

**In the field**
- Route list: pools grouped by service day with today first, weekly checkmarks, Reset week, open-issue badges, tap-to-navigate.
- Visit screen:
  - timer (Start, Pause/Resume, Stop) with editable times; "Done this week" in the same card
  - current-visit card with readings highlighted in amber or red when out of range, doses, tasks and a note
  - previous-visit card below it, with "Same as last time" for doses
- Issues: Eisenhower grid or list; Completed and Postpone; photos from the camera or gallery; "Save to pool" puts a photo in the pool's gallery.
- Customers and pools: search, call/text/Maps links, notes, add/edit/delete. Deleting hides everything under the customer or pool; nothing is erased.
- Pool Overview: details, trend charts, last 10 visits, open issues, a Photos card, notes.
- Visit history: every visit by date, opened in full (readings, doses, tasks, note, time on site), with Older/Newer and back to the pool.

**Works without signal**
- The phone keeps its own copy of the data. Changes queue in an outbox and upload when signal returns, in the background on Android.
- Retries are safe: the server recognizes a repeated upload, so nothing is applied twice.
- Unsaved visit typing is kept as a draft. Leaving the screen or switching apps saves the visit.
- Header chip shows Synced / N waiting / Offline. The Sync screen can Retry, Discard or Reload from the server.

**Behind the scenes**
- Every change is recorded in an edit log (what changed, from → to, when). A visit's History button shows it.
- Nightly database backups on the server.
- Every deploy takes a backup first and compares record counts before and after. A restore check proves the backups work.
- A "New version available · Refresh" message after each deploy.
- The version is shown at the bottom of the More screen.

**Known limits (planned)**
- Backups are on the same server for now. Encrypted offsite copies, alerts and security hardening come in Phase 6.
- No desktop layout yet (screens are capped at a readable width). Desktop layout, customer details and money tools with simple invoices come in Phase 7.
- HEIC photos (the phone camera's "High efficiency" setting) can't be read by the browser. Use the Camera button, or turn that setting off.
