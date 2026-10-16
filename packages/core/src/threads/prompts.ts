import { groupingsOf, threadUri, type Thread, type ThreadColumn } from "@owlit/protocol"

// What a background session is told for each kind of thread work. It has owlit's tools only (the
// owlit MCP server), no one to ask, and its answer is shown nowhere: everything it does goes through
// thread_write, so the user sees it in the thread with Owlit's dots.

export type GatherSize = "few" | "many"

const ABOUT = (c: Thread) =>
  `The thread is ${c.id} (${threadUri(c.id)}). Read it first with thread_read: what is there, what the user rewrote (keep it) and removed (never bring it back).`

const ANSWERS = `Each row's answer is one plain sentence on what that paper found about the question, in the language the question is in. Write it from the paper's whole abstract (library_get gives it for an id a search returned; a search's own line cuts the abstract short) with depth abstract. Only a paper in the user's library with full text may be answered from its full text (library_read), with depth full and the words it rests on in quote, word for word.`

// A paper can be in several groups; Owlit keeps that rare, so overlap stays visible rather than everywhere
const ONE_GROUP = `A paper usually goes in one group; give it a second (groups: ["a", "b"]) only when it is really used in both.`

const MEMO = `The memo is at most four sentences on what the papers say together: where they agree, where they differ, what none of them covers. It describes the papers, not your search; it doesn't tell the user what to write or conclude. Name a paper in it as a link labelled with its short title, the words before the title's colon or dash: [CiteSee](owlit://library/<id>); only papers that are rows.`
// What a search couldn't reach goes with the write, not in the memo; owlit records the searches themselves
const NOTE = `When your search couldn't reach something (a source failed, an index misses part of a venue, papers have no abstract), say so in one plain sentence as note on the write that adds those papers.`

export function gatherPrompt(c: Thread, size: GatherSize) {
  const many =
    size === "many"
      ? `Gather as many papers as the question takes, up to about 200: for a venue or a year ("UIST 2026 papers"), go through it whole, page by page. Then group the rows: groups of at most about 30 papers, named for what they share, two levels at most, each with a one-line description (one); put each row in its group with its group field. ${ONE_GROUP}`
      : `Gather about ten papers: the ones that answer the question best, not the first ten found.`
  return `You are gathering papers into a thread in owlit for the user, who asked: «${c.asked.text}»

${ABOUT(c)}
1. Search with library_search (openalex by default; s2 for its ranking; arxiv for preprints), follow citations with library_related, and go through a journal's issues with library_journal. Don't add anything to the library.
2. ${many}
3. Write with thread_write, id ${c.id}, in batches of up to 25 rows. On the first write give a title: short, neutral, in the user's language, naming the topic rather than repeating the question. ${NOTE}
4. ${ANSWERS}
5. Last, write the memo. ${MEMO}
If you find nothing, write a one-sentence memo saying so, and in note what you tried. Your answer at the end is one line on what you did.`
}

export function morePrompt(c: Thread) {
  return `You are finding more papers for a thread in owlit. The question: «${c.asked.text}»

${ABOUT(c)}
Search further than before: other sources, other words, older or newer years, the references and citations of the best papers there (library_related). Add 5 to 10 papers that aren't there yet and answer the question well, with thread_write id ${c.id} (rows). Don't add anything to the library. ${NOTE}
${ANSWERS}
${groupingsOf(c).some((col) => col.groups?.length) ? `Put each new row in the group it fits, or a new group when none does. ${ONE_GROUP}\n` : ""}Then update the memo if the new papers change it. ${MEMO}
Your answer at the end is one line on what you added.`
}

export function fillPrompt(c: Thread, column: ThreadColumn) {
  if (column.kind === "compare") return comparePrompt(c, column)
  if (column.kind === "grouping") return groupingPrompt(c, column)
  return `You are answering a question for every paper of a thread in owlit. The thread's question: «${c.asked.text}». The column to fill: ${column.id} — «${column.question}».

${ABOUT(c)}
For every row without an answer in column ${column.id}, write one in cells: {"${column.id}": {"text": "…", "depth": "abstract"}} with thread_write id ${c.id}, in batches of up to 25 rows. Short answers, a phrase or a sentence, in the language of the column's question. Write "Not said" when the abstract doesn't say. Answer from the paper's whole abstract (library_get gives it); a paper in the user's library with full text may be answered from it (library_read), with depth full and the words in quote.
Don't change other columns or the memo. Your answer at the end is one line on what you did.`
}

