"""Q17: one email per missed run, at most one per day, a recovery email
when the collector returns."""
from datetime import UTC, datetime, timedelta

from relay.alerts import decide


def test_silent_then_debounced_then_recovered() -> None:
    t0 = datetime(2026, 9, 12, 8, 0, tzinfo=UTC)
    seen = t0 - timedelta(hours=27)
    action, st = decide(t0, seen, None, None)
    assert action == "silent"
    # an hour later: still silent, no second email
    action, st = decide(t0 + timedelta(hours=1), seen, st["silent_since"], st["last_email_at"])
    assert action == "none"
    # a day later: one more
    action, st = decide(t0 + timedelta(hours=25), seen, st["silent_since"], st["last_email_at"])
    assert action == "silent"
    # collector reports again: a recovery email, state cleared
    action, st = decide(t0 + timedelta(hours=26), t0 + timedelta(hours=26), st["silent_since"], st["last_email_at"])
    assert action == "recovered"
    assert st["silent_since"] is None
    # healthy stays quiet
    assert decide(t0 + timedelta(hours=27), t0 + timedelta(hours=26), None, None)[0] == "none"


def test_never_seen_counts_as_silent() -> None:
    now = datetime(2026, 9, 12, 8, 0, tzinfo=UTC)
    assert decide(now, None, None, None)[0] == "silent"
