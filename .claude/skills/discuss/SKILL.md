---
name: discuss
description: Take a question, idea or backlog row from a problem to Agreed: the work folder, the Problem in four parts with real data, a second opinion, the Proposal with options and a mockup, the examiner, rounds with hsiachi, Settled and the Work checklist. Use when a piece or bigger task starts, in the session that will own it.
---

The argument is a Tasks row (`T13`), an `ideas.md` entry, or a sentence. A discussion writes only under
`local/` (ignored by git, shared by every worktree), so it needs no worktree and no branch. If this session
was given a worktree anyway, `git reset --hard dev` there first: the app cuts worktrees from `main`, far
behind `dev`, and the code you read must be current.

Read first: `AGENTS.md`, `CLAUDE.local.md`, `local/README.md` (A work README; Firm and provisional),
`local/product/vision.md`, `local/product/decisions/README.md`, the latest review's Positioning and Tasks
(`local/reviews/<date>/README.md`) and the evidence the row names. Then enough of the code to say in one
line what each screen the request names shows today.

1. **The folder.** `local/work/<today>-<slug>/README.md` with the template's sections and
   `Status: Discussing`. Remove the entry from `ideas.md`; add the row to `local/README.md` › Open work;
   set the Tasks row to "Discussing in work/…".
2. **The Problem**, four parts, with data from hsiachi's workspace (`~/Desktop/Owlit`, read-only: the
   journal, the change log, the index; counts and dates, never a doc's or a chat's content; "no data"
   where there is none). One line per screen the request names. Not a restatement of the request.
3. **A second opinion** (every bigger row; a piece when hsiachi asks). One `Agent` (model opus) gets the
   Problem section, `vision.md` and `decisions/`, and nothing of your leanings, and returns three
   directions with what each gives up. Save it as `second-opinion.md` in the folder. Run it before you
   write your own Proposal, so it can't anchor on yours.
4. **The Proposal.** The options, yours and the second opinion's merged (A, B, C…), one recommendation
   with reasons, and the questions only hsiachi can answer. Literature when the question has research
   behind it: one `Agent` (opus) per thread, verified sources into `reading.md`, the conclusions into
   the Proposal.
5. **The page.** Every discussion has one, `<slug>.html` beside the README, served by the `owlit-local`
   preview. It opens on the problem, before any option: what hsiachi does today (the numbers that
   matter, no more than five), what they asked in their words, what is behind it, the smallest change
   that would relieve it. Only then the options, each with its trade-offs; drawn on the same real data
   from the workspace (names withheld) when the question is visual, a toolbar to switch option and
   screen; a short card each when it isn't. The recommendation and the open questions close the page.
   Options without this top are a menu with no question, and hsiachi has said so.
6. **`/examine`** (proposal pass). Answer each graded finding in the Proposal or in Settled; a wrong
   number it caught is corrected in the Problem, its Note kept.
7. **Open the page beside the chat** before reporting: `preview_start` with `owlit-local`, then
   `navigate` to `http://localhost:5181/work/<date>-<slug>/<slug>.html`. Then **report** in the chat in
   the same order as the page: the problem in three lines first, then what the data showed, each option
   in three lines, the recommendation, the open questions, and the page's URL. Stop and wait.
8. **A round.** hsiachi's reply changes the Proposal and the page in place (no "round 2" section; a new
   round of drawings is `<slug>-r2.html`, with the problem at its top again, since the examiner and
   hsiachi read each page on its own). Reopen the page in the side pane each round. Run the examiner
   again when the direction changed, not for wording. "你定吧" means decide, and write each decision as
   Provisional with when to look again.
9. **Settled, Touches, Work.** Each decision dated and marked Firm or Provisional; a Touches line for
   each item that applies; Work steps sized so one build subagent does one in a sitting, each with its
   files and how to check it; Verification lists the Electron-only items as "Not tried". `Status: Agreed`.
   Update the Open work row and the Tasks row.
10. **Say what's next**: `/build` in this session, when hsiachi says so.

No code during a discussion. Plain English in the folder; the chat in hsiachi's language.
