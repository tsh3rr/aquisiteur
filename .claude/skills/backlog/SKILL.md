---
name: backlog
description: Record an owner's feature request or idea in the Aquisiteur backlog (ZIELPROMPT.md and docs/ROADMAP.md). Use when the owner says something should go into the backlog, or names a feature for later.
---

# Recording a backlog item

The backlog lives in two places that must stay in sync:

1. **`ZIELPROMPT.md`**: add a bullet `**Später (nicht v1): <Titel>.** <what and why, in the owner's words>`
   in the section of §7 the feature belongs to (e.g. §7.4 contact channels, §7.9 letter generator).
   Note privacy or security constraints right there, as the existing items do.
2. **`docs/ROADMAP.md` → "Später"**: one checkbox line `- [ ] <Titel> (ZIELPROMPT §7.x)`.

Before adding, search both files and the code: if the feature already exists, tell the owner where
it is instead of adding it. Write in German. Commit on its own with a message like
`Add <feature> to the backlog`, and tell the owner in one line that it is recorded and where.
