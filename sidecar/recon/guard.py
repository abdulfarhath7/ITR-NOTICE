"""The read-only guardrail for the cartographer.

The crawler clicks far more kinds of things than the scraper does, so it gets
a stricter rule: menu entries may be clicked (they only route), but inside a
page only tabs and an explicit allowlist of "view" controls are ever pressed.
Every click, menu or not, is also checked against DENY first.
"""
import re

from app.portal.scraper import FORBIDDEN

# Substrings. Anything that could change state on the portal, end the
# session, or send a message on the client's behalf.
DENY = tuple(sorted(set(FORBIDDEN) | {
    "submit", "respond", "reply", "appeal", "upload", "pay ", "pay now",
    "make payment", "e-verify", "everify", "verify", "withdraw", "logout",
    "log out", "sign out", "delete", "remove", "revoke", "disable",
    "deactivate", "confirm", "proceed", "save", "send", "raise", "generate",
    "create", "register", "apply", "add ", "update", "reset", "change",
    "link aadhaar", "start new filing", "file now", "resume filing",
    "agree", "accept", "approve", "reject", "download", "print",
    "seek adjournment", "video conferencing", "file response",
}))

# The whole label must match one of these for an in-page (non-menu) click.
IN_PAGE_ALLOW = re.compile(
    r"^(view( (notices?|details?|all|more|proceedings?|demand|status|"
    r"communications?))?|details|show more|more details|expand|"
    r"open|next|previous|>|<|»|«|\d{1,2})$",
    re.I)

# The security modal and similar dialogs: only these are ever pressed in them.
DISMISS = ("No", "NO", "Cancel", "Close", "OK", "Ok")


def norm(label: str) -> str:
    return " ".join((label or "").split()).strip()


def denied(label: str) -> bool:
    low = norm(label).lower()
    if low in ("yes", "y"):
        return True
    padded = f"{low} "
    return any(bad in padded for bad in DENY)


def menu_click_ok(label: str) -> bool:
    low = norm(label).lower()
    if not low or len(low) > 80:
        return False
    # Menu entries that only route are fine even if they contain "file" or
    # "pay" as a noun ("File Income Tax Return", "e-Pay Tax"); the pages they
    # open are start screens. Session-ending and state-changing entries are not.
    hard = ("logout", "log out", "sign out", "delete", "deactivate", "revoke",
            "disable", "withdraw")
    return not any(h in low for h in hard) and low not in ("yes", "y")


def in_page_click_ok(label: str) -> bool:
    lab = norm(label)
    return bool(lab) and not denied(lab) and bool(IN_PAGE_ALLOW.match(lab))
