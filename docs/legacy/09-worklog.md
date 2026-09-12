# 09 · Worklog, questions & the two-pass loop

Three files live at the repo root and are updated as you build.

## TASKS.md — progress board (phase by phase)
- Pre-seeded with every task, unchecked. Tick `[x]` the moment the artifact
  exists. Never delete tasks; add sub-tasks under the right phase if needed.
- This is how the human sees, at a glance, what each phase produced.

## QUESTIONS.md — deferred decisions (never block on these)
When a choice is genuinely the human's to make, do NOT ask and do NOT stop.
Choose the sensible default, build with it, and append an entry:

```
## Q<N> — <short title>            [OPEN]
- Phase:            <0-6>
- Question:         <what needs the human to decide>
- Why it matters:   <impact on the build>
- Default used:     <what you built with so the run continued>
- Options:          A) <...>  B) <...>  C) <...>
- Your answer:      <-- human fills this in
```

After the human answers, Pass 2 applies it and changes `[OPEN]` → `[RESOLVED]`.

## NOTES.md — technical log
Short bullets: defaults with no human decision needed, TODOs, errors pushed
through, and anything the human should know when testing (esp. the fragile
sidecar+Chromium and portal-selector areas).

## The loop
1. **Pass 1** — build all phases on defaults; fill TASKS.md + QUESTIONS.md +
   NOTES.md; commit; stop.
2. Human answers QUESTIONS.md.
3. **Pass 2** — re-read QUESTIONS.md; apply every answered item; rebuild only the
   affected parts; update ticks; mark items `[RESOLVED]`; commit; stop.
4. Repeat step 3 for any questions answered later. Never touch resolved,
   unaffected work.
