"""docs/08 "Server-enforced invariants": one admin, sweep publish needs the
lease, one lock per client, a removed device gets nothing. Plus the
bootstrap, recovery and handoff flows they sit on."""
import base64
import hashlib
import json
import os
import tempfile
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from nacl.signing import SigningKey

os.environ["RELAY_DB"] = os.path.join(tempfile.mkdtemp(), "relay-test.db")

from relay import alerts, db  # noqa: E402
from relay.main import app  # noqa: E402


class Device:
    def __init__(self, client: TestClient, name: str) -> None:
        self.client = client
        self.name = name
        self.key = SigningKey.generate()
        self.public_key = base64.b64encode(bytes(self.key.verify_key)).decode()
        self.id = ""
        self.firm_id = ""
        self.minted = "dev_" + hashlib.sha256(name.encode() + bytes(self.key.verify_key)).hexdigest()[:8]

    def _headers(self, method: str, path: str, body: bytes, extra: dict[str, str] | None = None) -> dict[str, str]:
        ts = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        msg = f"{method}\n{path}\n{ts}\n{hashlib.sha256(body).hexdigest()}".encode()
        sig = base64.b64encode(self.key.sign(msg).signature).decode()
        h = {"X-Timestamp": ts, "X-Signature": sig}
        if self.id:
            h["X-Device-Id"] = self.id
        if extra:
            h.update(extra)
        return h

    def call(self, method: str, path: str, json_body: Any = None, raw: bytes | None = None,
             extra: dict[str, str] | None = None) -> Any:
        body = raw if raw is not None else (json.dumps(json_body).encode() if json_body is not None else b"")
        headers = self._headers(method, path.split("?")[0], body, extra)
        if raw is None and json_body is not None:
            headers["Content-Type"] = "application/json"
        return self.client.request(method, path, content=body, headers=headers)


@pytest.fixture()
def firm() -> tuple[TestClient, Device, Device]:
    db.init()
    client = TestClient(app)
    admin = Device(client, "Partner laptop")
    r = admin.call("POST", "/v1/firms", {"name": "Example & Co", "device_id": admin.minted, "device_name": admin.name, "public_key": admin.public_key})
    assert r.status_code == 200, r.text
    admin.id, admin.firm_id = r.json()["device_id"], r.json()["firm_id"]
    inv = admin.call("POST", f"/v1/firms/{admin.firm_id}/invites").json()["invite_code"]
    member = Device(client, "Office PC")
    r = member.call("POST", f"/v1/firms/{admin.firm_id}/devices",
                    {"invite_code": inv, "device_id": member.minted, "device_name": member.name, "public_key": member.public_key})
    assert r.status_code == 200, r.text
    member.id, member.firm_id = r.json()["device_id"], admin.firm_id
    return client, admin, member


def test_exactly_one_admin(firm: tuple[TestClient, Device, Device]) -> None:
    _, admin, member = firm
    roster = admin.call("GET", f"/v1/firms/{admin.firm_id}/devices").json()
    admins = [d for d in roster["devices"] if d["permission"] == "admin"]
    assert len(admins) == 1 and admins[0]["id"] == admin.id
    # a member cannot make itself admin; the invite path never creates one
    assert member.call("POST", f"/v1/firms/{admin.firm_id}/invites").status_code == 403
    # transfer moves the single admin in one step
    r = admin.call("POST", f"/v1/firms/{admin.firm_id}/admin/transfer", {"device_id": member.id})
    assert r.status_code == 200
    roster = member.call("GET", f"/v1/firms/{admin.firm_id}/devices").json()
    admins = [d for d in roster["devices"] if d["permission"] == "admin"]
    assert len(admins) == 1 and admins[0]["id"] == member.id


