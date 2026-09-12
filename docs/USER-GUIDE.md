# Litigation Command Center — user guide

Litigation Command Center (LCC) keeps every income tax notice, demand, filed return and filed form
for every client of the firm in one place, so nothing arrives unnoticed and
nothing is ever guessed.

It reads from the income tax portal. It never files, submits, uploads or
pays anything.

## The screens

| Screen | What it is for |
|---|---|
| **Attention** | Everything that needs action, ranked: overdue first, then limitation dates within 30 days, then due within 7 days, then open items with no stated date, then everything else open. |
| **Clients** | The client book: name, code, PAN, how each client is reached, open and overdue counts, last sweep. |
| **Client** | One client: years down the left, the four modules across. |
| **Item** | One proceeding, demand, return or form: its details, its documents, and the notice-and-response thread. |
| **Ingestion** | Start a sweep, answer the portal's OTP or captcha, watch progress, pause, resume. |
| **Devices** | The firm's devices, who collects, how far this device is behind, bundles in and out. |
| **Settings** | Sweep cadence, the drafting proxy, the data folder, appearance. |

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
5. **Sweep.** Ingestion → Start. Clear the OTP when the card appears. The
   sweep waits as long as it takes and retries nothing on its own.

## Reading a due date

| You see | It means |
|---|---|
| **Overdue by 3 days** | The stated date has passed and the item is still open. |
| **Due today** / **Due in 5 days** | Within a week. |
| **Due 22 Sep** | Later than a week. |
| **Closed · was due 2 Aug** | Settled. A closed item is never shown as overdue. |
| **Not stated** | The portal did not show a date. LCC never fills one in. |
| *suggested 30 Sep* (grey, italic) | An AI suggestion. It becomes a working date only when you press **Promote**, and only where the portal stated none. |
| **manual** | A date you entered yourself, where the portal stated none. |

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
Export bundle / Import bundle). A bundle is encrypted with a passphrase.
Importing merges — nothing is overwritten or deleted. Passwords are left out
unless you ask twice.

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

Nothing here is legal advice. Verify every figure against the portal.
