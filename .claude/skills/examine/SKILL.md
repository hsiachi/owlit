---
name: examine
description: Spawn the user-side examiner on a piece of work: a fresh session that plays the researcher through the proposal, or through the built feature, and writes one page under Examined. Use before Settled and again after the build.
---

The brief is `local/work/examiner.md` (the maintainer's notes, ignored by git): read it and hand it over
whole. Given a work folder `local/work/<date>-<slug>/`:

1. Check the README's Problem has the shape the template asks for (the situation with real data, the
   request as stated, what's behind it, the smallest relieving change). If not, write it first; the
   examiner reads the Problem, not the request.
2. Spawn a fresh session (`start_session`, context fresh, no worktree needed: it only reads, and writes
   one section of the README). Its prompt is the brief plus the folder path and which pass this is:
   `proposal` (before Settled) or `built` (after the build, run in Owlit Dev with `/try-it`'s harness).
3. The examiner writes its page under `## Examined`, dated and marked with the pass. Nothing else in the
   folder changes.
4. Read its page before the next round: each graded finding is answered in the Proposal or in Settled,
   not left standing.

Only work with a work folder gets examined. A small fix goes straight to `/ship`.