def test_sweep_publish_requires_the_lease(firm: tuple[TestClient, Device, Device]) -> None:
    _, admin, member = firm
    blob = b"sealed-bytes"
    # nobody holds the lease: a sweep publish is refused, a user publish is not
    r = member.call("POST", f"/v1/firms/{admin.firm_id}/changesets", raw=blob,
                    extra={"X-Seq-From": "1", "X-Seq-To": "3", "X-Kind": "sweep"})
    assert r.status_code == 403
    r = member.call("POST", f"/v1/firms/{admin.firm_id}/changesets", raw=blob,
                    extra={"X-Seq-From": "1", "X-Seq-To": "3", "X-Kind": "user"})
    assert r.status_code == 200
    # the nominee claims the lease and may publish sweeps
    assert member.call("POST", f"/v1/firms/{admin.firm_id}/lease").status_code == 403, "not nominated yet"
    admin.call("POST", f"/v1/firms/{admin.firm_id}/collector", {"device_id": member.id})
    assert member.call("POST", f"/v1/firms/{admin.firm_id}/lease").status_code == 200
    r = member.call("POST", f"/v1/firms/{admin.firm_id}/changesets", raw=blob,
                    extra={"X-Seq-From": "4", "X-Seq-To": "9", "X-Kind": "sweep"})
    assert r.status_code == 200
    # the admin's device, not the holder, still cannot
    r = admin.call("POST", f"/v1/firms/{admin.firm_id}/changesets", raw=blob,
                   extra={"X-Seq-From": "1", "X-Seq-To": "1", "X-Kind": "sweep"})
    assert r.status_code == 403
    # streams must be contiguous
    r = member.call("POST", f"/v1/firms/{admin.firm_id}/changesets", raw=blob,
                    extra={"X-Seq-From": "12", "X-Seq-To": "12", "X-Kind": "user"})
    assert r.status_code == 409
    # fetch by cursor returns only what is new
    r = admin.call("GET", f"/v1/firms/{admin.firm_id}/changesets?cursor=" + json.dumps({member.id: 3}))
    got = r.json()["changesets"]
    assert [c["seq_from"] for c in got] == [4]
    assert r.json()["heads"][member.id] == 9


def test_lock_is_refused_while_held(firm: tuple[TestClient, Device, Device]) -> None:
    _, admin, member = firm
    key = hashlib.sha256(b"opaque client key").hexdigest()
    assert admin.call("POST", f"/v1/firms/{admin.firm_id}/locks/{key}").status_code == 200
    assert member.call("POST", f"/v1/firms/{admin.firm_id}/locks/{key}").status_code == 409
    assert admin.call("POST", f"/v1/firms/{admin.firm_id}/locks/{key}").status_code == 200, "renewable by the holder"
    admin.call("DELETE", f"/v1/firms/{admin.firm_id}/locks/{key}")
    assert member.call("POST", f"/v1/firms/{admin.firm_id}/locks/{key}").status_code == 200


def test_removed_device_gets_nothing_but_may_hand_over_its_pending_entries(firm: tuple[TestClient, Device, Device]) -> None:
    _, admin, member = firm
    assert member.call("GET", f"/v1/firms/{admin.firm_id}/devices").status_code == 200
    assert admin.call("DELETE", f"/v1/firms/{admin.firm_id}/devices/{member.id}").status_code == 200
    r = member.call("GET", f"/v1/firms/{admin.firm_id}/devices")
    assert r.status_code == 403 and "removed" in r.json()["detail"]
    assert member.call("GET", f"/v1/firms/{admin.firm_id}/changesets").status_code == 403
    assert member.call("POST", f"/v1/firms/{admin.firm_id}/lease").status_code == 403
    # Q16: the final push of what it wrote before removal is accepted
    r = member.call("POST", f"/v1/firms/{admin.firm_id}/changesets", raw=b"sealed",
                    extra={"X-Seq-From": "1", "X-Seq-To": "2", "X-Kind": "user"})
    assert r.status_code == 200
    # ...but a sweep publish still needs a lease it cannot hold
    r = member.call("POST", f"/v1/firms/{admin.firm_id}/changesets", raw=b"sealed",
                    extra={"X-Seq-From": "3", "X-Seq-To": "3", "X-Kind": "sweep"})
    assert r.status_code == 403


