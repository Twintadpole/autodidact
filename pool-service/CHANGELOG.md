# Changelog

## Unreleased (November 2026)

### Beta: onboarding

- **Invite** (Team → add a login, or a new temporary password): opens the phone's share sheet with a
  ready message: the app's address, their login and the temporary password (copied when there's no share sheet).
- **Welcome screens** right after someone's first login (once they've chosen their own password):
  install the app and pick a language; "Your route" for techs, "Set up your business" for owners;
  working without signal and where Help is. Skip any time.
- **Getting started** card for owners at the top of the Route and the dashboard: business details,
  logo, chemical prices, customers, pools on the route, monthly rates, techs, installing the app. Each
  step ticks itself from the business's own data and opens its screen; Hide puts it away.
- **Beta tester guide** in Help (what to try, how to send feedback, your data, leaving).

### Beta: Help, feedback, error reports

- **Help** (More → Help, Help in the desktop menu): short how-tos for every part of the app, in all six
  languages, with a search box. The **?** at the top of each screen opens that screen's topic. Techs
  don't see the owner-only topics (money, invoices, team, import). Support email and
  "Great Pool Friend. Created by S R Donaldson, all rights reserved." at the bottom.
- **Send feedback** (More, Help, or the desktop menu): a problem, an idea, a question or other, sent
  with the person's name, the screen they came from, the app version and their language. With no
  signal it waits on the phone and is sent when the signal is back. Owners see everyone's feedback
  and can tick it done; techs see their own.
- **Errors the app runs into** are sent to the business's own server (no outside service), counted
  per kind of problem and version, and kept 60 days, so they can be found and fixed.
- A **Beta** label on the login screen, the More footer and the desktop header.
- Server: the database health check runs every 30 s instead of every 5 s (every 2 s while starting).

### Languages: English, Español, Tiếng Việt, 中文, Tagalog, العربية

- **The app speaks the person's language.** My account → Language: English, or (beta) Español,
  Tiếng Việt, 中文（简体）, Tagalog or العربية. Arabic screens are mirrored, right to left.
  The choice is saved to the login and follows the person to any phone or computer; before logging in,
  the app follows the phone's own language (the login screen has the picker too).
- Dates, times, numbers and money follow the language. Names, notes, addresses and other things people
  type are never translated; water tests keep their standard short names (FC, pH, CYA).
- Invoices and visit recaps stay in English for now (the customer's own language comes later).
- "Beta" means not yet checked by a native speaker.

### Great Pool Friend branding

- The app is now **Great Pool Friend** wherever a business hasn't set its own name: login screen, header,
  home-screen name and the More footer, with a placeholder icon (a wave in a blue circle).
- **Each business's own name and logo** from Business details: on the login screen (with "Powered by
  Great Pool Friend" under it) and as the home-screen name and icon when the app is installed. The icons
  are made from the uploaded logo by the server.
- `PRODUCT_NAME` (server setting) renames the product for one install.

### Logins, owner and tech roles, assigned routes

- **Each person has their own login** (email + password). Today's password becomes the first owner's
  login (login name "owner" until changed); phones already logged in stay logged in.
- **Team** (More → Team, or Team in the desktop menu): add a tech or another owner; they get a temporary
  password, shown once, and choose their own at first login. Reset a password, turn a login off (it's
  signed out everywhere), make someone an owner or a tech. There is always at least one active owner.
- **Routes:** each pool can be on a tech's route (Team → Route, or the pool's form). A tech's phone gets
  only their own pools, with those customers, visits, issues, photos and notes; a pool they add is on
  their route. Move a pool and it leaves the first tech's phone at its next sync. The owner's Route can
  show everyone's or one tech's, and shows whose route each pool is on.
- **Techs never get money:** no rates or billing, chemical prices or costs, invoices, payments, ledger,
  reports, dashboard, import/export or business settings beyond what visit recaps need. They can't delete
  customers or pools. Their chemical costs are worked out on the server. Techs may send visit recaps.
- **My account:** change your password (your other devices are signed out), see your devices and sign
  any of them out (a lost phone).
- A phone used by someone new clears the previous person's copy first; unsent changes are never thrown
  away without asking.
- The edit log records who made each change. A login locks for 15 minutes after 10 wrong passwords.

### Customer & pool import

- **Import customers and pools** from Excel or CSV (desktop view → Customers → Import). One row per pool;
  rows for the same customer become one customer with several pools. Columns are matched from their
  headings (change any); columns you don't match go into the customer's notes, or choose Ignore.
  A blank template is offered.
