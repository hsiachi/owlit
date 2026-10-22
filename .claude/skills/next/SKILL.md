---
name: next
description: Pick the next piece of work in a session that has none yet: what is in flight, what waits on hsiachi, three to five candidates from the backlog with one recommendation, then start the session that does it. Use at the start of a session with no task, or when asked "what next".
---

Read, in this order: `local/README.md` (Open work and Product reviews tables), the latest review's
`## Tasks` table (`local/reviews/<date>/README.md`), the headings of `local/ideas.md`, and the state of the
checkout: `git worktree list`, `git branch --no-merged dev`, `gh run list -b dev -L 1`, and
`list_sessions` (limit 30) for owlit sessions still running or paused on a question.

1. **In flight first.** Built but not merged (a branch ahead of dev; a work folder whose Status says
   Built), waiting on hsiachi (a row that says "waits for hsiachi" or "for hsiachi to read"; a session
   paused on a question), a red dev CI. One line each with what unblocks it. These come before anything
   new, and a red CI comes before everything.
2. **Candidates.** Three to five rows, Now before Next, from the Tasks table and Open work; ideas only
   when those are empty. For each: the row's id and name, its size (fix / piece / bigger), why now
   (what it unblocks, what hsiachi said, what the data showed), and what it would start with. One
   recommendation, first.
3. **Ask** hsiachi which one (AskUserQuestion, the candidates as options). Don't start anything before
   the answer.
4. **Start it.** The brief stays short on purpose: the skill in the new session says what to read, so
   the brief carries only what the notes don't have (what hsiachi just said, a screenshot's path).
   - A fix: `start_session` (user_asked, fresh, worktree, model claude-opus-5-5) with the row, the
     evidence files it names, the files to touch, and "finish with /ship".
   - A piece or bigger: `start_session` (user_asked, fresh, no worktree, model claude-fable-5-1, effort
     high: a discussion needs the deeper thinking) with "Run /discuss on <row id>: <row name>" and those one or two sentences.
   - Right after either start: `detach_session` on the new session. This session's work ends here, and
     a linked session would wake it after every turn it finishes.
   - Already in flight: `SendMessage` to the session that owns it, or continue it here if it has none.
5. **Update the row's Status** in the Tasks table ("Discussing from <date>", "Building: session
   <name>") and the Open work table where a row exists.

This session only picks and starts: no merging, no `pnpm try`, no building here.
