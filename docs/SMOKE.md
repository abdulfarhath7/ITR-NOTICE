# Manual smoke checklist

From `docs/12-testing.md`. Run after any significant change, on the
machine and OS the firm uses. Tick what passed; note what did not in
`NOTES.md`.

1. **App starts, database opens.** `npm run tauri dev` (or the installer's
   shortcut). The window opens on the welcome screen the first time and on
   Attention after that. `archive.db` under the app-data folder refuses to
   open in plain `sqlite3` — that is the encryption working.
2. **Add a client from a GSTIN; PAN derives correctly.** Clients → Add →
   type a 15-character GSTIN: PAN fills with characters 3–12, the state with
   characters 1–2; both stay editable; Add succeeds; the client appears in
   the book with a masked PAN.
3. **Start a run; the operator challenge appears and the queue waits.**
   Store a password on the client (Portal access), Ingestion → Start.
   The OTP card appears; do nothing for a minute — the run does not fail,
   time out or retry. Enter the OTP; the sweep continues through all six
   panels, absent ones recorded with a zero count in Sweep history.
4. **A notice appears with its PDF; View and Save both work.** Open the
   item from Attention; the document shows in the preview; Open hands it to
   the OS viewer; Save writes it where you choose.
5. **A closed notice shows View and Save but no Draft.** Find a closed
   proceeding in the client's page (closed items are not on Attention).
   The status pill says Closed; the due reads "Closed · was due …", never
   overdue; View and Save present, Draft absent.
6. **Export to Excel; the 16 columns are in the right order.** Attention →
   Export → current view. Row 5 of the Proceedings sheet reads S.No, Client
   ID, Client Name, PAN, Self/Other, AY, Type, Assessee Name, Section,
   Proceeding Name, DIN, Issued On, Response Due Date, Manual Due Date,
   Response Submitted On, Client File #. Rows 1–3 carry the
   provenance block. Dates sort as dates; a missing date is an empty cell.
7. **Sync on a second device; the behind-count drops to zero.** Devices →
   Set up sync → Create firm on device A (write the recovery code down),
   Invite a device, Join on device B. B shows "N changes behind", Sync,
   then "up to date"; the client book matches. The collector line stays a
   separate fact beside the button.
8. **Change the collector; the lease moves.** As admin, pick another
   device's radio on Devices. The old holder finishes the client in
   progress and stops; the new one's next whole-book sweep syncs first,
   then runs. The roster shows "lease held" moving.

Also worth a glance each time:

- The Attention count in the header equals the sum of the five tiles, and
  clicking a tile narrows the list to that rank; the sidebar badge shows
  the overdue count.
- Ctrl+K opens the palette; typing a client's code finds it; Esc closes
  and focus returns to where it was.
- Settings → General → System follows the OS theme; every settings
  section shows its save bar only after a change and clears it on Save.
- No due cell anywhere shows a bare negative number.
- Nothing in the run log shows a PAN, a name or a password; PANs are
  masked as `AABCV••••K`.
