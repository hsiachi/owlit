import { groupingsOf, threadUri, type Thread, type ThreadColumn, type ThreadSize } from "@owlit/protocol"
import type { Recipe } from "./index.ts"

// The recipes for work on a thread: a chat owlit starts from a thread's button is given one as its first
// message, and an agent in any chat reads one through owlit_help before doing the same work there.
// Everything the work does goes through thread_write, so the user sees it in the thread with Owlit's dots.

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
    text: ({ thread, withText }) => gatherPrompt(thread, thread.size ?? "few", withText),
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
