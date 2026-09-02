"""SQLite storage. Schema mirrors exactly what the portal screens show.

Tables:
  proceedings - one row per proceeding card on the e-Proceeding list
  notices     - one row per notice inside a proceeding (View Notices page),
                PDF included: the file lives in the pdf_blob column, not on
                the filesystem, so the database is the whole archive
  runs        - one row per sync run, for the dashboard log
"""
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "itr.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS proceedings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tab             TEXT NOT NULL,             -- self | other_pan | auth_rep
    sub_tab         TEXT NOT NULL,             -- action | information
    proceeding_name TEXT,
    pan             TEXT,
    assessee_name   TEXT,
    assessment_year TEXT,
    financial_year  TEXT,
    applicable_act  TEXT,
    status          TEXT,                      -- Open | Closed | ...
    closure_date    TEXT,
    closure_order   TEXT,
    first_seen      TEXT DEFAULT (datetime('now')),
    last_seen       TEXT DEFAULT (datetime('now')),
    UNIQUE(tab, sub_tab, proceeding_name, pan, assessment_year)
);

CREATE TABLE IF NOT EXISTS notices (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    proceeding_id   INTEGER REFERENCES proceedings(id),
    ref_id          TEXT UNIQUE,               -- Notice/Communication Reference ID
    notice_us       TEXT,                      -- e.g. 250, 142(1), VC_APL
    doc_ref_id      TEXT,                      -- ITBA/NFAC/... document reference
    description     TEXT,
    issued_on       TEXT,
    served_on       TEXT,
    due_date        TEXT,                      -- NULL when portal shows none
    due_date_source TEXT,                      -- 'portal' | 'claude' | NULL
    ao_viewed_on    TEXT,
    pdf_path        TEXT,                      -- legacy: PDFs used to be files
    pdf_blob        BLOB,                      -- the PDF itself, one row = one file
    downloaded_at   TEXT,
    first_seen      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drafts (
    ref_id         TEXT PRIMARY KEY,          -- one draft per notice
    generated_at   TEXT DEFAULT (datetime('now')),
    summary        TEXT,                      -- plain-language: what is demanded
    checklist_json TEXT,                      -- JSON array of documents wanted
    draft_text     TEXT                       -- the reply, for the owner to edit
);

CREATE TABLE IF NOT EXISTS runs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    started        TEXT DEFAULT (datetime('now')),
    finished       TEXT,
    status         TEXT DEFAULT 'running',     -- running | done | failed
    message        TEXT,
    -- what the dashboard's "Last sync" line reads
    notices_new    INTEGER,                    -- notices never seen before
    pdfs_saved     INTEGER,                    -- PDFs fetched this run
    skipped_cached INTEGER                     -- already held, so not fetched
);
"""


# Columns added after the first release. The db file already exists on the
# owner's machine, so each one is added only if it is missing.
MIGRATIONS = {
    "notices": [
        # one line from Claude explaining where a due date came from
        ("due_date_basis", "ALTER TABLE notices ADD COLUMN due_date_basis TEXT"),
        # the PDF itself. Notices used to be files under NOTICES_DIR; the
        # database is the only copy now, so a backup is one file and moving
        # the app to another machine carries the documents with it.
        ("pdf_blob", "ALTER TABLE notices ADD COLUMN pdf_blob BLOB"),
    ],
    "runs": [
        # the counts behind the "Last sync" line
        ("notices_new", "ALTER TABLE runs ADD COLUMN notices_new INTEGER"),
        ("pdfs_saved", "ALTER TABLE runs ADD COLUMN pdfs_saved INTEGER"),
        ("skipped_cached", "ALTER TABLE runs ADD COLUMN skipped_cached INTEGER"),
    ],
}


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as con:
        con.executescript(SCHEMA)
        for table, columns in MIGRATIONS.items():
            have = {r["name"] for r in con.execute(f"PRAGMA table_info({table})")}
            for column, ddl in columns:
                if column not in have:
                    con.execute(ddl)
        absorbed = _absorb_pdf_files(con)
    # Only once those rows are committed does the file go. The order matters:
    # a crash in between leaves a duplicate, not a lost notice.
    for path in absorbed:
        try:
            path.unlink()
        except OSError:
            pass
    if absorbed:
        print(f"Moved {len(absorbed)} notice PDF(s) from disk into the database")


def _absorb_pdf_files(con) -> list[Path]:
    """One-time move of the old on-disk notices into pdf_blob.

    Idempotent: a row is only touched while it still has a path and no blob,
    and a file that has already gone is left alone rather than blanking the
    row. Returns the files that are now safe to delete.
    """
    done = []
    rows = con.execute("SELECT ref_id, pdf_path FROM notices "
                       "WHERE pdf_path IS NOT NULL AND pdf_blob IS NULL").fetchall()
    for row in rows:
        path = Path(row["pdf_path"])
        try:
            data = path.read_bytes()
        except OSError:
            continue
        if not data:
            continue
        con.execute("UPDATE notices SET pdf_blob=?, pdf_path=NULL WHERE ref_id=?",
                    (data, row["ref_id"]))
        done.append(path)
    return done


@contextmanager
def connect():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()


def upsert_proceeding(con, p: dict) -> int:
    # SQL treats NULL != NULL, so a proceeding without an assessment year
    # (like the Issue Letter in the recon) would duplicate on every sync.
    # Key fields are normalized to '' to keep the UNIQUE constraint honest.
    p = dict(p)
    for key in ("tab", "sub_tab", "proceeding_name", "pan", "assessment_year"):
        p[key] = p.get(key) or ""
    con.execute(
        """INSERT INTO proceedings
           (tab, sub_tab, proceeding_name, pan, assessee_name, assessment_year,
            financial_year, applicable_act, status, closure_date, closure_order)
           VALUES (:tab,:sub_tab,:proceeding_name,:pan,:assessee_name,
                   :assessment_year,:financial_year,:applicable_act,:status,
                   :closure_date,:closure_order)
           ON CONFLICT(tab, sub_tab, proceeding_name, pan, assessment_year)
           DO UPDATE SET status=excluded.status,
                         closure_date=excluded.closure_date,
                         last_seen=datetime('now')""",
        p,
    )
    row = con.execute(
        """SELECT id FROM proceedings
           WHERE tab=:tab AND sub_tab=:sub_tab AND proceeding_name=:proceeding_name
             AND pan=:pan AND assessment_year=:assessment_year""",
        p,
    ).fetchone()
    return row["id"]


def notice_exists(con, ref_id: str) -> bool:
    """The cache rule: if we already hold this notice, we never scrape it again."""
    return (
        con.execute("SELECT 1 FROM notices WHERE ref_id=? AND pdf_blob IS NOT NULL",
                    (ref_id,)).fetchone()
        is not None
    )


def get_notice_pdf(con, ref_id: str) -> bytes | None:
    row = con.execute("SELECT pdf_blob FROM notices WHERE ref_id=?",
                      (ref_id,)).fetchone()
    return row["pdf_blob"] if row else None


def upsert_notice(con, n: dict) -> None:
    con.execute(
        """INSERT INTO notices
           (proceeding_id, ref_id, notice_us, doc_ref_id, description,
            issued_on, served_on, due_date, due_date_source, ao_viewed_on,
            pdf_blob, downloaded_at)
           VALUES (:proceeding_id,:ref_id,:notice_us,:doc_ref_id,:description,
                   :issued_on,:served_on,:due_date,:due_date_source,:ao_viewed_on,
                   :pdf_blob, CASE WHEN :pdf_blob IS NULL THEN NULL
                                   ELSE datetime('now') END)
           ON CONFLICT(ref_id) DO UPDATE SET
               due_date=COALESCE(notices.due_date, excluded.due_date),
               pdf_blob=COALESCE(notices.pdf_blob, excluded.pdf_blob),
               downloaded_at=COALESCE(notices.downloaded_at,
                                      excluded.downloaded_at)""",
        n,
    )


def set_claude_due_date(con, ref_id: str, due_date: str, basis: str | None = None) -> None:
    """Fill a missing due date found by Claude. Never overwrites a portal date."""
    con.execute(
        """UPDATE notices SET due_date=?, due_date_source='claude', due_date_basis=?
           WHERE ref_id=? AND due_date IS NULL""",
        (due_date, basis, ref_id),
    )


def finish_run(con, run_id: int, status: str, message: str,
               counts: dict | None = None) -> None:
    """Close a run row and record what it actually did."""
    counts = counts or {}
    con.execute(
        """UPDATE runs SET finished=datetime('now'), status=?, message=?,
               notices_new=?, pdfs_saved=?, skipped_cached=? WHERE id=?""",
        (status, message, counts.get("new_notices"), counts.get("downloaded"),
         counts.get("skipped_cached"), run_id))


def last_run(con):
    """The most recent finished run - what the dashboard reports at the top."""
    return con.execute(
        "SELECT * FROM runs WHERE finished IS NOT NULL ORDER BY id DESC LIMIT 1"
    ).fetchone()


def get_notice(con, ref_id: str):
    return con.execute("SELECT * FROM notices WHERE ref_id=?", (ref_id,)).fetchone()


def get_draft(con, ref_id: str):
    return con.execute("SELECT * FROM drafts WHERE ref_id=?", (ref_id,)).fetchone()


def save_draft(con, ref_id: str, summary: str, checklist_json: str,
               draft_text: str) -> None:
    """One draft per notice; Regenerate deliberately overwrites it."""
    con.execute(
        """INSERT INTO drafts (ref_id, summary, checklist_json, draft_text)
           VALUES (?,?,?,?)
           ON CONFLICT(ref_id) DO UPDATE SET
               summary=excluded.summary,
               checklist_json=excluded.checklist_json,
               draft_text=excluded.draft_text,
               generated_at=datetime('now')""",
        (ref_id, summary, checklist_json, draft_text),
    )


def list_notices(con):
    """Everything the dashboard table needs - and never the blob itself, which
    would push megabytes of base64 through the JSON on every refresh. What the
    table actually wants is whether a PDF is held, not the PDF."""
    return con.execute(
        """SELECT n.id, n.proceeding_id, n.ref_id, n.notice_us, n.doc_ref_id,
                  n.description, n.issued_on, n.served_on, n.due_date,
                  n.due_date_source, n.due_date_basis, n.ao_viewed_on,
                  n.downloaded_at, n.first_seen,
                  n.pdf_blob IS NOT NULL AS has_pdf,
                  EXISTS(SELECT 1 FROM drafts d WHERE d.ref_id = n.ref_id)
                      AS has_draft,
                  p.proceeding_name, p.pan, p.assessment_year, p.status
           FROM notices n LEFT JOIN proceedings p ON p.id = n.proceeding_id
           ORDER BY n.due_date IS NULL, n.due_date"""
    ).fetchall()
