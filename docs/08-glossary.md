# 08 · Glossary

## Domain (Indian income tax)
- **e-Proceedings** — the portal section (incometax.gov.in) where notices and
  responses live. The scraper walks it.
- **Notice u/s** — issued under a section: `143(2)` scrutiny, `142(1)` inquiry,
  `139(9)` defective return, `148` reassessment, `250` (CIT-A appeal stage).
- **PAN** — taxpayer's Permanent Account Number. **AY/FY** — assessment / financial year.
- **26AS / AIS** — the taxpayer's tax-credit statement / Annual Information Statement.
- **DSC** — Digital Signature Certificate (used to sign filings). **OTP** — one-time
  password for portal login; a human enters it, forwarded to the live browser.
- **ERI** — e-Return Intermediary framework (relevant only if/when filing via API).
- **Response / draft** — the reply to a notice; Claude drafts it, the human edits/files it.

## App terms
- **Sidecar** — the bundled Python backend the Tauri shell runs on loopback.
- **Sync / run** — one scrape of the portal (row in `runs`).
- **Proceeding** — a case; **notice** — a document within it; **ref_id** — a notice's
  unique reference id (primary key across the API).
- **Speed (Slow/Fast/Extreme)** — runtime pacing of the browser, changeable mid-sync.
