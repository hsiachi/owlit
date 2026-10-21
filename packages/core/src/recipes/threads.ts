import type { Recipe } from "./index.ts"

// How Owlit works on threads: one skill, read whole through owlit_help('threads') before any thread work
// in a chat. It works out from the user's intent what a thread should be (its shape, its size, a look or a
// survey) rather than one recipe per job. Its words name thread_write's fields as owlit-mcp declares them
// (protocol mcp-tools.ts): change them together.
const THREAD_SKILL = `# Threads: how to work on one

## What a thread is

A thread is your report on a question the user asked, with the papers it rests on. The user reads the
report to see what is known and what it means for their work, and takes papers from it when they
write. Everything in it is yours: the user does not edit it in place; when they want something changed,
they tell you in a chat and you rewrite it. Each write is one step they can undo whole.

A thread has: a title (yours, short, neutral, in the user's language), the question in the user's words
(\`asked\`), a project (the top-level folder the work belongs to, when it plainly does), the report
(Markdown; see below), the papers as rows (what each is, how each bears on the question, with the
passage it rests on and how it was found), groups when the papers fall into lines, and columns when the
user wants the same thing said of every paper. All of it goes in with \`thread_write\`.

## 1. Before searching: understand what they want

A thread serves one of a few needs, and the need decides the shape, the size and the method. Work out
which from the user's words, the chat so far, the docs they are writing (\`docs_read\`) and what they did
lately (\`activity_read\`). The needs:

- **Understand a field or a concept**: "what is known about X", "how is X defined", "what theories",
  "what's close to X". A survey; the report explains the lines of work and where the user's idea sits.
- **Find the right papers for a piece of writing**: "related work for the dataset section", "what
  should I cite for claim Y". A targeted gather; the report is short; what matters is that each row says
  why it is citable and the passage is right.
- **Compare papers on something**: "how did they measure Z", "what sample sizes", "who supports or
  contradicts this". A table: the thing compared is a column asked of every paper; the report reads
  across the column.
- **Pick what to read**: "what should I read first on X". A short thread whose report is a reading
  order with a sentence on why each.
- **Check a claim or a feeling**: "is it true that nobody has done X", "I think X and Y are related".
  The report answers the question directly, with the papers as evidence, and says what was searched.

When the words leave the need or the scope open, **ask one or two questions before searching**, in the
chat, and wait: what the thread is for (a section they are writing? deciding what to read?), what is in
and out of scope (years, venues, a method, a population), and whether they want a quick look or a
thorough survey. Don't ask when the chat already says it, or when the request is small ("find me three
papers on X"): then say your assumption in the answer and go. Never ask more than two things at once.

## 2. Is there a thread already?

Read \`thread_list\` first: it gives each thread's question and one line. Add to a thread (its \`id\`) when
the new question falls inside its question (a narrower part of it, the same question with another
phrasing, "more on this"); start a new one in the same project when it is a neighbour (a different
dimension of the same project) or when the user names a new piece of work. Say which you did in the
answer and link the thread; for a new one, name the threads it neighbours. When the user names a thread,
that is the one. Read it with \`thread_read\` before you write to it.

## 3. Choose the shape, and say it

- **A note**: the report, then the papers in one list. For a small gather or a reading order.
- **Groups**: the papers fall into lines of work (by theory, by method, by what they built, by the
  chapters of the user's story). Name the groups for what the papers in them share, two levels at most,
  at most about thirty papers in a group, each group with one line (\`groups\`, each row's \`group\`). Use
  groups whenever there are more than about eight papers or when the report has sections: the sections
  and the groups should match. A paper usually goes in one group; give it a second (\`groups\`) only when
  it is really used in both. To group the same papers another way, give \`new_grouping\` (what it groups
  by, in their words), never a new thread.
- **A table**: when the user wants the same thing known of every paper (method and sample, main finding,
  what they built, how they measured X), or when they drop sentences of their doc in to be checked
  against. Each column is one question, in their words (\`columns\`), answered in a phrase per row
  (\`cells\`), "Not said" when the abstract doesn't say. Don't add columns they didn't ask for; "what it
  is" and "how it bears" are not columns, every row has them.

Say the shape in your answer ("a table with two columns: …"); the user changes it by asking.

## 4. Method: a look or a survey

- **A look** (about ten papers): one or two searches in the obvious words, the clear neighbours from
  \`library_related\` of the two best, done. For a quick sense, a reading order, a small citable set.
- **A survey** (as many as the question takes; thirty to sixty is normal, a venue's year can be two
  hundred): say the scope and the inclusion criteria first, in the write's \`note\` ("2018 on; wearable or
  first-person; has a human judgment of the reminder"), and keep to them. Search each source
  (\`library_search\`: openalex by default, s2 for its ranking, arxiv for preprints; \`library_journal\`
  for a venue's issues) with two or three phrasings. Snowball from the five most relevant through
  \`library_related\` (references and cited_by). Screen against the criteria; write what you excluded
  and why in the \`note\`. Stop when new searches return papers you have. Then group, then answer each row,
  then write the report.

Which one: a survey when they want to understand a field, its theories or its history, or say
"thorough", "all", "comprehensive"; a look otherwise. When unsure and the question is big, ask (section
1). Say which you did and how far you looked ("searched OpenAlex and S2 with three phrasings, followed
citations of five papers, screened 103 to 41").

## 5. Rows: what each paper is and how it bears

Name each paper (\`id\`) by the id a search gave; owlit knows them and brings them into the user's
library. Write rows in batches of up to 25. For each row write two things from the same read:

- **what it is** (\`is\`): one short line, its kind and material. "Field study, 12 participants, two
  weeks"; "Survey of 40 systems"; "Theory paper"; "Benchmark, LLM-generated labels"; "System, prototype,
  no study". The reader has not read the paper; this is what they look at first.
- **how it bears on the question** (\`answer\`): one plain sentence on what the paper found or claims that
  matters for the question, in the question's language. From the whole abstract (\`library_get\`; a
  search's own line cuts it short) with \`depth\` \`abstract\`; from the text (\`library_read\`) with
  \`depth\` \`full\` and the words it rests on in \`quote\`, word for word (owlit finds the page). A paper
  whose text owlit has is answered from the text from the start. owlit shows each row on one scale, from
  your library_read calls: the full text (a read with no pages or section), part of the text (pages or a
  section), the abstract only, or the title only; an answer with a quote after reading pages shows as
  part of the text, whatever depth says.

Also \`found_by\`: how the paper got here, so the record says why it is in the thread: "search: prospective
memory model"; "cites Smith 2020" for a paper among those citing Smith (\`library_related\` cited_by);
"cited by Kliegel 2002" for one in Kliegel's reference list (\`library_related\` references). The citing
paper is the later one: a 2026 paper is never "cited by" a 2022 one.

Read in full the papers the report leans on: the ones it names more than once, the ones that decide a
disagreement, the ones the user will read first. A row's paper is in the library once its write went in,
with its PDF being looked for like any paper's; \`library_fetch_pdf\` on those you want now waits for
owlit's look and says where each stands, and \`library_read\` reads them when their text is there. Say
in the answer how far you read, in the words owlit shows: how many from the full text, how many from
part of the text, how many from the abstract only. Don't read everything in full for a survey of fifty;
do read the five that carry it.

## 6. The report

The report (\`report\`, the whole of it on every write) is what the user opens the thread to read. It is
a short review of what the papers say together, written for the user's question, not a summary of each
paper in turn. Markdown. Its length follows the thread: three or four paragraphs for ten papers, a page
with sections for a survey. Name a paper as a link labelled with its short title, the words before the
title's colon or dash (or the whole title when it has none), \`[CiteSee](owlit://library/<id>)\`: that is
how the rows name it, so the user can find the row. Name only papers that are rows; if one is worth
naming, add it as a row first. Its parts, in the order that fits:

- what this body of work is and what it settles (one paragraph, first);
- the lines of work, each with what its papers agree on and where they differ (the groups, if there are
  groups; the sections and the groups match);
- what none of them covers that the question needs;
- what it means for the user's work: where their idea sits, what it can rest on, what it has to argue
  itself. Say this plainly; it is why they asked. It is your reading, so it reads as yours ("this is
  where the dataset sits"), never as theirs;
- what to read first, two to five papers, a few words on why each. Before the write that carries the
  report, get their PDFs with \`library_fetch_pdf\` (the rows went in already), and say in one line
  which of them the user can't open and why, from that answer: "Smith 2020 has no PDF (no open copy);
  Lee 2021 waits for your library sign-in". Nothing when all can be opened;
- for a survey, what was searched and what was excluded (the record has the detail).

Don't pad. A line that would be the same in any report is not worth a line. Where the papers don't say,
say so. Where you answered from abstracts only, the report says what rests on the abstract only.

## 7. Title, project, one line, answer

Title: short, neutral, the topic rather than the question ("前瞻记忆的定义与理论模型", not "帮我找前瞻记忆的理论"),
in the user's language. Project: the top-level folder when the work plainly belongs to one. One line (\`one\`): what the thread holds and what it found, for the list of threads; without it owlit takes
the report's first sentence. Your answer in the chat: one short paragraph: what you made or grew (link
it), the shape, the size and how far you looked, and the two or three papers to read first. The report
is in the thread; don't repeat it in the chat.

## 8. Changing a thread

Everything in a thread is yours to rewrite when the user asks in a chat: "regroup by method", "add a
column on sample size", "the report is too long", "drop the two workshop papers", "read the rest in
full", "you misread Smith: it supports, not contradicts". Do it with \`thread_write\` (\`rows\`, \`groups\`,
\`columns\`, \`remove_rows\`, the whole \`report\`), and rewrite the report whenever the papers or the groups
change so it never describes a thread that no longer exists. One write is one Undo for them. Never
change the question in their words; when the question moved, say so in the report's first paragraph and
give the new question as \`asked\` on that write (owlit records each batch's question in About).`

export const threadSkill: Recipe<undefined> = {
  description: "how to work on threads: read it whole before any thread work (papers for a question, adding to a thread, regrouping, a column, rewriting a report)",
  text: () => THREAD_SKILL,
}
