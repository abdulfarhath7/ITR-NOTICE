# Litigation Command Center — user guide

Litigation Command Center (LCC) keeps every income tax notice, demand, filed return and filed form
for every client of the firm in one place, so nothing arrives unnoticed and
nothing is ever guessed.

It reads from the income tax portal. It never files, submits, uploads or
pays anything.

## The screens

| Screen | What it is for |
|---|---|
| **Attention** | Everything that needs action, ranked: overdue first, then limitation dates within 30 days, then due within 7 days, then open items with no stated date, then everything else open. Tiles at the top (Overdue, Due in 48h, No due date, Drafts to review) and the Issued and Due windows narrow the list with one click. |
| **Updates** | What the last sync found new or changed. |
| **Calendar** | Due dates on a month grid. |
| **Clients** | The client book: name, code, PAN, how each client is reached, open and overdue counts, last sweep. |
| **Client** | One client: counts at the top, then tabs for the profile, each module and notes. |
| **Item** | One proceeding, demand, return or form: its details, its documents, and the notice-and-response thread. |
| **Ingestion** | Start a sweep, answer the portal's OTP or captcha, watch progress, pause, resume. |
| **Devices** | The firm's devices, who collects, how far this device is behind, bundles in and out. |
| **Settings** | One section per concern down the left: General (theme, keyboard), Sweeps (cadence, unattended schedule), Drafting (the proxy), Notifications (the alert email), Data (folder, backup bundles), Firm and sync (this device on the relay), About. |

Press **Ctrl K** (⌘K on a Mac) anywhere to jump to a screen, find a client
by name, code or PAN, start a sweep or sync. In the Attention and Clients
lists the arrow keys move and Enter opens.

## The Attention screen

The line under the title says when the portal was last read and how many
runs failed; **Retry** takes you to the failed runs. The four tiles are the
things to act on today. Click one to see only those items; click it again to
see everything. The **Issued** and **Due** boxes split open items by how long
ago the notice came and how soon it is due. Pick one to narrow the list; the
numbers in the other boxes stay put so you can compare. Every filter you
pick shows as a chip with an ×; **Clear all** resets. Your filters are
remembered on this computer. **+ Save view** keeps the current filters under
a name, such as "Rao – scrutiny".

In the list, click the initials (or **Assign**) to give an item an owner.
Hover a row for **View**, **Draft**, **✦ Date** (ask for the due date in the
notice) and **Assign**. A small note icon means someone left a note.

## Updates

After every sync, Updates lists what is new: new notices, changed due dates,
responses filed on the portal, closed proceedings, changed demands, and
clients the sync could not read (with **Retry**, or **Fix** when the password
needs attention). **Mark all seen** clears the count in the sidebar on this
computer; seen items stay under "Seen earlier".

## Calendar

Each day shows how many open items fall due. Red days are past and still
open; amber is today and tomorrow. Switch to **Issued** to see when notices
arrived. Use the arrow keys to move and `t` for today. Items with no due date
are not on the calendar; the link at the top right lists them.

## A client's page

The top shows open notices, overdue items, the demand total, returns filed
and the last sync. The **Sync** switch leaves a client out of the full sweeps
(Sync now still works). Tabs hold the profile and password, each module,
and a notes box for the whole firm.

## Owners, notes and text size

Any item can have an owner and a note; both sync to every device. In a
draft, **Mark reviewed** tells the team it has been checked. **Settings ›
General › Text size** makes everything larger or smaller; **Ctrl +**,
**Ctrl −** and **Ctrl 0** do the same from anywhere.

## Getting started

1. **Create or join the firm** (Devices, or the welcome screen). The first
   device to create the firm becomes its admin and is shown a **recovery
   code once**. Write it down. It is the only way back if that laptop is
   lost. Other devices join with an invite the admin creates.
2. **Nominate the collector.** One device sweeps the portal for everyone.
   The admin picks it on the Devices screen. Someone must be at that machine
   while it sweeps, to clear the portal's OTP.
3. **Add clients.** By hand (Clients → Add) or from a CSV (Clients →
   Import). Typing a GSTIN fills in the PAN and the state; both stay
   editable.
4. **Store passwords.** On a client's page, under Portal access. Passwords
   go into the operating system's keychain only. A client reached through
   an Authorised Representative login needs none of its own — set "Reached
   through login" to that PAN instead.
5. **Sweep.** Ingestion → Start, or let it run by itself: Settings →
   Sweeps → Unattended sweep sets a time and days. If the portal asks for an OTP or
   a captcha, the run pauses, the app notifies you, and the sidebar shows
   *Run waiting for you*. Nothing times out and nothing is retried on its
   own.

## Reading a due date

| You see | It means |
|---|---|
| **Overdue by 3 days** | The stated date has passed and the item is still open. |
| **Due today** / **Due in 5 days** | Within a week. |
| **Due 22 Sep** | Later than a week. |
| **Closed · was due 2 Aug** | Settled. A closed item is never shown as overdue. |
| **Not stated** | The portal did not show a date. LCC never fills one in. |
| *suggested 30 Sep* (grey, italic) | An AI suggestion. It becomes a working date only when you press **Promote**. |
| **manual** | A date you entered yourself. It drives the list even when the portal states another date, which stays visible beside it. |

A **limitation date** is the statutory deadline for the proceeding itself,
not the reply deadline. The portal rarely states it; LCC shows "Not
stated" until a person enters it.

## What the marks mean

- **Unverified** — read by machine, not yet confirmed by a person. Every
  swept row starts this way.
- **Not stated** with the unverified mark — the portal did not display this
  field.
