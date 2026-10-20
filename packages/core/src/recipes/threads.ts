import { groupingsOf, threadUri, type Thread, type ThreadColumn, type ThreadSize } from "@owlit/protocol"
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
  search's own line cuts it short) with \`depth\` \`abstract\`; from the full text (\`library_read\`) with
  \`depth\` \`full\` and the words it rests on in \`quote\`, word for word (owlit finds the page). A paper
  whose text owlit has is answered from the text from the start.

Also \`found_by\`: how the paper got here ("search: prospective memory model", "cited by Smith 2020",
"references of Kliegel 2002"), so the record says why it is in the thread.

Read in full the papers the report leans on: the ones it names more than once, the ones that decide a
disagreement, the ones the user will read first. Add them with \`library_add\` (the user asked for this
work; several in one call) and read them when their text is there. Say in the answer how many you read in
full. Don't read everything in full for a survey of fifty; do read the five that carry it.

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
- what to read first, two to five papers, a few words on why each;
- for a survey, what was searched and what was excluded (the record has the detail).

Don't pad. A line that would be the same in any report is not worth a line. Where the papers don't say,
say so. Where you answered from abstracts only, the report says what rests on abstracts.

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
  about: "thread",
  description: "how to work on threads: read it whole before any thread work (papers for a question, adding to a thread, regrouping, a column, rewriting a report)",
  text: () => THREAD_SKILL,
}

// The first message of a chat a thread's button starts (Threads.begin). An agent in a chat reads the skill
// above instead.

// What a thread's recipe is written from; Threads.recipeInput works it out
export interface ThreadRecipeInput {
  thread: Thread
  // Rows whose full text owlit has, which are answered from it
  withText: string[]
  // read-in-full: the rows to read (Threads.toRead)
  toRead: string[]
  // find-more: what the user asked to look for this time, when it isn't the thread's question
  lookFor?: string
  // ask-each and group: the column to fill
  column?: ThreadColumn
  // gather: how many papers the user asked for when they started it from the Threads page
  size?: ThreadSize
}

const ABOUT = (c: Thread) =>
  `The thread is ${c.id} (${threadUri(c.id)}). Read it first with thread_read: what is there, what the user rewrote (keep it) and removed (never bring it back).`

const ANSWERS = `Each row's answer is one plain sentence on what that paper found about the question, in the language the question is in. Write it from the paper's whole abstract (library_get gives it for an id a search returned; a search's own line cuts the abstract short) with depth abstract. A paper in the user's library with its full text (a search says "already in the library", and not "no PDF yet") is answered from the full text from the start (library_read), with depth full and the words it rests on in quote, word for word.`

// The rows whose full text owlit has, named so Owlit reads them rather than answering from the abstract
const FULL = (withText: string[]) =>
  withText.length
    ? `These papers of the thread have their full text in the user's library: ${withText.join(", ")}. Answer them from it (library_read), with depth full and the words each answer rests on in quote, word for word; the others from their abstracts.`
    : ""

// A row whose paper has no abstract was answered from its title; owlit stores it as depth title
const THIN = `Rows answered from the title only (depth title) are thin: don't let the memo rest on them.`

// A paper can be in several groups; Owlit keeps that rare, so overlap stays visible rather than everywhere
const ONE_GROUP = `A paper usually goes in one group; give it a second (groups: ["a", "b"]) only when it is really used in both.`

const MEMO = `The memo is at most four sentences on what the papers say together: where they agree, where they differ, what none of them covers. It describes the papers, not your search; it doesn't tell the user what to write or conclude. Name a paper in it as a link labelled with its short title, the words before the title's colon or dash: [CiteSee](owlit://library/<id>); only papers that are rows. ${THIN}`
// What a search couldn't reach goes with the write, not in the memo; owlit records the searches themselves
const NOTE = `When your search couldn't reach something (a source failed, an index misses part of a venue, papers have no abstract), say so in one plain sentence as note on the write that adds those papers.`

function gatherPrompt(c: Thread, size: ThreadSize, withText: string[] = []) {
  const many =
    size === "many"
      ? `Gather as many papers as the question takes, up to about 200: for a venue or a year ("UIST 2026 papers"), go through it whole, page by page. Then group the rows: groups of at most about 30 papers, named for what they share, two levels at most, each with a one-line description (one); put each row in its group with its group field. ${ONE_GROUP}`
      : `Gather about ten papers: the ones that answer the question best, not the first ten found.`
  return `You are gathering papers into a thread in owlit for the user, who asked: «${c.asked.text}»

${ABOUT(c)}
1. Search with library_search (openalex by default; s2 for its ranking; arxiv for preprints), follow citations with library_related, and go through a journal's issues with library_journal. Don't add anything to the library.
2. ${many}
3. Write with thread_write, id ${c.id}, in batches of up to 25 rows. On the first write give a title: short, neutral, in the user's language, naming the topic rather than repeating the question. ${NOTE}
4. ${ANSWERS} ${FULL(withText)}
5. Last, write the memo. ${MEMO}
If you find nothing, write a one-sentence memo saying so, and in note what you tried. Your answer at the end is one line on what you did.`
}

// lookFor: what the user asked for this time, when it isn't the thread's question as it stands
function morePrompt(c: Thread, withText: string[] = [], lookFor?: string) {
  return `You are finding more papers for a thread in owlit. The question: «${c.asked.text}»${lookFor ? `\nThis time the user asks you to look for: «${lookFor}». Search for that, within the thread's question.` : ""}

${ABOUT(c)}
Search further than before: other sources, other words, older or newer years, the references and citations of the best papers there (library_related). Add 5 to 10 papers that aren't there yet and answer ${lookFor ? "what the user asks for" : "the question"} well, with thread_write id ${c.id} (rows). Don't add anything to the library. ${NOTE}
${ANSWERS} ${FULL(withText)}
${groupingsOf(c).some((col) => col.groups?.length) ? `Put each new row in the group it fits, or a new group when none does. ${ONE_GROUP}\n` : ""}Then update the memo if the new papers change it. ${MEMO}
Your answer at the end is one line on what you added.`
}

function fillPrompt(c: Thread, column: ThreadColumn, withText: string[] = []) {
  if (column.kind === "compare") return comparePrompt(c, column, withText)
  if (column.kind === "grouping") return groupingPrompt(c, column)
  return `You are answering a question for every paper of a thread in owlit. The thread's question: «${c.asked.text}». The column to fill: ${column.id} — «${column.question}».

${ABOUT(c)}
For every row without an answer in column ${column.id}, write one in cells: {"${column.id}": {"text": "…", "depth": "abstract"}} with thread_write id ${c.id}, in batches of up to 25 rows. Short answers, a phrase or a sentence, in the language of the column's question. Write "Not said" when the abstract doesn't say. Answer from the paper's whole abstract (library_get gives it). ${FULL(withText)}
Don't change other columns or the memo. Your answer at the end is one line on what you did.`
}

function comparePrompt(c: Thread, column: ThreadColumn, withText: string[]) {
  const lines = (column.sentences ?? []).map((s) => `- ${s.id}: «${s.text}»`).join("\n")
  return `You are setting every paper of a thread in owlit against sentences the user picked from their doc ${column.doc}. The thread's question: «${c.asked.text}». The column: ${column.id}. The user's sentences:
${lines}

${ABOUT(c)}
For every row without a cell in column ${column.id}, decide which one of the sentences the paper bears on most, and how: "supports" (its findings back the sentence), "challenges" (its findings cut against it or qualify it), or "related" (on the same matter without settling it). Write cells: {"${column.id}": {"rel": "supports", "sentence": "l2", "text": "a short phrase on why", "depth": "abstract"}} with thread_write id ${c.id}, in batches of up to 25 rows. When the paper speaks to none of them, write {"text": "No bearing", "depth": "abstract"} without rel. Judge from the whole abstract (library_get gives it). ${FULL(withText).replace("Answer them", "Judge them")} The sentences are the user's: never change or restate them.
Don't change other columns or the memo. Your answer at the end is one line on what you did.`
}

// A way of grouping the papers the user asked for: Owlit first settles the groups, then puts each paper
// in them. Asked again, it groups them afresh; what the user did to the groups owlit keeps itself.
function groupingPrompt(c: Thread, column: ThreadColumn) {
  const again = (column.groups ?? []).length > 0
  return `You are grouping the papers of a thread in owlit one way the user asked for: by «${column.question}». The thread's question: «${c.asked.text}». The grouping: ${column.id}.

${ABOUT(c)}
${again ? `The grouping has groups already and the user asked for it again: group the papers afresh, as you would now. Groups the user renamed, merged or ungrouped and papers they put in a group stay as they are whatever you write (thread_read shows them); build around them.
` : ""}1. From the papers' answers and abstracts, decide the groups: named for what the papers in them share, in the language of «${column.question}», each with a one-line description (one), two levels at most (a group with a parent can't be a parent itself), at most about 30 papers in a group. Write the whole grouping first: thread_write id ${c.id}, grouping ${column.id}, groups [...].
2. Then put every paper in its group: thread_write id ${c.id}, grouping ${column.id}, rows [{"id": "…", "group": "…"}], in batches of up to 25 rows. ${ONE_GROUP} A paper that fits none goes in no group (group "").
Don't change answers, other columns, the memo or other groupings. Your answer at the end is one line on what you did.`
}

// toRead: the rows to read, those answered from their abstracts or titles whose paper has a PDF to be
// had (the thread's Read N in full button counts the same rows; the others are left as they are)
function readPrompt(c: Thread, toRead: string[]) {
  return `You are reading in full ${toRead.length} papers of a thread in owlit that were answered only from their abstracts or titles. The question: «${c.asked.text}»

${ABOUT(c)}
Read these rows, and no others: ${toRead.join(", ")}. For each: add the paper to the library with library_add (the user asked for this; several in one call), then read the parts that matter with library_read and rewrite its answers in every column from the full text, with depth full and the words each rests on in quote, word for word. A paper whose PDF owlit can't get after all stays as it is; say how many at the end.
Then update the memo if what you read changes it. ${MEMO}
Your answer at the end is one line on what you read.`
}

// A recipe for a thread's column needs the column; the registry's callers find it first
const columnOf = (input: ThreadRecipeInput) => {
  if (!input.column) throw new Error("This recipe needs the column it fills.")
  return input.column
}

export const THREAD_RECIPES = {
  gather: {
    about: "thread",
    description: "gather a thread's papers for its question (a new thread: start it with thread_write first)",
    text: ({ thread, withText, size }) => gatherPrompt(thread, size ?? "few", withText),
  },
  "find-more": {
    about: "thread",
    description: "find more papers for a thread (look_for: what to look for this time, when it isn't the thread's question)",
    text: ({ thread, withText, lookFor }) => morePrompt(thread, withText, lookFor),
  },
  "ask-each": {
    about: "thread",
    description: "answer a question for every paper of a thread (column: the column's id or question; add a new question first with thread_write columns)",
    text: (input) => fillPrompt(input.thread, columnOf(input), input.withText),
  },
  group: {
    about: "thread",
    description: "group a thread's papers one way (column: the grouping's id or what it groups by; a new grouping starts with thread_write new_grouping)",
    text: (input) => fillPrompt(input.thread, columnOf(input), input.withText),
  },
  "read-in-full": {
    about: "thread",
    description: "read in full the papers of a thread answered only from their abstracts, and rewrite their answers",
    text: ({ thread, toRead }) => readPrompt(thread, toRead),
  },
} satisfies Record<string, Recipe<ThreadRecipeInput>>
