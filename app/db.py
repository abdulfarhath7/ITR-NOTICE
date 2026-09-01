"""SQLite storage. Schema mirrors exactly what the portal screens show.

Tables:
  proceedings - one row per proceeding card on the e-Proceeding list
  notices     - one row per notice inside a proceeding (View Notices page)
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
    pdf_path        TEXT,
    downloaded_at   TEXT,
    first_seen      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    started   TEXT DEFAULT (datetime('now')),
    finished  TEXT,
    status    TEXT DEFAULT 'running',          -- running | done | failed
    message   TEXT
);
"""


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as con:
        con.executescript(SCHEMA)


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
        con.execute("SELECT 1 FROM notices WHERE ref_id=? AND pdf_path IS NOT NULL",
                    (ref_id,)).fetchone()
        is not None
    )


def upsert_notice(con, n: dict) -> None:
    con.execute(
        """INSERT INTO notices
           (proceeding_id, ref_id, notice_us, doc_ref_id, description,
            issued_on, served_on, due_date, due_date_source, ao_viewed_on,
            pdf_path, downloaded_at)
           VALUES (:proceeding_id,:ref_id,:notice_us,:doc_ref_id,:description,
                   :issued_on,:served_on,:due_date,:due_date_source,:ao_viewed_on,
                   :pdf_path, CASE WHEN :pdf_path IS NULL THEN NULL
                                   ELSE datetime('now') END)
           ON CONFLICT(ref_id) DO UPDATE SET
               due_date=COALESCE(notices.due_date, excluded.due_date),
               pdf_path=COALESCE(notices.pdf_path, excluded.pdf_path)""",
        n,
    )


def set_claude_due_date(con, ref_id: str, due_date: str) -> None:
    """Fill a missing due date found by Claude. Never overwrites a portal date."""
    con.execute(
        """UPDATE notices SET due_date=?, due_date_source='claude'
           WHERE ref_id=? AND due_date IS NULL""",
        (due_date, ref_id),
    )


def list_notices(con):
    return con.execute(
        """SELECT n.*, p.proceeding_name, p.pan, p.assessment_year, p.status
           FROM notices n LEFT JOIN proceedings p ON p.id = n.proceeding_id
           ORDER BY n.due_date IS NULL, n.due_date"""
    ).fetchall()
