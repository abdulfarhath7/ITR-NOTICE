"""The v3 line protocol between the Rust core and this sidecar.

stdin, one JSON object per line (commands):
  {"cmd": "login", "login_ref": "...", "password": "..."}
  {"cmd": "challenge", "kind": "otp"|"captcha", "value": "..."}
  {"cmd": "list", "panel": "self:action", "client_pan": "...",
   "target": {"proceeding_name": "...", "assessment_year": "..."}|null}
                                  # target (v3): walk only the matching proceeding (item fetch)
  {"cmd": "probe", "panel": "self:action", "client_pan": "...", "pages": 2}      # v3
  {"cmd": "next", "action": "skip"|"fetch"|"index"|"stop"}   # reply to a "header"
                                  # index (v3): record the header, download nothing; the
                                  # sidecar answers with an "item" whose pdf_b64 is null
  {"cmd": "pace", "seconds": 0.4}
  {"cmd": "logout"}
  {"cmd": "stop"}

stdout, one JSON object per line (events):
  {"ev": "ready", "protocol": 2}
  {"ev": "log", "level": "info"|"warn"|"error", "msg": "..."}
  {"ev": "login_phase", "phase": "..."}
  {"ev": "challenge", "kind": "otp"|"captcha", "image_b64": "..."|null}
  {"ev": "login_ok"}
  {"ev": "login_failed", "reason": "wrong_password"|"timeout"|"error", "msg": "..."}
  {"ev": "panel_missing", "panel": "...", "msg": "..."}
  {"ev": "header", "panel": "...", "proceeding": {...}, "notice": {...}|null, "confidence": {...}}
  {"ev": "item", "reference_id": "...", "pdf_b64": "..."|null, "filename": "...", "note": "..."|null,
                 "indexed": bool}                    # indexed (v3): an answer to "index"
  {"ev": "panel_done", "panel": "...", "cards": n, "notices": n, "fetched": n, "skipped": n,
                       "stopped_early": bool, "note": "..."|null, "unidentified": n}
  {"ev": "probe_done", "panel": "...", "list_hash": "..."|null, "rows": n, "note": "..."|null}   # v3
                                  # list_hash is SHA-256 over each listed row's content hash, in
                                  # portal order, first `pages` pages; null when the probe failed
  {"ev": "viewport", "img": "<base64 jpeg>"}
  {"ev": "error", "kind": "...", "msg": "..."}

Rules: no PAN, name, password or OTP is ever written to a log line. Nothing
here touches a database. Nothing here clicks a control that writes to the
portal.
"""
import json
import sys
from typing import Any

PROTOCOL_VERSION = 3


def emit(ev: str, **payload: Any) -> None:
    payload["ev"] = ev
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(msg: str, level: str = "info") -> None:
    emit("log", level=level, msg=msg)
