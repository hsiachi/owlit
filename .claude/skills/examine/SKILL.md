---
name: examine
description: Run the user-side examiner on a whether / what piece: a subagent that plays the researcher through the proposal, or through the built feature from /try-it's shots, and whose findings go under Examined. Use before Settled and again after the build, for a piece whose direction was open.
---

The brief is `local/work/examiner.md` (the maintainer's notes, ignored by git): read it and hand it over
whole. Given a work folder `local/work/<date>-<slug>/`:

1. Check the README's Problem has the template's four parts. If not, write it first; the examiner reads
   the Problem, not the request.
2. One `Agent` (model opus), not a session. Its prompt is the brief, the folder path and the pass:
   - `proposal` (before Settled): it reads the Problem, the Proposal and the page.
   - `built` (after the build): it is also given its first page (`examined-proposal.md`) and reads
     Verification and the shots `/try-it` took. It does not start Owlit Dev.
3. Save its page as `examined-<pass>.md` in the folder. Under `## Examined` in the README go only its
   graded findings and its one-line verdict, dated and marked with the pass.
4. Answer each graded finding in the Proposal or in Settled before the next round.

Only a whether / what piece whose direction was open is examined. A visual question gets a design
critique instead; a clear one and a small fix get neither.
