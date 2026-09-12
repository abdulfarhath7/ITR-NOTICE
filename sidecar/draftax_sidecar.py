"""Draftax ingestion sidecar - the portal automation as a child process.

The Rust core spawns this and talks to it over JSON lines (see
ingest/protocol.py). This process holds no database and no state beyond the
live browser session. Never print anything to stdout except JSON lines;
tracebacks go to stderr.
"""
import asyncio
import base64
import json
import sys
import threading
import traceback
from collections.abc import Coroutine
from typing import Any

from ingest.modules import list_module
from ingest.protocol import PROTOCOL_VERSION, emit, log
from ingest.session import IngestSession, Relay, WrongPasswordError
from ingest.walk import list_panel

VIEWPORT_INTERVAL = 1.5
VIEWPORT_QUALITY = 45


async def _viewport_loop(session: IngestSession) -> None:
    """Frames are withheld for the whole of login and the challenge waits
    (`safe_to_capture`), so a credential is never photographed."""
    while True:
        await asyncio.sleep(VIEWPORT_INTERVAL)
        page = session.page
        if page is None or not session.safe_to_capture() or session.page_closed():
            continue
        try:
            frame = await page.screenshot(type="jpeg", quality=VIEWPORT_QUALITY)
        except Exception:  # noqa: BLE001 - a navigation mid-shot is normal
            continue
        emit("viewport", img=base64.standard_b64encode(frame).decode("ascii"))


class Runner:
    def __init__(self) -> None:
        self.relay = Relay()
        self.session: IngestSession | None = None
        self.busy: asyncio.Task[None] | None = None
        self.watcher: asyncio.Task[None] | None = None

    async def _drop_session(self) -> None:
        if self.watcher:
            self.watcher.cancel()
            self.watcher = None
        if self.session:
            try:
                await self.session.stop()
            except Exception:  # noqa: BLE001 - tearing down a dead browser must not raise
                pass
            self.session = None

    async def login(self, login_ref: str, password: str) -> None:
        await self._drop_session()
        self.session = IngestSession(self.relay, login_ref, password)
        try:
            await self.session.start()
            self.watcher = asyncio.create_task(_viewport_loop(self.session))
            await self.session.login()
            emit("login_ok")
        except WrongPasswordError as e:
            emit("login_failed", reason="wrong_password", msg=str(e))
            await self._drop_session()
        except TimeoutError as e:
            emit("login_failed", reason="timeout", msg=str(e))
            await self._drop_session()
        except Exception as e:  # noqa: BLE001
            traceback.print_exc(file=sys.stderr)
            emit("login_failed", reason="error", msg=repr(e))
            await self._drop_session()

    async def list(self, panel: str) -> None:
        if not self.session:
            emit("error", kind="not_logged_in", msg="log in first")
            return
        try:
            if panel in ("demands", "returns", "forms"):
                await list_module(self.session, self.relay, panel)
            else:
                await list_panel(self.session, self.relay, panel)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            traceback.print_exc(file=sys.stderr)
            await self.session.save_debug_screenshot("panel")
            emit("error", kind="panel", panel=panel, msg=repr(e))

    async def logout(self) -> None:
        await self._drop_session()
        emit("logged_out")

    def spawn(self, coro: Coroutine[Any, Any, None]) -> None:
        if self.busy and not self.busy.done():
            emit("error", kind="busy", msg="a job is already running")
            coro.close()
            return
        self.busy = asyncio.create_task(coro)


def _stdin_reader(loop: asyncio.AbstractEventLoop, queue: asyncio.Queue[str | None]) -> None:
    for line in sys.stdin:
        loop.call_soon_threadsafe(queue.put_nowait, line)
    loop.call_soon_threadsafe(queue.put_nowait, None)


async def main() -> None:
    runner = Runner()
    queue: asyncio.Queue[str | None] = asyncio.Queue()
    loop = asyncio.get_running_loop()
    threading.Thread(target=_stdin_reader, args=(loop, queue), daemon=True).start()
    emit("ready", protocol=PROTOCOL_VERSION)

    while True:
        line = await queue.get()
        if line is None:
            break
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            emit("error", kind="bad_command", msg="unparseable command")
            continue
        kind = cmd.get("cmd")
        if kind == "login":
            runner.spawn(runner.login(str(cmd["login_ref"]), str(cmd["password"])))
        elif kind == "challenge":
            runner.relay.supply_challenge(str(cmd.get("value", "")).strip())
        elif kind == "list":
            runner.spawn(runner.list(str(cmd["panel"])))
        elif kind == "next":
            runner.relay.supply_verdict(str(cmd.get("action", "skip")))
        elif kind == "pace":
            runner.relay.set_pace(float(cmd.get("seconds", 0.4)))
        elif kind == "logout":
            runner.relay.cancel_waits()
            if runner.busy and not runner.busy.done():
                runner.busy.cancel()
            runner.spawn(runner.logout())
        elif kind == "stop":
            break
        else:
            emit("error", kind="bad_command", msg=f"unknown cmd {kind!r}")
            log(f"unknown command {kind!r}", "warn")

    runner.relay.cancel_waits()
    if runner.busy and not runner.busy.done():
        runner.busy.cancel()
    await runner._drop_session()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
