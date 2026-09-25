# Context: the income tax portal, as captured live

Read this before writing or changing any code that drives
`eportal.incometax.gov.in`. It replaces guessing from screenshots with what
the portal actually rendered on 2026-09-23 for one company account.

---

## 1. What exists

| Where | What | In git |
|---|---|---|
| `docs/portal-map/README.md` | Every captured screen: click path, route, headings, write controls on it; every portal API endpoint seen | yes |
| `docs/portal-map/screens.json` | Per screen: controls (text, tag, stable selector, classes), form fields, table headers | yes |
| `docs/portal-map/api.json` | Per endpoint: method, path, request and response **shapes** (keys and types, no values) | yes |
| `data/portal-map/<run>/` | Raw captures: `page.html`, `inventory.json`, `aria.yaml`, `shot.png` per screen; every XHR body under `network/` | **no** — client data |
| `sidecar/recon/` | The crawler that produced them, and `recon.context` that generates `docs/portal-map/` | yes |

Everything under `docs/portal-map/` is generated. Regenerate, never
hand-edit (section 5).

## 2. How the portal behaves (confirmed live)

- **Navigate by menu clicks only.** Any URL or hash change raises
  `#securityReasonPopup` ("disabled Back, Forward and Refresh… Logout?").
  YES logs out. Answer No (`dismiss_security_popup`).
- **Menu labels carry Material icon words.** Top-level entries render as
  `expand_more e-File` and flip to `expand_less e-File` when open. Strip icon
  ligatures before matching a label (see `recon/crawler.py` `clean`).
- **Drill-down links are `span.hyperLink`, not buttons or anchors**:
  "View All", "View Details", "View more", "Download Intimation Order Dated …".
  `get_by_role("button")` will not find them.
- **Modal templates are pre-rendered inside cards.** Their text ("Yes", "No",
  `labels.intimation_status` keys) is in the DOM while invisible. Always
  check visibility, and ignore anything under `.modal`, `[role=dialog]`,
  `mat-dialog-container` when reading a card.
- **Session is ~15 min.** Re-login through `PortalSession.ensure_alive` is
  currently broken (the User ID page's Continue stays disabled). See
  `NOTES.md` "Findings from the first live capture".
- Login can answer "Request is not authenticated" (press Continue again) and
  "another session" (Login Here); both are handled in `app/portal/session.py`.
- Account-level banners appear on many screens (account deactivated by ITD,
  PAN inoperative, outstanding demand reminder, terms not accepted). They are
  dialogs with OK/Close/Continue and must be dismissed, not acted on.

## 3. Module pages (litigation scope)

| Module | Click path | Route | Card markup |
|---|---|---|---|
| e-Proceedings | Pending Actions › e-Proceedings | `/dashboard/eProceedings` | existing `CARD_JS` (`.body1` → `.heading5`), verified earlier |
| Filed returns | e-File › Income Tax Returns › View Filed Returns | `/dashboard/itrStatus` | `mat-card`; title `.contentHeadingText` "A.Y. 2025-26"; `.rightsideLabel` → `.fieldVal`; `.contentLabel` → `.leftSideVal`; timeline `.matStepStatus` + `.matStepDate`, newest first |
| Return detail | … › View Filed Returns › View Details (`span.hyperLink`) | `/dashboard/itrStatus/itrStatusViewLifeCycle` | life-cycle page, not yet parsed |
| Filed forms | e-File › Income Tax Forms › View Filed Forms | `/dashboard/statForms/viewFiledForms` | two levels: `mat-card.eachMatCardStyle` per form type (`.headFormNameStyle`, "View All") → `mat-card.subCard` per filing: `.thirdColKey` → `.thirdColValue`, filing date as `.leftColVal` above `.leftColKey`, ack number in two bare spans |
| Outstanding demand | Pending Actions › Response to Outstanding Demand | `/dashboard/response-to-outstanding-demand/master` | **not captured** — the account had none. Tabs "Latest Notice" / "Notices Issued Earlier" |
| Worklist | Pending Actions › Worklist | `/dashboard/foWorklist/worklist` | captured, not parsed |
| Rectification | Services › Rectification › (CPC order / CIT(A) order / request to AO) | `/dashboard/rectificationRequest`, `/dashboard/appealOrder`, `/dashboard/requestToAoSeekingRectification` | captured, not parsed |

Dates on returns and forms are written `Nov 28, 2023` or `28-Aug-2025`;
`src-tauri/src/dates.rs` reads both.

## 4. Write controls found — never click

The read-only rule (`CLAUDE.md` §4) is enforced by `FORBIDDEN` in
`sidecar/app/portal/scraper.py` and the stricter `DENY` in
`sidecar/recon/guard.py`. Controls that sit **next to** things we do read:

- Filed forms: **Withdraw** on every filing card (then "Confirm Withdrawal").
- Filed returns: **Download Intimation Order** can open "submit intimation
  order request?" **Yes / No**. Yes files a request with the department.
- e-Proceedings: File Appeal, Submit Response.
- Authorised Partners: Add CA, **Deactivate**, Add ERI.
- Profile: Change Password (a real form with Submit).

`write_controls_present` in `screens.json` lists them per screen.

## 5. Extending the map

Capture (needs the client's login; output goes to `data/`, gitignored):

    cd sidecar
    ITR_RECON_USER=… ITR_RECON_PASSWORD=… ../.venv/bin/python -m recon --portal itd --label <tag>
    # or only specific screens:
    … -m recon --portal itd --path "Pending Actions > Response to Outstanding Demand"

Regenerate the committed docs from one or more runs, scrubbing the client
names that appear in them:

    ../.venv/bin/python -m recon.context ../data/portal-map/<run> [...] \
        --scrub "<client name fragment>" --out ../docs/portal-map

Then grep `docs/portal-map/` for the client's name and PAN before committing.

**GST:** `recon --portal gst` opens a visible browser; a person logs in (the GST
portal always shows a captcha) and the crawl starts at the dashboard. Nothing
has been captured for GST yet.

## 6. Known gaps

1. Outstanding demand card markup (needs a client with a demand).
2. Grievances and Help menus (crawl stopped at the re-login failure).
3. Re-login after ~15 minutes.
4. Return life-cycle page and intimation orders are captured but not
   ingested; intimation orders (143(1)) are the litigation-relevant document
   on the returns page.
5. Only one account type (a company, self login) was captured. An ERI/CA
   login lists several clients and will render differently.
