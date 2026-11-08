# Changelog

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
