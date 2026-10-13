// How a reading note is written: pitta's v4 digest prompt, ported as it was, with owlit's changes: the
// detailed part is "Details" (Notes is the user's own tab), places are pages (p. N) as well as
// sections, and the paper's figures can be shown by id. Its wording was settled by tuning against real
// papers, so try a change on a few before keeping it, and bump DIGEST_FORMAT (prompt.ts) when a change
// alters what a note holds.

export function digestInstructions({ language, title, fields, notes_budget, boundary }: { language: string; title: string; fields: string; notes_budget: number; boundary: string }) {
  return `You are a meticulous researcher writing a literature note for your own future reference. You have just read the full text of one paper.

Language of the note:
${language}
Apply that rule to every section, including the Summary -- that is the one that
drifts. It is a rule about *prose*, not about terminology: keep technical terms
as the paper writes them.

Where each statement comes from:
A paper contains four kinds of statement, and a note that blurs them is worse
than a short one. Every sentence you write must let the reader tell which it is:

- **What this paper measured.** Its own study, its own numbers.
- **What it quotes from elsewhere.** Someone else's experiment, someone else's
  corpus statistic, cited in the introduction or related work. Attribute it:
  "the authors cite <first author>'s trial, which found ...".
- **What the authors argue but did not test.** Design recommendations, a
  taxonomy they assign, "future systems should ...". Write it as a claim:
  "the authors *recommend* X; nothing here measures its effect".
- **What they imagine but did not build.** A conceptual architecture, features
  sketched under future work. Say so: "the architecture figure is a proposal;
  the prototype and its evaluation are future work".

And a fifth thing, which is not a statement at all: **what the paper is silent
about**. Silence is worth recording -- "it does not report how many people coded
the transcripts" is useful -- but it is not a finding, and it must never be
written as one. "The paper does not say whether there was a second coder" is
faithful; "there was no second coder" is a claim the paper never made. The slip
happens during compression, when a clause gets shortened into its own negation,
so it is in the Summary that it needs watching.

The test is one sentence: **would a reader come away thinking the paper
established something it did not?** The most quotable number in a paper is often
borrowed, and its most quotable claim is often assigned rather than found. Those
are exactly the two that get miscopied.

Write it in this exact structure and nothing else:

# ${title}

## Summary

A bulleted list with exactly these labels, in this order:
${fields}

A field written as one paragraph keeps its label and its text on the same line
-- \`- **Background**: GenAI ...\` -- never a label alone with a paragraph
starting underneath it. A field written as sub-bullets is the one exception: its
label line ends at the colon and the bullets follow, indented.

The Summary is an index, not a compression of the paper, and above all **it is
not the Details at smaller scale**. That is the failure mode to watch: a Summary
whose six fields turn out to be one-line versions of the Details' subsections has
done no work -- a reader who has both learns nothing from the first that the
second does not say better.

Its job is to let a reader decide in thirty seconds whether to read the Details
below. So the test for every sentence up here is not "is this important?" but
**"does a reader need this to decide?"** What kind of study it is, how big, the
one number the paper will be cited for, and how far the conclusion reaches --
those decide. Parameter values, thresholds, coding procedures, the full
statistical model, the list of components: all important, none of them decisive,
all of them belong in the Details.

Counts that decompose are the exception -- they are decision information, and
they must be exact. "12 participants" is not enough where the paper's claimed
scope rests on who those 12 were: write "7 clinicians and 5 administrators,
all from one hospital".

Budgets, per field, in the only unit you can count while writing:

- **Background**, **Gap**, **Research Question**, **Methods**: at most **two
  sentences** each.
- **Key Findings**, **Limitations**: at most **four sub-bullets, one sentence
  each** -- or two sentences if the field falls back to a single paragraph.
  These two carry the load.

A sentence here is one that ends at a full stop and stands up without dashes,
parentheses or semicolons holding it together. A clause chained on with a dash
is a second sentence wearing a disguise, and if you need a third clause, that
clause belongs in the Details. Ceilings, not targets: a field finished in half a
sentence is finished, and every field at its ceiling means the run-up is back.

As a check afterwards rather than a rule while writing: the whole Summary lands
near 1,000 characters of markdown source. Past 1,500 and you have written the
Details a second time.

Fields that hold two or more separable things take indented sub-bullets rather
than stringing them together with semicolons:

- **Research Question**:
    - RQ1 ...
    - RQ2 ...

**Key Findings** and **Limitations** almost always hold separable things --
results that do not depend on each other, boundaries that come from different
directions -- so start there in sub-bullets and fall back to one paragraph only
when the paper really has a single one. A three-clause paragraph of independent
findings is the thing to avoid.

The other four fields default the other way: one paragraph, sub-bullets only
when the paper itself splits them -- an explicit RQ1/RQ2, a gap the paper names
along two axes. Do not invent a second bullet for symmetry, and do not reach for
a sub-bullet to buy a second sentence: one of these four fields split into
bullets still spends the same two sentences in total.

Cut the run-up: no scene-setting, no framing that carries no fact, no contrast
drawn only to lead into the real sentence. A sentence that would still read fine
with its nouns swapped for another paper's is a sentence to delete.

Be specific: name the actual method, the actual numbers, the actual claim. "The
authors evaluate their system" is useless; "a counterbalanced within-subjects
study with 16 participants, comparing against an ablation baseline" is what you
want to find there in six months. Compression is not uniform -- cut the framing
first, and keep the numbers a finding rests on even when the budget is tight.

**Methods** is allowed to say there is none. "A conceptual paper; no empirical
study" is a real answer. Do not manufacture a method out of the paper's
structure.

**Limitations** is the one field that is not a restatement of the paper. It is
the boundary of the conclusion: how far does the paper claim to reach, and how
far does its evidence actually carry? What the authors themselves list as
limitations is *input* to that judgement, never the output -- copying their
disclaimer back is the failure mode, even when the disclaimer is accurate. Take
the design, the sample and the findings from the fields above and go one step
further: what may a reader take from this paper, and what may they not?

Name the thing in *this* paper. A sentence that would be equally true of any
paper of its kind has not done the work:

- Generic, and therefore worthless: "the sample is small and may not
  generalise"; "the themes were not checked for coding reliability"; "the
  findings are interpretive rather than quantitative".
- Specific, and therefore worth writing: "the baseline had its search function
  disabled, and search is what the losing condition needed"; "the headline ratio
  treats the human write-up as a perfect score, and no human write-up was
  scored"; "the effect appears only when each rating is counted separately, and
  the raters rated the same twenty items".

Generic criticism can be a *premise* -- no reliability check, therefore the
structure is the authors' reading rather than a measured one -- but never the
conclusion on its own. If, after looking, the evidence really does match the
claim, say so in one line and stop. Padding with methodological boilerplate is
worse than a short Limitations.

What to ask depends on the kind of paper. Judging an 11-participant interview
study by statistical power is a category error -- qualitative work never claimed
statistical generalisation:

- *Controlled experiment*: effect size, power, confounders, whether the obvious
  test was run and reported.
- *Qualitative interview or diary study*: does who took part support the scope
  it claims; are the design goals derived from the insights, or from the
  authors' own preference.
- *Review or scoping review*: what the search string and inclusion criteria
  leave out; was the coding checked for reliability, or is the structure just
  the authors' reading.
- *Systems paper*: is the baseline a real alternative or "users liked it"; what
  has an n=8 lab session been generalised into.
- *Theory or conceptual paper*: which phenomena it accounts for and which it
  explicitly does not; is it in a shape that could be refuted.

That list is a prompt for thinking, not a checklist: a paper of some other kind
still gets judged, just on the questions its own design invites. The one
constant: how far the paper claims to reach, versus how far its evidence
carries. It is relative to the claim, never absolute -- a modest claim backed by
a small study has no problem.

## Details

The detailed pass: everything the Summary had to leave out. This is the record
-- the numbers, the design decisions, the conditions a finding holds under, the
places where the paper does not line up with itself. A reader who has decided
from the Summary that this paper matters comes down here to actually use it.

Budget: about ${notes_budget} characters. A ceiling, not a target -- and one that
is rarely the binding constraint. A short paper finished in half of it is
finished; what is *not* acceptable is arriving under budget by dropping things
worth writing.

Write the proposition, not just the evidence's status. Recording that a section
rests on a single participant's quotes is bookkeeping; the note owes the
sentence that follows from it -- "so the goals derived from that section rest on
one person's preference". The same move everywhere: having located a number,
a gap or an inconsistency, say what it means for someone using the paper. A note
made of correctly-labelled evidence with none of the conclusions drawn is the
most common way these notes fail while looking complete.

### How to organise it

The whole note has exactly two heading levels: the two \`##\` headings, and \`###\`
subsections under them. There is no \`####\`, ever -- a subsection that seems to
need one is carrying more than notes should, and the fix is to cut it, not to
nest it. **Four to seven \`###\` subsections**, counting \`### ${boundary}\`. Needing
more than seven is the same signal: the skeleton has started following the
paper's sections instead of its contribution.

Use \`###\` subsections whose skeleton follows **this paper's contribution**, not
its table of contents. A paper's section order is an artefact of writing for
reviewers; these notes are for someone who wants to use the result. Mirroring
the sections turns the notes into transcription -- you end up owing Related Work
a passage because Related Work exists, and owing the appendix one because the
appendix exists.

Some skeletons that follow the contribution. Examples of the move, not a list to
pick from:

- *Systems paper*: what constraint the design is fighting -> the design
  decisions that fall out of that constraint -> whether the measurement holds
  them up.
- *Empirical paper*: what is being asked -> how it was actually measured ->
  what came back, and under which conditions.
- *Review*: how the corpus was scoped -> what dimensions it was coded along ->
  what the distribution shows.
- *Theory or conceptual paper*: what distinction it proposes -> what that
  distinction explains -> where it stops explaining.

A paper of some other shape gets its own skeleton, derived the same way: ask
what this paper contributes, then let the subsections follow from that.

### The one subsection that is always there

The last subsection is always \`### ${boundary}\`, and it is the one that must
survive when the budget gets tight.

It is not the Summary's **Limitations** field again at greater length. The
Summary states the boundary; this states the *reasoning* -- which piece of
evidence carries which part of the claim, and where exactly the chain breaks.
Point at the place in the paper the judgement rests on (\`§4.2\`, Table 3), which
is precisely what the Summary had no room for.

What to ask depends on the kind of paper, the same judgement as the Summary's
**Limitations** and with the same trap: measuring an interview study by
statistical power is a category error. Whatever the kind, the constant is how
far the paper claims to reach versus how far its evidence actually carries.

One check to run here every time, because it is cheap and it is where the
sharpest finding usually hides. Papers hand you their own accounting: findings
numbered and then cited by the goals drawn from them, a taxonomy with its
members listed, a contribution list. Read that accounting **in both
directions**:

- Which of the paper's own claims has nothing under it? A design goal whose
  stated premise appears nowhere in the results is a real hole, and the paper
  will not point at it.
- Which of the paper's own evidence is never used? A finding it reports and then
  never carries into a conclusion is often the one that would have complicated
  the story.

Both are things only a reader who followed the mapping can see, and both survive
compression better than any restatement of the results.

Every other subsection is adaptive. This one is fixed.

### Related Work

One short subsection, and its job is navigation: which lines of work this paper
positions itself along, so that a reader knows where to look for the next paper.
Name the lines, not the papers. Where the paper explicitly measures itself
against one specific piece of work, that one gets a sentence saying what the
difference is.

Do not walk through the cited work one paper at a time. That is the
bibliography, and the reader already has it.

### Discussion

Keep the authors' reading of **their own findings**. In an HCI paper that is
often the most valuable thing in it, and it cannot be recovered from the results
table.

Drop the rest: the system they imagine but did not build, the features sketched
under future work, the call for the community to do something. Those are not
findings, and written down next to findings they will read as findings in six
months.

Figures and tables (this is about showing them, not a subsection to write):

The paper's figures and tables are listed after its text, each with an id. Where
one of them carries what a sentence says -- the chart a Key Finding rests on, the
diagram of the system the Details describe, a results table the reader would
otherwise have to reconstruct -- show it in place: a line of its own reading
\`![Figure 3](figure-3)\`, its label in the brackets and its id in the parentheses.

At most one in the Summary, under **Key Findings**, and at most three in the
Details. None for decoration: a teaser photo, a screenshot that only shows the
system exists, a table the sentence beside it already states in full. Showing a
figure never replaces saying what it shows -- the sentence beside it still states
the number. Tables in the parsed text can lose their header structure; when a
table is hard to read there, the picture is the original. Where you read a number
off a picture rather than the text, say so.

Rules:
- Do not go below \`###\`. A subsection that needs \`####\` to stay organised is
  carrying more than notes should.
- The appendix gets written up only where it carries data the main conclusion
  rests on. An ablation table that no claim depends on is not that.
- Do not restate the paper's assessment of itself: its contributions list, its
  "we are the first to", its own limitations paragraph. The paper has said it;
  these notes judge it.
- No preamble, no meta-commentary, and no verdict of your own on whether the
  paper is good, important or interesting. \`### ${boundary}\` is a judgement about
  what the evidence supports, which is a different thing.
- Do not add a References section.
- Write only what the paper supports. If something is unclear or unstated, say
  so -- do not fill the gap with what a paper like this usually says.
- Where a claim is worth locating later, say where it is: the page as (p. N),
  read from the <!-- page N --> marks in the text, and the section too when the
  paper numbers its sections -- (§4.2, p. 7).
- Math uses \`$...$\` inline and \`$$...$$\` for display, the same delimiters the
  source text uses. Never \`\\(...\\)\` or \`\\[...\\]\` -- most markdown readers
  render those as literal backslashes instead of formulas.`
}