- Cleans up as it goes: phone numbers, service days ("Monday", "Mon", "M"), "$150", "12,000 gal", dates,
  one-line addresses, salt/chlorine, equipment columns (pump, filter, heater…). Anything it can't read
  is kept in the customer's notes and listed.
- A row with no name is named by its phone number, or else its address.
- **Customers already in the app are updated, not doubled:** empty fields are filled in, new phones,
  notes, pools and equipment are added. Where the app and the file disagree, the preview shows both
  and you pick, field by field (keeping yours is the default).
- **Preview first**, then everything goes in at once. **Undo** hides what an import added and puts
  back what it changed; anything used or edited since stays as it is. Every change is in the edit log.
- Reads the app's own "Export everything" file back, so a business can move between copies of the app.

### Polish

- Desktop view on a phone: the header keeps room for the page title (Cards and Phone view show as icons), and
  tables, filters and quick-entry rows fit the screen (a wide table scrolls sideways in its own box).
- Desktop menu: "1 issue", not "1 issues". Business details keeps a form width on a computer.

## v0.2.0 (November 18, 2026)

Fuller customer records, invoices and money tools, a desktop view with a card dashboard, and exports.
Phase 6 hardening (offsite backups, alerts, Cloudflare Access, SSH lockdown) went live in the same period.

### Phase 7E part 1, exports (November 2026)

- **Export on every desktop table** (Excel or CSV): what the table shows, with your search, filters, sort and
  columns. Dates come out as real dates and money as numbers, so a spreadsheet can add them up.
- **Export everything** (desktop menu, and More on the phone): one Excel file with a sheet each for customers,
  pools, equipment, visits, chemicals added, invoices, invoice lines, payments, expenses & income, mileage,
  chemicals, issues and notes. Your chemical costs are included (it's your file). Photos and receipts aren't.
- Full-screen dashboard cards export their table as Excel too.
- Excel files are made by the server (needs a connection); CSV is made on the device and works offline.

### Phase 7D part 3, more cards and full-screen tools (November 2026)

- **Six more cards:** Water problems (pools whose last visit had a reading way off, and which tests are off
  most), Customers (current, prospects, past, monthly rates, started/ended by month), Visit times (average
  visit by month and by customer), Mileage (miles and their worth by month), Equipment age (oldest first,
  flags anything over 8 years), System (backups, offsite copy, restore check, disk, open alerts, this device's sync).
- **Full-screen tools:** period (3, 6, 12 or 24 months), customer filter, number format ($1,234.56 / $1,235 /
  $1.2k), zoom into part of a chart (scroll or the slider), Columns to hide, and **Export CSV** of the card's table.
  Click a legend entry to hide or show that series.
- Server: the system status also reports the offsite copy, the restore check, disk space and open alerts
  (`deploy/monitor.sh` now leaves `backups/MONITOR_STATUS` for it).

### Phase 7D part 2, card dashboard (November 2026)

- **Dashboard of cards** (desktop view → Dashboard): Today & this week, Money (last 12 months), Owed to you
  (by how late), Per hour by customer (this or last month), Chemical costs (12 months, by chemical), Open issues.
- **Each card:** Small, Medium, Large or Full width; Move earlier / later or drag it by its title; hide it
  (and show it again from **Cards** at the top); **full screen**. Small cards show the key figures, bigger
  ones add a chart, and large ones add the table or list behind it.
- **The layout follows you** to any computer or phone (saved on the server, apart from business details).
  Reset to the usual layout from the Cards menu.
- Per hour and chemical costs need the server; with no connection they show the last figures loaded, with the
  time they're from. The other cards work offline.
- Charts: Apache ECharts.

### Phase 7D part 1, desktop view (November 2026)

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

### Phase 7C, money tools (November 2026)

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

### Phase 7B, invoices, chemical costs, visit recaps (November 2026)

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

### Phase 7A, fuller customer records (November 2026)

- **Only a customer's name is required now.** Address, phones, pool type, gallons and service day can all be left blank.
  A pool without a service day is listed under **Not scheduled** on the Route and isn't counted in the week.
- **Customer class: Current, Prospect or Past.** The Customers screen has filter buttons with counts; a search looks through all three.
  Prospects and past customers stay off the Route, the Issues tab and the weekly count; their history is kept.
  Existing customers are Current.
- **Billing and service details** (all optional): monthly rate, usual payment method, billing email, service start and end dates, distance from HQ.
- **Pool equipment** on the pool's overview: pump, filter, heater, salt cell/chlorinator, cleaner, automation, lights, timer, plus any other item with its own name.
  Each can have brand and model, serial number, install date, notes and photos.
- Additive only: existing records are unchanged.

### visit screen extras (November 2026)

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
