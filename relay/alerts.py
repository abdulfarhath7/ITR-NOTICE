"""Collector-silent alerting (task 12.10, Q17).

A collector that has not reported for more than SILENT_HOURS has missed a
scheduled run. Every device shows a banner on its own (client-side); this
module adds the email: one to every user of the firm when the collector
falls silent, at most one per day while it stays silent, and one when it
returns. The decision is a pure function so it can be tested with a clock
and a fake sender; SMTP settings come from the environment and, when they
are absent, the mail is logged rather than sent.
"""
from __future__ import annotations

import logging
import os
import smtplib
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from typing import Any

from . import db

log = logging.getLogger("relay.alerts")

SILENT_HOURS = 26          # one missed daily run plus grace (Q12, D-021)
DEBOUNCE_HOURS = 24        # at most one email per day while silent

Sender = Callable[[list[str], str, str], None]


def parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=UTC)
    except ValueError:
        return None


def decide(now: datetime, collector_last_seen: datetime | None, silent_since: datetime | None,
           last_email_at: datetime | None) -> tuple[str, dict[str, Any]]:
    """Returns (action, new_state). action ∈ none | silent | recovered."""
    silent = collector_last_seen is None or now - collector_last_seen >= timedelta(hours=SILENT_HOURS)
    if silent:
        since = silent_since or now
        due = last_email_at is None or now - last_email_at >= timedelta(hours=DEBOUNCE_HOURS)
        if due:
            return "silent", {"silent_since": since, "last_email_at": now}
        return "none", {"silent_since": since, "last_email_at": last_email_at}
    if silent_since is not None:
        return "recovered", {"silent_since": None, "last_email_at": None}
    return "none", {"silent_since": None, "last_email_at": last_email_at}


def smtp_sender(recipients: list[str], subject: str, body: str) -> None:
    host = os.environ.get("SMTP_HOST")
    if not host or not recipients:
        log.info("alert (no SMTP configured): %s -> %d recipient(s)", subject, len(recipients))
        return
    msg = EmailMessage()
    msg["From"] = os.environ.get("SMTP_FROM", "relay@localhost")
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    msg.set_content(body)
    port = int(os.environ.get("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=30) as smtp:
        if os.environ.get("SMTP_STARTTLS", "1") == "1":
            smtp.starttls()
        user, password = os.environ.get("SMTP_USER"), os.environ.get("SMTP_PASSWORD")
        if user and password:
            smtp.login(user, password)
        smtp.send_message(msg)


def fmt(ts: datetime | None) -> str | None:
    return ts.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z" if ts else None


def run_once(now: datetime | None = None, sender: Sender = smtp_sender) -> list[tuple[str, str]]:
    """One pass over every firm with a collector. Returns (firm_id, action)."""
    now = now or datetime.now(UTC)
    out: list[tuple[str, str]] = []
    with db.connect() as con:
        firms = con.execute(
            "SELECT f.id, f.name, d.id AS collector_id, d.name AS collector_name, d.last_seen "
            "FROM firms f JOIN devices d ON d.firm_id = f.id AND d.role = 'collector' AND d.removed_at IS NULL").fetchall()
        for f in firms:
            state = con.execute("SELECT silent_since, last_email_at FROM alerts WHERE firm_id = ?", (f["id"],)).fetchone()
            action, new = decide(now, parse(f["last_seen"]),
                                 parse(state["silent_since"]) if state else None,
                                 parse(state["last_email_at"]) if state else None)
            con.execute("INSERT INTO alerts (firm_id, silent_since, last_email_at) VALUES (?,?,?) "
                        "ON CONFLICT(firm_id) DO UPDATE SET silent_since = excluded.silent_since, last_email_at = excluded.last_email_at",
                        (f["id"], fmt(new["silent_since"]), fmt(new["last_email_at"])))
            if action == "none":
                continue
            recipients = [r["email"] for r in con.execute(
                "SELECT email FROM devices WHERE firm_id = ? AND removed_at IS NULL AND email IS NOT NULL AND email <> ''",
                (f["id"],))]
            if action == "silent":
                since = f["last_seen"] or "never"
                sender(recipients, f"[{f['name']}] collector has not reported",
                       f"The collector device \"{f['collector_name']}\" last reported at {since} (UTC). "
                       "Nothing new has been swept since. Being up to date with the relay does not mean the book is current.\n\n"
                       "Check that the machine is on, the app is open, and no login challenge is waiting on its Ingestion screen.")
            else:
                sender(recipients, f"[{f['name']}] collector is back",
                       f"The collector device \"{f['collector_name']}\" has reported again. Sweeps resume on schedule.")
            out.append((f["id"], action))
    return out
