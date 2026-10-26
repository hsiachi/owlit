---
name: discuss
description: Take a question, idea or backlog row to Agreed with only what it needs: sorted by kind and size, the Problem checked with hsiachi, then one plan for a clear one, drawn directions for a visual one, and options, a second opinion, a page and the examiner only for an open whether / what piece. Use when a piece or bigger task starts, in the session that will own it.
---

The argument is a Tasks row (`T13`), an `ideas.md` entry, or a sentence. A discussion writes only under
`local/`, so it needs no worktree; if this session has one anyway, `git reset --hard dev` there first (the
app cuts worktrees from `main`).

Read first: `AGENTS.md`, `CLAUDE.local.md`, `local/README.md` (A work README; Firm and provisional),
`local/product/vision.md`, `local/product/decisions/README.md`, the latest review's Positioning and Tasks,
the evidence the row names, and enough code to say what each screen it names shows today.

The work README is a hand-off to the next session, not something hsiachi reads: they read the chat and
the page. Keep it short and current, with no history.

1. **Sort the question** and say which it is in the chat. Kind: *whether / what* (should owlit do this,
   what should it be), *how it looks* (the visual design of something decided), *how to build it*. Size:
   *clear* once hsiachi confirms the Problem and says so, or *open*. One message with several things:
   write each one's two-line Problem here for hsiachi to confirm, then take them one at a time.
2. **The folder.** `local/work/<today>-<slug>/README.md` from the template, `Status: Discussing`. Move
   the `ideas.md` entry out; add the Open work row; set the Tasks row to "Discussing in work/…".
3. **The Problem**, at most 150 words, with data from `~/Desktop/Owlit` (read-only: journal, change log,
   index; counts and dates, never a doc's or chat's content). **Stop and check it with hsiachi** before
   any option exists, and correct it until they say it's right. Clear: cut it to two or three lines.
4. **By kind and size:**
   - **Clear, or how to build it:** one plan in the Proposal (what changes, where, what it gives up), then
     step 7. No second opinion, examiner, page or rounds.
   - **How it looks:** a page with two or three full directions at real size, real copy from the
     workspace (names withheld), each naming what it draws on. No second opinion, no A/B/C prose.
     `/design:design-critique` reviews the page instead of the examiner; fix what it finds.
   - **Open whether / what:** a second opinion first, from one `Agent` (opus) given the Problem,
     `vision.md` and `decisions/` and none of your leanings: three directions, what each gives up, saved
     as `second-opinion.md`. Then the Proposal: options merged, one recommendation, the questions only
     hsiachi can answer (literature: one `Agent` per thread, sources into `reading.md`). A page, and
     `/examine` (proposal pass) on it.
5. **The page**, `<slug>.html`, opens on the problem (today in at most five numbers, the ask in
   hsiachi's words, what's behind it, the smallest change), then the options drawn on real data with a
   toolbar, then the recommendation and the open questions.
6. **Report and rounds.** Open the page beside the chat (`preview_start` `owlit-local`, `navigate` to
   `http://localhost:5181/work/<date>-<slug>/<slug>.html`), then report in its order, three lines per
   option. Wait. Each reply changes the Proposal and page in place (new drawings: `<slug>-r2.html`, the
   problem at its top again). A rejected option shrinks to one line with why. The examiner runs again
   only when the direction changed. "你定吧" means decide, as Provisional with when to look again.
7. **Settled, Touches, Work.** The Proposal keeps only the chosen option. Decisions dated, Firm or
   Provisional; a Touches line for each item that applies; Work steps with their files and how to check
   them, small ones marked `small`; Verification lists the Electron-only items as "Not tried".
   `Status: Agreed`; update the Open work and Tasks rows. Then `/build` here, when hsiachi says so.

No code during a discussion. Plain English in the folder; the chat in hsiachi's language.