- **Credentials need attention** — the portal rejected a password. LCC
  never retries a password on its own; repeated attempts lock the taxpayer
  out of their account. Fix it on the client's page.

## Sync

The sidebar's **Sync** button has three states: *up to date*, *N changes
behind*, *cannot reach relay*. Next to it, separately, is when the
**collector last reported**. Both matter: a device can be fully up to date
while the collector has been switched off for a week, and LCC says so.

Without a relay, move the book between devices with a **bundle** (Devices →
Export bundle / Import bundle, or Settings → Data). A bundle is encrypted with a passphrase.
Importing merges — nothing is overwritten or deleted. Passwords are left out
unless you ask twice.

## What the nightly run fetches, and how to fetch more

The nightly run (Settings → Sweeps, default 01:00–06:00) reads only what the
dashboard needs:

- every item still open, re-checked for a new notice, a moved due date or a
  reply;
- anything new issued in the last 30 days.

It records each notice without downloading its PDF. Those items show a small
cloud icon. A client with no open items whose portal listing has not changed
is skipped in a few seconds. A client quiet for 90 days drops to a weekly
sweep (Sundays) until something changes. **Sync** shows tonight's order, what
each client did and what comes next. If the window closes mid-run, the rest
continues the next night from where it stopped.

To get more:
- **Open an item.** Its documents download then, automatically unless you
  turned that off, or with the **Fetch** button on the banner. Items due
  within a week are usually downloaded ahead of time when the night has time
  to spare.
- **Fetch history** on a client's page brings in older years for that one
  client: everything, the last few assessment years, or since a date. Choose
  index only or every PDF, and **Queue for tonight** or **Run now**. A new
  client can queue its full history from the add form.
- **Sync now** on a client, or **Sweep all now** on the Sync screen, runs a
  sweep straight away.

## Windows, risk and the two new columns

The Attention screen counts from today: Last 7 sits inside Last 15, which
sits inside Last 30, and the same for Due. Pick one Issued window and one
Due window; the line under the chips says exactly which dates are shown.
The four tiles at the top are the risks: overdue, due within three days,
a reply the AO has not viewed yet, and a limitation date within 60 days.

On assessment proceedings the table also shows **Viewed by AO** (`Yes ·
date` or `No` once a reply is filed) and **Limitation** (the date and the
days left, red inside 30 days). Other proceedings show a dash. The
limitation date is entered on the work item until the portal states it.
The **Type** pill names the notice (143(2) scrutiny, 148 reassessment,
271 penalty …), and the Type chip filters by it.

**Export · N rows** writes every row of the current view. The dialog shows
what will be exported, lets you untick columns, and previews the sheet.
Rows 1–4 of the sheet say which filter made it. **Export all clients** on
the Clients screen writes the registration fields; portal passwords are
never exported.

## The calendar: portal dates, your dates, and notices

The Calendar draws two layers on one month. **Statutory** dates come from
the Income Tax Department's public tax calendar (no login; refreshed
weekly, nightly around 1 April) and from the **firm dates** you add in
Settings → Calendar. **Notices** are your open items on their due day, as
before. Dots under a day show which categories fall there; the pill shows
how many notices are due.

The legend on the right counts this month by category. Click a row to
mute it, Shift-click to see only it, "Show all" to reset. The scope at the
top narrows to **Applies to us** (deadlines that match at least one
client's Calendar profile: entity type, books audited, transfer pricing,
TDS deductor, set on the client's Profile tab) or **Overdue**.

Click a day to see its agenda; press `t` for today, `[` and `]` to change
month, `F` (or the Full screen button) for the full-screen view with
Month, Year and Agenda (`1` `2` `3`), and Esc to leave it. An extended
deadline shows the old date struck through and the circular. When the
portal moves a date, Updates shows it under "Deadline extended".

The sidebar lists the next three deadlines; the Attention strip's "Next
statutory" tile names the nearest one. `.ics` (full screen or Settings →
Calendar) exports the statutory and firm dates for the year; notices are
never exported that way.

## Exports

Attention, Clients and a client's page each have **Export**. One workbook,
one sheet per module. The Proceedings sheet is the firm's 16-column format.
Rows 1–3 of every sheet say when the workbook was made and how current the
data was, so a stale export shows it on its face. A field the portal did not
state is an empty cell.

## Drafts

On an open notice, **Draft** asks the firm's drafting proxy for a summary,
a checklist of what the notice demands, and a draft reply, shown beside the
notice itself. It is a draft for a chartered accountant to review; fill in
every [bracket]. A draft is made once per notice. Submitted and closed items
offer no Draft, but View and Save are always there.

## When something goes wrong

- **The run is waiting** — look at Ingestion; the portal is asking for an
  OTP or a captcha.
- **A panel says "absent"** — that account has no such tab on the portal.
  LCC records that it looked, so a silent miss cannot hide.
- **Cannot reach relay** — the app works fully offline; sync when the
  network is back.
- **Lost the admin laptop** — on a new device: Devices → Set up sync →
  Recover admin, with the recovery code and the firm key from any other
  firm device's invite.
- **A device is lost or leaves the firm** — the admin removes it on
  Devices. Its relay access ends at once; its local book and keys are
  deleted the next time that device comes online with the app open. A
  device that never reconnects keeps its copy — the dialog says so.
- **The collector has gone quiet** — every device shows a banner, and
  everyone who gave an email address (Settings → Notifications) gets one
  message per missed run, at most one a day, plus one when it is back.

Nothing here is legal advice. Verify every figure against the portal.
