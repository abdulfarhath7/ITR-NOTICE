# Build context bundle

Drop the contents of this bundle at the root of the `ITR-NOTICE` repository,
then start Claude Code with:

> Read CLAUDE.md, then TASKS.md, and begin at the first unchecked task.
> Work autonomously through every phase. Do not stop to ask me anything.
> File questions in QUESTIONS.md and keep going.

## What is in here

| File | Purpose |
|---|---|
| `CLAUDE.md` | Operating rules. Read first. |
| `TASKS.md` | The build plan, phased, with acceptance criteria. |
| `QUESTIONS.md` | Open questions and the defaults chosen meanwhile. |
| `DECISIONS.md` | Running log of choices made and why. |
| `NOTES.md` | Worklog, errors, blocked items. |
| `docs/` | The specification. Sixteen focused documents. |

## After the build

1. Read `QUESTIONS.md` top to bottom. Fill in the `Answer:` line on each.
2. Re-run Claude Code with: *"Read QUESTIONS.md. For every question with a
   filled Answer that differs from the Default used, make the change and tick
   Resolved."*
3. Read `NOTES.md` for anything blocked.
