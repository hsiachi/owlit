---
name: product-review
description: The periodic whole-product review: findings by parallel researchers, journeys in Owlit Dev, a synthesis with Now / Next / Later, hsiachi's answers, and the Tasks table that becomes the backlog. Use every few weeks or before a release, in a session of its own.
---

Read `local/README.md` › Product reviews, the last review's README (Positioning, Settled, Tasks), its
`brief.md` and `journey-howto.md`, `local/product/vision.md`, `local/product/decisions/README.md`, and
`apps/desktop/CHANGELOG.md` since the last review's date.

0. **The plan**, in a few lines to hsiachi: the waves below, which workspace data the researchers may
   read, which engine the journeys use. Wait for a yes. Then make `local/reviews/<today>/` with
   `brief.md` and `journey-howto.md` copied from the last review, their dates, paths and "since" lines
   updated, and one new section in the brief: the last review's Tasks table with each row's status
   today, so a researcher can tell what moved.
1. **Wave 1**: six `Agent`s (opus) in parallel, one finding each in `findings/<n>-<slug>.md`: vision
   and decisions against the app; the feature inventory from the code; real usage from the workspace
   (read-only, counts and dates, no content); earlier findings and what became of them (the last Tasks
   table, UX runs, examiner pages); the landscape; users and jobs. Each reads `brief.md` first and ends
   with For the PM and Open questions.
2. **Wave 2**, once wave 1 is in: three journeys in Owlit Dev with a real engine (`pnpm drive`, an own
   `OWLIT_DRIVE_HOME` each, screens under `shots/`): the first day, a stage in the middle, back after a
   month; and one contrarian who designs the product from scratch and says where owlit differs. Anything
   hsiachi reports while the review runs (a screenshot, a complaint) becomes a finding of its own.
3. **The synthesis**, `README.md`, in these sections: Positioning; Users and their pains; What the product
   does today; What works and what doesn't, ranked by effect on the promised experience, with evidence;
   What to build next as Now / Next / Later, the contested calls named; What to count next month;
   Questions only hsiachi can answer. Every number carries its caveat (one user, so many days).
   `review.html`, a Chinese reading version, served by `owlit-local`.
4. **hsiachi's answers** go under Settled, their words first. Then the Tasks table: every piece of work
   the discussion produced, with id, size (fix / piece / bigger), where it goes (do it / `work/` /
   `ideas.md`) and status. Later and Watching rows also go to `ideas.md` with a pointer back; the old
   review's rows still open move into the new table with their ids kept.
5. **`local/README.md`**: the Product reviews table gets the new row; the old row says "superseded by
   <date>". `Status: Agreed in outline`.
6. **Stop.** The review doesn't run its backlog: `/next` picks from the Tasks table in a session of its
   own, a fix starts as a session that ends with `/ship`, a piece or bigger row with `/discuss`.
