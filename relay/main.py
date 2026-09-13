"""The Litigation Command Center relay (docs/03, docs/04, docs/08).

Dumb and blind: sealed blobs in, sealed blobs out by cursor, plus the
collector lease, per-client locks, the device roster and the admin rules.
The four invariants below are enforced here, not merely encouraged:

  - exactly one admin per firm;
  - a sweep changeset is accepted only from the lease holder;
  - a client lock is refused while another device holds it;
  - a removed device gets nothing.

Nothing in a request body is readable to this service except routing
metadata. No log line carries a blob.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey
from pydantic import BaseModel

from . import alerts, db

LEASE_HOURS = 24            # Q06
LOCK_SECONDS = 5 * 60       # docs/04
SIGNATURE_SKEW_SECONDS = 300
# Ledger entries carry rows and document metadata, never document bytes
# (docs/03), so a changeset is small; a snapshot is the compacted book.
MAX_CHANGESET_BYTES = int(os.environ.get("RELAY_MAX_CHANGESET_MB", "32")) * 1024 * 1024
MAX_SNAPSHOT_BYTES = int(os.environ.get("RELAY_MAX_SNAPSHOT_MB", "512")) * 1024 * 1024


async def _alert_loop() -> None:
    """Hourly: collector-silent emails (Q17). SMTP is blocking, so the pass
    runs on a worker thread and never stalls request handling."""
    while True:
        try:
            await asyncio.to_thread(alerts.run_once)
        except Exception:  # noqa: BLE001 - an alert pass must never take the relay down
            logging.getLogger("relay").exception("alert pass failed")
        await asyncio.sleep(3600)


@asynccontextmanager
async def _lifespan(_: FastAPI) -> AsyncIterator[None]:
    db.init()
    task = asyncio.create_task(_alert_loop())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="Litigation Command Center relay", docs_url=None, redoc_url=None, lifespan=_lifespan)


def now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def plus(seconds: int) -> str:
    return (datetime.now(UTC) + timedelta(seconds=seconds)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def audit(con: Any, firm_id: str, device_id: str | None, action: str, detail: str | None = None) -> None:
    con.execute("INSERT INTO audit (firm_id, device_id, action, detail, created_at) VALUES (?,?,?,?,?)",
                (firm_id, device_id, action, detail, now()))


# ---------------------------------------------------------------- auth

def canonical(method: str, path: str, timestamp: str, body: bytes) -> bytes:
    return f"{method}\n{path}\n{timestamp}\n{hashlib.sha256(body).hexdigest()}".encode()


def verify_signature(public_key_b64: str, signature_b64: str, message: bytes) -> bool:
    try:
        VerifyKey(base64.b64decode(public_key_b64)).verify(message, base64.b64decode(signature_b64))
        return True
    except (BadSignatureError, ValueError):
        return False


def check_timestamp(ts: str) -> None:
    try:
        t = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=UTC)
    except ValueError as e:
        raise HTTPException(401, "bad timestamp") from e
    if abs((datetime.now(UTC) - t).total_seconds()) > SIGNATURE_SKEW_SECONDS:
        raise HTTPException(401, "request timestamp is too far from now")


class Caller:
    def __init__(self, row: Any) -> None:
        self.id: str = row["id"]
        self.firm_id: str = row["firm_id"]
        self.permission: str = row["permission"]
        self.role: str = row["role"]
        self.name: str = row["name"]
        self.removed: bool = bool(row["removed_at"])


def _is_final_push(request: Request) -> bool:
    """A removed device may still hand over the entries it wrote before it
    was removed (Q16: push pending, then wipe). Nothing else."""
    return request.method == "POST" and request.url.path.endswith("/changesets")


async def caller(request: Request,
                 x_device_id: str = Header(default=""),
                 x_timestamp: str = Header(default=""),
                 x_signature: str = Header(default="")) -> Caller:
    """An enrolled, not-removed device with a valid signature over this
    request. Updates last_seen."""
    if not x_device_id or not x_signature:
        raise HTTPException(401, "device signature required")
    check_timestamp(x_timestamp)
    body = await request.body()
    with db.connect() as con:
        row = con.execute("SELECT * FROM devices WHERE id = ?", (x_device_id,)).fetchone()
        if row is None:
            raise HTTPException(401, "unknown device")
        if not verify_signature(row["public_key"], x_signature,
                                canonical(request.method, request.url.path, x_timestamp, body)):
            raise HTTPException(401, "bad signature")
        if row["removed_at"] and not _is_final_push(request):
            # The word "removed" is what the device keys its wipe on.
            raise HTTPException(403, "removed: this device was removed from the firm")
        if not row["removed_at"]:
            con.execute("UPDATE devices SET last_seen = ? WHERE id = ?", (now(), x_device_id))
        return Caller(row)


# FastAPI's idiom for a dependency default; one instance, not a call per signature.
CALLER = Depends(caller)


def require_firm(c: Caller, firm_id: str) -> None:
    if c.firm_id != firm_id:
        raise HTTPException(403, "not a device of this firm")


def require_admin(c: Caller) -> None:
    if c.permission != "admin":
        raise HTTPException(403, "admin only")


# ---------------------------------------------------------------- firms

class RegisterFirm(BaseModel):
    email: str | None = None
    name: str
    device_id: str           # minted by the device; its ledger stream is keyed by it
    device_name: str
    public_key: str          # base64 Ed25519 of the first device
    ram_mb: int | None = None


def _check_device_id(con: Any, device_id: str) -> None:
    if not device_id or len(device_id) > 64 or not all(ch.isalnum() or ch in "_-" for ch in device_id):
        raise HTTPException(400, "device id must be 1-64 characters of letters, digits, _ or -")
    if con.execute("SELECT 1 FROM devices WHERE id = ?", (device_id,)).fetchone():
        raise HTTPException(409, "a device with this id already exists")


@app.post("/v1/firms")
async def register_firm(body: RegisterFirm, request: Request,
                        x_timestamp: str = Header(default=""),
                        x_signature: str = Header(default="")) -> dict[str, Any]:
    """Bootstrap: the first device to activate becomes admin, recorded
    here. It signs this request with the key it is registering."""
    check_timestamp(x_timestamp)
    raw = await request.body()
    if not verify_signature(body.public_key, x_signature, canonical("POST", "/v1/firms", x_timestamp, raw)):
        raise HTTPException(401, "bad signature")
    firm_id = new_id("firm")
    device_id = body.device_id
    recovery = "-".join(secrets.token_hex(2) for _ in range(6)).upper()
    with db.connect() as con:
        _check_device_id(con, device_id)
        con.execute("INSERT INTO firms (id, name, admin_device_id, recovery_code_hash, created_at) VALUES (?,?,?,?,?)",
                    (firm_id, body.name.strip(), device_id, hash_code(recovery), now()))
        con.execute("INSERT INTO devices (id, firm_id, name, public_key, permission, role, ram_mb, email, enrolled_at, last_seen) "
                    "VALUES (?,?,?,?,'admin','normal',?,?,?,?)",
                    (device_id, firm_id, body.device_name.strip(), body.public_key, body.ram_mb, body.email, now(), now()))
        audit(con, firm_id, device_id, "firm_registered")
    # The recovery code is returned exactly once and stored only as a hash.
    return {"firm_id": firm_id, "device_id": device_id, "recovery_code": recovery}


@app.post("/v1/firms/{firm_id}/invites")
def create_invite(firm_id: str, c: Caller = CALLER) -> dict[str, str]:
    require_firm(c, firm_id)
    require_admin(c)
    code = secrets.token_urlsafe(18)
    with db.connect() as con:
        con.execute("INSERT INTO invites (code, firm_id, created_by, created_at) VALUES (?,?,?,?)",
                    (code, firm_id, c.id, now()))
        audit(con, firm_id, c.id, "invite_created")
    return {"invite_code": code}


class Enrol(BaseModel):
    email: str | None = None
    invite_code: str
    device_id: str
    device_name: str
    public_key: str
    ram_mb: int | None = None


@app.post("/v1/firms/{firm_id}/devices")
async def enrol_device(firm_id: str, body: Enrol, request: Request,
                       x_timestamp: str = Header(default=""),
                       x_signature: str = Header(default="")) -> dict[str, str]:
    check_timestamp(x_timestamp)
    raw = await request.body()
    if not verify_signature(body.public_key, x_signature,
                            canonical("POST", f"/v1/firms/{firm_id}/devices", x_timestamp, raw)):
        raise HTTPException(401, "bad signature")
    device_id = body.device_id
    with db.connect() as con:
        inv = con.execute("SELECT * FROM invites WHERE code = ? AND firm_id = ?", (body.invite_code, firm_id)).fetchone()
        if inv is None or inv["used_at"]:
            raise HTTPException(403, "invite is unknown or already used")
        _check_device_id(con, device_id)
        con.execute("INSERT INTO devices (id, firm_id, name, public_key, permission, role, ram_mb, email, enrolled_at, last_seen) "
                    "VALUES (?,?,?,?,'member','normal',?,?,?,?)",
                    (device_id, firm_id, body.device_name.strip(), body.public_key, body.ram_mb, body.email, now(), now()))
        con.execute("UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?", (device_id, now(), body.invite_code))
        audit(con, firm_id, device_id, "device_enrolled")
    return {"device_id": device_id}


@app.get("/v1/firms/{firm_id}/devices")
def roster(firm_id: str, c: Caller = CALLER) -> dict[str, Any]:
    require_firm(c, firm_id)
    with db.connect() as con:
        rows = con.execute("SELECT id, name, permission, role, ram_mb, enrolled_at, last_seen, removed_at "
                           "FROM devices WHERE firm_id = ? ORDER BY enrolled_at", (firm_id,)).fetchall()
        lease = con.execute("SELECT * FROM leases WHERE firm_id = ?", (firm_id,)).fetchone()
        nom = con.execute("SELECT device_id FROM nominations WHERE firm_id = ?", (firm_id,)).fetchone()
        heads = {r["device_id"]: r["seq_to"] for r in con.execute(
            "SELECT device_id, MAX(seq_to) AS seq_to FROM changesets WHERE firm_id = ? GROUP BY device_id", (firm_id,))}
        firm = con.execute("SELECT name, admin_device_id FROM firms WHERE id = ?", (firm_id,)).fetchone()
    return {
        "firm": {"id": firm_id, "name": firm["name"], "admin_device_id": firm["admin_device_id"]},
        "devices": [dict(r) | {"head": heads.get(r["id"], 0)} for r in rows],
        "lease": dict(lease) if lease else None,
        "nominee_id": nom["device_id"] if nom else None,
        "you": {"device_id": c.id, "permission": c.permission},
    }


class DeviceId(BaseModel):
    device_id: str


@app.post("/v1/firms/{firm_id}/collector")
def nominate_collector(firm_id: str, body: DeviceId, c: Caller = CALLER) -> dict[str, Any]:
    """Admin nominates the collector. The current holder finishes the
    client it is on, then releases (docs/04 handoff); the nominee may claim
    the lease once it is free."""
    require_firm(c, firm_id)
    require_admin(c)
    with db.connect() as con:
        target = con.execute("SELECT id, removed_at FROM devices WHERE id = ? AND firm_id = ?", (body.device_id, firm_id)).fetchone()
        if target is None or target["removed_at"]:
            raise HTTPException(404, "no such device in this firm")
        con.execute("INSERT INTO nominations (firm_id, device_id, updated_at) VALUES (?,?,?) "
                    "ON CONFLICT(firm_id) DO UPDATE SET device_id = excluded.device_id, updated_at = excluded.updated_at",
                    (firm_id, body.device_id, now()))
        con.execute("UPDATE devices SET role = CASE WHEN id = ? THEN 'collector' ELSE 'normal' END WHERE firm_id = ?",
                    (body.device_id, firm_id))
        audit(con, firm_id, c.id, "collector_nominated", body.device_id)
        lease = con.execute("SELECT device_id FROM leases WHERE firm_id = ?", (firm_id,)).fetchone()
    return {"nominee_id": body.device_id, "current_holder": lease["device_id"] if lease else None}


@app.delete("/v1/firms/{firm_id}/devices/{device_id}")
def remove_device(firm_id: str, device_id: str, c: Caller = CALLER) -> dict[str, str]:
    """Revokes relay access only. No remote wipe is promised (Q16)."""
    require_firm(c, firm_id)
    require_admin(c)
    if device_id == c.id:
        raise HTTPException(400, "an admin cannot remove its own device; transfer admin first")
    with db.connect() as con:
        con.execute("UPDATE devices SET removed_at = ? WHERE id = ? AND firm_id = ?", (now(), device_id, firm_id))
        con.execute("DELETE FROM leases WHERE firm_id = ? AND device_id = ?", (firm_id, device_id))
        con.execute("DELETE FROM locks WHERE firm_id = ? AND device_id = ?", (firm_id, device_id))
        audit(con, firm_id, c.id, "device_removed", device_id)
    return {"removed": device_id}


@app.post("/v1/firms/{firm_id}/admin/transfer")
def transfer_admin(firm_id: str, body: DeviceId, c: Caller = CALLER) -> dict[str, str]:
    """The old admin becomes a member in the same transaction. Exactly one
    admin, always."""
    require_firm(c, firm_id)
    require_admin(c)
    with db.connect() as con:
        target = con.execute("SELECT id, removed_at FROM devices WHERE id = ? AND firm_id = ?", (body.device_id, firm_id)).fetchone()
        if target is None or target["removed_at"]:
            raise HTTPException(404, "no such device in this firm")
        con.execute("UPDATE devices SET permission = 'member' WHERE firm_id = ? AND permission = 'admin'", (firm_id,))
        con.execute("UPDATE devices SET permission = 'admin' WHERE id = ?", (body.device_id,))
        con.execute("UPDATE firms SET admin_device_id = ? WHERE id = ?", (body.device_id, firm_id))
        audit(con, firm_id, c.id, "admin_transferred", body.device_id)
    return {"admin_device_id": body.device_id}


class Recover(BaseModel):
    email: str | None = None
    recovery_code: str
    device_id: str
    device_name: str
    public_key: str
    ram_mb: int | None = None


@app.post("/v1/firms/{firm_id}/admin/recover")
async def recover_admin(firm_id: str, body: Recover, request: Request,
                        x_timestamp: str = Header(default=""),
                        x_signature: str = Header(default="")) -> dict[str, str]:
    """A new device presents the recovery code and becomes the admin; the
    previous admin device becomes a member. A stolen laptop cannot lock a
    firm out of its own tool."""
    check_timestamp(x_timestamp)
    raw = await request.body()
    if not verify_signature(body.public_key, x_signature,
                            canonical("POST", f"/v1/firms/{firm_id}/admin/recover", x_timestamp, raw)):
        raise HTTPException(401, "bad signature")
    with db.connect() as con:
        firm = con.execute("SELECT recovery_code_hash FROM firms WHERE id = ?", (firm_id,)).fetchone()
    if firm is None or not hmac.compare_digest(firm["recovery_code_hash"], hash_code(body.recovery_code.strip().upper())):
        await asyncio.sleep(1)      # a wrong code costs the caller a second, not the event loop
        raise HTTPException(403, "recovery code does not match")
    with db.connect() as con:
        device_id = body.device_id
        _check_device_id(con, device_id)
        con.execute("UPDATE devices SET permission = 'member' WHERE firm_id = ? AND permission = 'admin'", (firm_id,))
        con.execute("INSERT INTO devices (id, firm_id, name, public_key, permission, role, ram_mb, email, enrolled_at, last_seen) "
                    "VALUES (?,?,?,?,'admin','normal',?,?,?,?)",
                    (device_id, firm_id, body.device_name.strip(), body.public_key, body.ram_mb, body.email, now(), now()))
        con.execute("UPDATE firms SET admin_device_id = ? WHERE id = ?", (device_id, firm_id))
        # The code is single use: rotate it and hand the new one back.
        new_code = "-".join(secrets.token_hex(2) for _ in range(6)).upper()
        con.execute("UPDATE firms SET recovery_code_hash = ? WHERE id = ?", (hash_code(new_code), firm_id))
        audit(con, firm_id, device_id, "admin_recovered")
    return {"device_id": device_id, "recovery_code": new_code}


# ---------------------------------------------------------------- lease

def _lease_row(con: Any, firm_id: str) -> Any:
    row = con.execute("SELECT * FROM leases WHERE firm_id = ?", (firm_id,)).fetchone()
    if row and row["expires_at"] <= now():
        con.execute("DELETE FROM leases WHERE firm_id = ?", (firm_id,))
        return None
    return row


@app.get("/v1/firms/{firm_id}/lease")
def get_lease(firm_id: str, c: Caller = CALLER) -> dict[str, Any]:
    require_firm(c, firm_id)
    with db.connect() as con:
        row = _lease_row(con, firm_id)
        nom = con.execute("SELECT device_id FROM nominations WHERE firm_id = ?", (firm_id,)).fetchone()
    return {"lease": dict(row) if row else None, "nominee_id": nom["device_id"] if nom else None}


@app.post("/v1/firms/{firm_id}/lease")
def claim_or_renew_lease(firm_id: str, c: Caller = CALLER) -> dict[str, Any]:
    """Claim (when free and this device is the nominee) or renew (when
    held by this device). Anything else is refused."""
    require_firm(c, firm_id)
    with db.connect() as con:
        nom = con.execute("SELECT device_id FROM nominations WHERE firm_id = ?", (firm_id,)).fetchone()
        row = _lease_row(con, firm_id)
        if row and row["device_id"] != c.id:
            raise HTTPException(409, "the lease is held by another device")
        if row is None and (nom is None or nom["device_id"] != c.id):
            raise HTTPException(403, "this device is not nominated as the collector")
        expires = plus(LEASE_HOURS * 3600)
        if row is None:
            con.execute("INSERT INTO leases (firm_id, device_id, nominee_id, issued_at, expires_at) VALUES (?,?,?,?,?)",
                        (firm_id, c.id, nom["device_id"] if nom else None, now(), expires))
            audit(con, firm_id, c.id, "lease_claimed")
        else:
            con.execute("UPDATE leases SET expires_at = ?, nominee_id = ? WHERE firm_id = ?",
                        (expires, nom["device_id"] if nom else None, firm_id))
        # A renewal tells the holder whether it is still the nominee; if not,
        # it drains the current client and releases (docs/04 handoff).
        still_nominee = nom is not None and nom["device_id"] == c.id
    return {"device_id": c.id, "expires_at": expires, "still_nominee": still_nominee}


@app.delete("/v1/firms/{firm_id}/lease")
def release_lease(firm_id: str, c: Caller = CALLER) -> dict[str, str]:
    require_firm(c, firm_id)
    with db.connect() as con:
        con.execute("DELETE FROM leases WHERE firm_id = ? AND device_id = ?", (firm_id, c.id))
        audit(con, firm_id, c.id, "lease_released")
    return {"released": c.id}


# ---------------------------------------------------------------- locks

@app.post("/v1/firms/{firm_id}/locks/{client_key}")
def acquire_lock(firm_id: str, client_key: str, c: Caller = CALLER) -> dict[str, Any]:
    require_firm(c, firm_id)
    with db.connect() as con:
        row = con.execute("SELECT device_id, expires_at FROM locks WHERE firm_id = ? AND client_key = ?",
                          (firm_id, client_key)).fetchone()
        if row and row["device_id"] != c.id and row["expires_at"] > now():
            raise HTTPException(409, "this client's session is in use by another device")
        expires = plus(LOCK_SECONDS)
        con.execute("INSERT INTO locks (firm_id, client_key, device_id, expires_at) VALUES (?,?,?,?) "
                    "ON CONFLICT(firm_id, client_key) DO UPDATE SET device_id = excluded.device_id, expires_at = excluded.expires_at",
                    (firm_id, client_key, c.id, expires))
    return {"client_key": client_key, "expires_at": expires}


@app.delete("/v1/firms/{firm_id}/locks/{client_key}")
def release_lock(firm_id: str, client_key: str, c: Caller = CALLER) -> dict[str, str]:
    require_firm(c, firm_id)
    with db.connect() as con:
        con.execute("DELETE FROM locks WHERE firm_id = ? AND client_key = ? AND device_id = ?", (firm_id, client_key, c.id))
    return {"released": client_key}


# ---------------------------------------------------------------- changesets

@app.post("/v1/firms/{firm_id}/changesets")
async def publish_changeset(firm_id: str, request: Request, c: Caller = CALLER,
                            x_seq_from: int = Header(default=0), x_seq_to: int = Header(default=0),
                            x_kind: str = Header(default="user")) -> dict[str, Any]:
    """The body is ciphertext. A sweep publish needs the lease."""
    require_firm(c, firm_id)
    if x_kind not in ("user", "sweep"):
        raise HTTPException(400, "kind must be user or sweep")
    if x_seq_to < x_seq_from or x_seq_from < 1:
        raise HTTPException(400, "bad sequence range")
    blob = await request.body()
    if not blob:
        raise HTTPException(400, "empty changeset")
    if len(blob) > MAX_CHANGESET_BYTES:
        raise HTTPException(413, f"changeset larger than {MAX_CHANGESET_BYTES // (1024 * 1024)} MB")
    with db.connect() as con:
        if x_kind == "sweep":
            lease = _lease_row(con, firm_id)
            if lease is None or lease["device_id"] != c.id:
                raise HTTPException(403, "sweep changesets are accepted only from the collector lease holder")
        head = con.execute("SELECT MAX(seq_to) FROM changesets WHERE firm_id = ? AND device_id = ?", (firm_id, c.id)).fetchone()[0] or 0
        if x_seq_from != head + 1:
            raise HTTPException(409, f"expected the stream to continue at {head + 1}")
        con.execute("INSERT INTO changesets (firm_id, device_id, seq_from, seq_to, kind, blob, created_at) VALUES (?,?,?,?,?,?,?)",
                    (firm_id, c.id, x_seq_from, x_seq_to, x_kind, blob, now()))
    return {"device_id": c.id, "head": x_seq_to}


@app.get("/v1/firms/{firm_id}/changesets")
def fetch_changesets(firm_id: str, cursor: str = "{}", limit: int = 50, c: Caller = CALLER) -> dict[str, Any]:
    """Everything after the cursor map, oldest first, as base64 blobs."""
    require_firm(c, firm_id)
    try:
        cur: dict[str, int] = json.loads(cursor)
    except json.JSONDecodeError as e:
        raise HTTPException(400, "cursor must be a JSON object") from e
    with db.connect() as con:
        rows = con.execute("SELECT id, device_id, seq_from, seq_to, kind, blob, created_at FROM changesets "
                           "WHERE firm_id = ? ORDER BY id", (firm_id,)).fetchall()
        heads = {r["device_id"]: r["seq_to"] for r in con.execute(
            "SELECT device_id, MAX(seq_to) AS seq_to FROM changesets WHERE firm_id = ? GROUP BY device_id", (firm_id,))}
        collector = con.execute("SELECT id, last_seen FROM devices WHERE firm_id = ? AND role = 'collector' AND removed_at IS NULL",
                                (firm_id,)).fetchone()
    out = []
    for r in rows:
        if r["seq_to"] <= cur.get(r["device_id"], 0):
            continue
        out.append({"device_id": r["device_id"], "seq_from": r["seq_from"], "seq_to": r["seq_to"], "kind": r["kind"],
                    "blob_b64": base64.b64encode(r["blob"]).decode("ascii"), "created_at": r["created_at"]})
        if len(out) >= limit:
            break
    return {"changesets": out, "heads": heads, "more": len(out) >= limit,
            "collector": {"device_id": collector["id"], "last_seen": collector["last_seen"]} if collector else None}


@app.get("/v1/firms/{firm_id}/heads")
def heads(firm_id: str, c: Caller = CALLER) -> dict[str, Any]:
    require_firm(c, firm_id)
    with db.connect() as con:
        hs = {r["device_id"]: r["seq_to"] for r in con.execute(
            "SELECT device_id, MAX(seq_to) AS seq_to FROM changesets WHERE firm_id = ? GROUP BY device_id", (firm_id,))}
        collector = con.execute("SELECT id, last_seen FROM devices WHERE firm_id = ? AND role = 'collector' AND removed_at IS NULL",
                                (firm_id,)).fetchone()
    return {"heads": hs, "collector": {"device_id": collector["id"], "last_seen": collector["last_seen"]} if collector else None}


# ---------------------------------------------------------------- snapshots

@app.post("/v1/firms/{firm_id}/snapshot")
async def publish_snapshot(firm_id: str, request: Request, c: Caller = CALLER,
                           x_cursor: str = Header(default="{}")) -> dict[str, Any]:
    require_firm(c, firm_id)
    blob = await request.body()
    if not blob:
        raise HTTPException(400, "empty snapshot")
    if len(blob) > MAX_SNAPSHOT_BYTES:
        raise HTTPException(413, f"snapshot larger than {MAX_SNAPSHOT_BYTES // (1024 * 1024)} MB")
    with db.connect() as con:
        con.execute("INSERT INTO snapshots (firm_id, device_id, cursor, blob, created_at) VALUES (?,?,?,?,?)",
                    (firm_id, c.id, x_cursor, blob, now()))
        # keep the latest three
        con.execute("DELETE FROM snapshots WHERE firm_id = ? AND id NOT IN "
                    "(SELECT id FROM snapshots WHERE firm_id = ? ORDER BY id DESC LIMIT 3)", (firm_id, firm_id))
    return {"ok": True}


@app.get("/v1/firms/{firm_id}/snapshot/latest")
def latest_snapshot(firm_id: str, c: Caller = CALLER) -> Response:
    require_firm(c, firm_id)
    with db.connect() as con:
        row = con.execute("SELECT cursor, blob, created_at FROM snapshots WHERE firm_id = ? ORDER BY id DESC LIMIT 1",
                          (firm_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "no snapshot yet")
    return Response(content=row["blob"], media_type="application/octet-stream",
                    headers={"X-Cursor": row["cursor"], "X-Created-At": row["created_at"]})


# ---------------------------------------------------------------- refresh requests (ERI clients)

@app.post("/v1/firms/{firm_id}/refresh/{client_key}")
def request_refresh(firm_id: str, client_key: str, c: Caller = CALLER) -> dict[str, Any]:
    """A laptop asks the collector to refresh one ERI client (docs/06)."""
    require_firm(c, firm_id)
    with db.connect() as con:
        con.execute("INSERT INTO refresh_requests (firm_id, client_key, requested_by, created_at) VALUES (?,?,?,?)",
                    (firm_id, client_key, c.id, now()))
    return {"queued": client_key}


@app.get("/v1/firms/{firm_id}/refresh")
def take_refresh_requests(firm_id: str, c: Caller = CALLER) -> dict[str, Any]:
    require_firm(c, firm_id)
    with db.connect() as con:
        lease = _lease_row(con, firm_id)
        if lease is None or lease["device_id"] != c.id:
            raise HTTPException(403, "only the collector takes refresh requests")
        rows = con.execute("SELECT id, client_key, requested_by, created_at FROM refresh_requests "
                           "WHERE firm_id = ? AND taken_at IS NULL ORDER BY id", (firm_id,)).fetchall()
        con.execute("UPDATE refresh_requests SET taken_at = ? WHERE firm_id = ? AND taken_at IS NULL", (now(), firm_id))
    return {"requests": [dict(r) for r in rows]}


class Email(BaseModel):
    email: str | None = None


@app.post("/v1/firms/{firm_id}/me/email")
def set_my_email(firm_id: str, body: Email, c: Caller = CALLER) -> dict[str, str | None]:
    """Where this device's user wants collector-silent alerts (Q17)."""
    require_firm(c, firm_id)
    with db.connect() as con:
        con.execute("UPDATE devices SET email = ? WHERE id = ?", ((body.email or "").strip() or None, c.id))
    return {"email": (body.email or "").strip() or None}


@app.get("/healthz")
def healthz() -> dict[str, bool]:
    return {"ok": True}