function comparePrompt(c: Thread, column: ThreadColumn) {
  const lines = (column.sentences ?? []).map((s) => `- ${s.id}: «${s.text}»`).join("\n")
  return `You are setting every paper of a thread in owlit against sentences the user picked from their doc ${column.doc}. The thread's question: «${c.asked.text}». The column: ${column.id}. The user's sentences:
${lines}

${ABOUT(c)}
For every row without a cell in column ${column.id}, decide which one of the sentences the paper bears on most, and how: "supports" (its findings back the sentence), "challenges" (its findings cut against it or qualify it), or "related" (on the same matter without settling it). Write cells: {"${column.id}": {"rel": "supports", "sentence": "l2", "text": "a short phrase on why", "depth": "abstract"}} with thread_write id ${c.id}, in batches of up to 25 rows. When the paper speaks to none of them, write {"text": "No bearing", "depth": "abstract"} without rel. Judge from the whole abstract (library_get gives it); a paper in the user's library with full text may be judged from it (library_read), with depth full and the words in quote. The sentences are the user's: never change or restate them.
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

export function readPrompt(c: Thread) {
  return `You are reading in full the papers of a thread in owlit that were answered only from their abstracts. The question: «${c.asked.text}»

${ABOUT(c)}
For each row whose answers are all depth abstract: add the paper to the library with library_add (the user asked for this; several in one call), then read the parts that matter with library_read and rewrite its answers in every column from the full text, with depth full and the words each rests on in quote, word for word. A paper whose PDF owlit can't get stays as it is; say how many at the end.
Then update the memo if what you read changes it. ${MEMO}
Your answer at the end is one line on what you read.`
}

export function checkPrompt(c: Thread, since: number) {
  const from = new Date(since).getFullYear()
  return `You are checking for new papers on a thread's question in owlit, which the user asked owlit to watch. The question: «${c.asked.text}»

${ABOUT(c)}
Search for papers published since ${from} (year filter "${from}-"), and follow who cites the best papers there (library_related cited_by, sort newest). Add only papers that are new, not there yet, and answer the question, with thread_write id ${c.id}. Most checks find nothing: then write nothing.
${ANSWERS}
Your answer at the end is one line on what you found.`
}

// The user read one of a thread's papers in full: its row's answers are given again from the whole text
export function rereadPrompt(c: Thread, paperId: string) {
  return `You are answering again, from its full text, one paper of a thread in owlit: the user has just read it in full. The thread's question: «${c.asked.text}». The paper: ${paperId}.

${ABOUT(c)}
Read the parts of the paper that matter with library_read, and what the user highlighted in it with library_highlights. Then rewrite that row's cells, in every column, from the full text, with depth full and the words each rests on in quote, word for word, with thread_write id ${c.id} (one row, id ${paperId}). Leave a cell as it is when the full text says the same as the answer there; never change what the user rewrote. Update the memo only if what you read changes it. ${MEMO}
Your answer at the end is one line on what you changed.`
}

// A paper landed in the library from outside a thread: Owlit sees whether it answers one of the threads'
// questions, and gathers it there if it does
export function relatePrompt(threads: readonly Thread[], paperId: string) {
  const list = threads.map((c) => `- ${c.id}: «${c.asked.text}»`).join("\n")
  return `You are looking at a paper that has just come into the user's library in owlit: ${paperId}. Read its abstract with library_get (and its full text with library_read if it has one).

These are the user's threads, each a question with papers gathered for it:
${list}

For each thread whose question this paper answers well (not one it merely touches), read the thread first with thread_read (what the user removed never comes back), then add the paper as a row with thread_write, with its answers in the thread's columns. ${ANSWERS}
Most papers belong in no thread: then write nothing. Your answer at the end is one line on what you did.`
}
