# Kickoff prompt

Paste this into Claude Code at the repository root, once the bundle is in
place. Nothing else is needed.

---

Read `CLAUDE.md` in full, then `docs/00-overview.md`, then `TASKS.md`.

You are working autonomously and unattended. I am not available. Do not stop
to ask me anything, at any point, for any reason.

Begin at the first unchecked task in `TASKS.md` and work top to bottom through
every phase. For each task:

1. Read the docs listed for that phase before writing code.
2. Implement it.
3. Verify the acceptance criteria and that the app still builds.
4. Tick the checkbox and commit.

Whenever you hit something the specification does not answer: choose the most
defensible option, append an entry to `QUESTIONS.md` using its template,
record the choice in `DECISIONS.md`, and keep going. Never block.

Log every error and its resolution in `NOTES.md`. If something cannot be
resolved, leave `TODO(blocked):` at the call site, note it in `NOTES.md`, and
move to the next task.

Never leave the tree in a state that does not build. A working subset is worth
more than a broken superset.

If you run low on context, spend your last tokens updating `TASKS.md` and
`NOTES.md` so the next session resumes cleanly.

---

## Follow-up prompt, after I answer the questions

Read `QUESTIONS.md`. For every question where `Answer:` is filled in and
differs from the `Default used:`, make the corresponding change, update
`DECISIONS.md`, and set `Resolved: yes`. Work autonomously as before.