def test_recovery_code_makes_a_new_admin_once(firm: tuple[TestClient, Device, Device]) -> None:
    client, admin, _ = firm
    # register a second firm to get a code we know
    boot = Device(client, "Boot")
    r = boot.call("POST", "/v1/firms", {"name": "Second", "device_id": boot.minted, "device_name": "Boot", "public_key": boot.public_key}).json()
    boot.id, boot.firm_id = r["device_id"], r["firm_id"]
    code = r["recovery_code"]
    fresh = Device(client, "Replacement laptop")
    r = fresh.call("POST", f"/v1/firms/{boot.firm_id}/admin/recover",
                   {"recovery_code": "WRONG-CODE", "device_id": fresh.minted, "device_name": fresh.name, "public_key": fresh.public_key})
    assert r.status_code == 403
    r = fresh.call("POST", f"/v1/firms/{boot.firm_id}/admin/recover",
                   {"recovery_code": code, "device_id": fresh.minted, "device_name": fresh.name, "public_key": fresh.public_key})
    assert r.status_code == 200
    fresh.id = r.json()["device_id"]
    roster = fresh.call("GET", f"/v1/firms/{boot.firm_id}/devices").json()
    admins = [d["id"] for d in roster["devices"] if d["permission"] == "admin"]
    assert admins == [fresh.id]
    # the old code is spent
    again = Device(client, "Another")
    r = again.call("POST", f"/v1/firms/{boot.firm_id}/admin/recover",
                   {"recovery_code": code, "device_id": again.minted, "device_name": again.name, "public_key": again.public_key})
    assert r.status_code == 403
    assert admin.firm_id != boot.firm_id


def test_handoff_tells_the_holder_it_is_no_longer_nominee(firm: tuple[TestClient, Device, Device]) -> None:
    _, admin, member = firm
    admin.call("POST", f"/v1/firms/{admin.firm_id}/collector", {"device_id": member.id})
    assert member.call("POST", f"/v1/firms/{admin.firm_id}/lease").json()["still_nominee"] is True
    admin.call("POST", f"/v1/firms/{admin.firm_id}/collector", {"device_id": admin.id})
    renew = member.call("POST", f"/v1/firms/{admin.firm_id}/lease").json()
    assert renew["still_nominee"] is False
    # the new nominee cannot claim until the holder releases
    assert admin.call("POST", f"/v1/firms/{admin.firm_id}/lease").status_code == 409
    member.call("DELETE", f"/v1/firms/{admin.firm_id}/lease")
    assert admin.call("POST", f"/v1/firms/{admin.firm_id}/lease").status_code == 200


def test_silent_collector_emails_once_a_day_and_on_recovery(firm: tuple[TestClient, Device, Device]) -> None:
    _, admin, member = firm
    admin.call("POST", f"/v1/firms/{admin.firm_id}/me/email", {"email": "someone@example.com"})
    admin.call("POST", f"/v1/firms/{admin.firm_id}/collector", {"device_id": member.id})
    sent: list[tuple[list[str], str]] = []

    def fake(to: list[str], subject: str, body: str) -> None:
        sent.append((to, subject))

    def mine(actions: list[tuple[str, str]]) -> list[str]:
        # other tests' firms share the database; look only at this firm
        return [a for f, a in actions if f == admin.firm_id]

    later = datetime.now(UTC) + timedelta(hours=30)
    assert mine(alerts.run_once(now=later, sender=fake)) == ["silent"]
    ours = [s for s in sent if "someone@example.com" in s[0]]
    assert ours and "not reported" in ours[0][1]
    assert mine(alerts.run_once(now=later + timedelta(hours=1), sender=fake)) == []
    assert mine(alerts.run_once(now=later + timedelta(hours=25), sender=fake)) == ["silent"]
    # the collector reports (any signed call updates last_seen)
    member.call("GET", f"/v1/firms/{admin.firm_id}/lease")
    assert mine(alerts.run_once(now=datetime.now(UTC) + timedelta(minutes=1), sender=fake)) == ["recovered"]
    ours = [s for s in sent if "someone@example.com" in s[0]]
    assert "is back" in ours[-1][1]
