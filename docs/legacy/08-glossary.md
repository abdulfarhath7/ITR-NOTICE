# 08 · Glossary

## Domain (Indian income tax)
- **e-Proceedings** — the portal section (incometax.gov.in) where notices and
  responses live. The scraper walks it.
- **Notice u/s** — issued under a section: `143(2)` scrutiny, `142(1)` inquiry,
  `139(9)` defective return, `148` reassessment, `250` (CIT-A appeal stage).
- **PAN** — the taxpayer's Permanent Account Number, and also the portal user id.
  **AY/FY** — assessment / financial year.
- **26AS / AIS** — tax-credit statement / Annual Information Statement.
- **DSC** — Digital Signature Certificate. **OTP** — one-time password for portal
  login; a human types it and it is relayed into the live browser.
- **Response / draft** — the reply to a notice; Claude drafts it, the CA edits
  and files it.

## App terms
- **Sidecar** — `notice_scraper.exe`, the bundled Python child process.
- **Proxy** — `proxy/main.py` on your server; holds the Anthropic key and prompts.
- **Archive** — `archive.db`, the SQLCipher file that is the whole record.
- **Staging cache** — the sidecar's own SQLite; PDFs in it are scrubbed after
  handoff.
- **Proceeding** — a case; **notice** — a document within it; **ref_id** — a
  notice's unique reference, the key everywhere.
- **Bucket** — where a notice sits against its due date (overdue, due ≤3 days,
  ≤10, later, no date), computed in `src/lib/buckets.ts`.
- **Firm token** — the bearer token one CA firm uses against the proxy.
