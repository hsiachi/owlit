// How to use owlit, for Owlit when the user asks about owlit itself (owlit_help in owlit-mcp). It says
// how to do things and where they are, never why. It describes the app as it is: a change to a feature
// that one of these paragraphs mentions changes the paragraph in the same commit.
//
// Version 1 (2026-10-10): first version.
// Version 2 (2026-10-12): Settings has four sections (Owlit, Agents, Papers, Appearance).

interface GuideTopic {
  id: string
  title: string
  text: string
}

const TOPICS: GuideTopic[] = [
  {
    id: "workspace",
    title: "The workspace",
    text: `The workspace is one folder on the user's Mac. Their docs are the Markdown files in it, papers live in library/, and owlit's own state in .owlit/ (the collections among it). File › Open Workspace… (⌘O) opens another folder and File › Open Recent lists earlier ones. Other programs (Finder, Obsidian, git) can change the folder too; owlit follows along.`,
  },
  {
    id: "papers",
    title: "Adding papers",
    text: `In the Library, paste a DOI, an arXiv id or a paper's link into the find field at the top: owlit looks it up and offers to add it. PDFs can be dropped anywhere in the window, or chosen from the find field. File › Import a pitta Library… brings in a pitta library. To have papers found and added, ask in Chat ("Find recent papers on … and add the ones that fit"). Importing from Zotero or BibTeX isn't there yet.`,
  },
  {
    id: "pdfs",
    title: "Getting PDFs (library proxy)",
    text: `owlit fetches a paper's PDF by itself when one is free. For papers the user's library pays for, set up the library proxy once in Settings › Papers: pick the library, or paste any link opened through it. The user signs in in owlit's own window. When owlit can't get a PDF by itself (a publisher's check, a sign-in, or the ACM, which only lets browsers in), the paper offers Get it in your browser: owlit opens the PDF, or the paper's page, in the user's own browser behind its window and takes the file from Downloads; Get them on Home or under the Library's "Needs you" filter does several, one at a time. A contact email and free API keys, also in Settings › Papers, make lookups faster.`,
  },
  {
    id: "reading",
    title: "Reading and highlighting",
    text: `Open a paper from the Library to read it. Selecting text brings up a small bar: four highlight colours (keys 1–4), Copy (⌘C), Comment, and Ask Owlit, which sends the passage to Owlit. ⌘F finds in the PDF. The panel beside the PDF has Notes (one Markdown note per paper), Highlights and About; About lists the collections that hold the paper. Status (Unread, Reading, Read), the star and tags are set from the paper's menu or the paper page.`,
  },
  {
    id: "citing",
    title: "Citing papers",
    text: `In a doc or a paper's note, type @ and pick a paper; it reads as "Author Year" and is a link on disk. A paper's menu has Copy citation (APA 7) and Copy BibTeX, for one paper or several selected.`,
  },
  {
    id: "docs",
    title: "Docs",
    text: `Docs are the Markdown files in the workspace, shown as the folder tree in Docs. ⌘N in Docs makes a new doc; its first line is the title and names the file. Every change is saved. Selecting text offers Chat with Owlit. Asking Owlit to review a doc leaves notes in its margin, stored beside the file, not in it. A doc's menu has Versions… for earlier versions. Deleting moves the file to the system Trash, with Undo.`,
  },
  {
    id: "owlit",
    title: "Talking to Owlit",
    text: `⌘J (or the feather at the top right) opens Owlit from anywhere outside Chat: a small ask bar that becomes a side panel once a conversation starts. It sees the paper or doc on screen and any selection sent to it. Work that takes minutes (find and add papers, compare papers, review a draft) is better handed off from the Chat page; the chat list shows which chats are working, waiting on the user, or finished since they last looked. Home lists everything waiting on the user. The composer picks the agent, the model and how often Owlit asks permission.`,
  },
  {
    id: "agents",
    title: "Agents (Claude Code, Codex, Gemini CLI)",
    text: `Owlit runs a coding agent installed on this Mac: Claude Code, Codex, Gemini CLI or a custom command. Settings › Agents lists them with their state, the install command for one that is missing, and Check again; it can add a custom agent. An agent must be signed in: run its command (for example claude) once in Terminal. Settings › Owlit picks the agent, model and language for background work such as digests.`,
  },
  {
    id: "collections",
    title: "Collections",
    text: `A collection is papers Owlit gathered for a question, with one line from each paper about it and a short memo of Owlit's reading. Ask in a chat ("find papers on…") or type a question on the Collections page (pick about 10 papers, or as many as it takes, e.g. a venue's proceedings). Papers Owlit only found stay on the collection; opening one or Add to Library brings it into the Library. On a collection: Find more papers, Ask each paper… (a question becomes a column; Compare with a doc… sets every paper against sentences of the user's), Read all in full, Draft a review…. A page number points to the words an answer rests on; an answer without one comes from the abstract. Rewrite any sentence or answer (it stays the user's) or remove a paper (it doesn't come back). The ⋯ menu has Watch for new papers, Move to project, Export as CSV and Delete.`,
  },
  {
    id: "undo",
    title: "Undoing Owlit's changes",
    text: `Every change Owlit makes outside a chat (a paper added, a note on a doc, a topic line, a file written) gets a line under its answer with View, and Undo where it can be undone. An edit Owlit proposes to a doc or a note is shown in place first, with Apply or Discard; once applied, ⌘Z undoes it in one step.`,
  },
  {
    id: "settings",
    title: "Settings",
    text: `Settings (⌘, or the gear at the bottom of the left rail) has four sections: Owlit (the name Owlit calls the user, the agent and language for background work such as digests, and whether owlit remembers what the user does), Agents (installed agents and the Owlit engine's sign-ins), Papers (contact email and Semantic Scholar and OpenAlex keys, the library proxy, and how PDFs are read: built-in, or MinerU for better text) and Appearance (theme and paper tone). Changes are kept as they are made; there is no Save.`,
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    text: `⌘K finds anything (papers, docs, chats). ⌘J opens Owlit. ⌘, opens Settings. ⌘O opens a workspace. ⌘N makes a new doc in Docs and a new chat in Chat. ⌘Z undoes, Owlit's last change included. Help › Keyboard Shortcuts (⌘/) lists them all.`,
  },
]

const LINKS = `To take the user to a place, write a link they can click: a Settings section as owlit://settings/<section> (owlit, agents, papers, appearance), or a part of one (background, privacy, sources, proxy, reading), for example [Settings › Papers › Library proxy](owlit://settings/proxy), and the shortcut list as [Keyboard shortcuts](owlit://shortcuts). Say only what this guide says; if it doesn't cover something, say you don't know rather than guessing.`

export function guide(topic?: string) {
  const list = TOPICS.map((t) => `- ${t.id}: ${t.title}`).join("\n")
  if (!topic) return `How to use owlit. Ask for one topic:\n${list}\n\n${LINKS}`
  const want = topic.trim().toLowerCase()
  // Its id, then a word of its title, then a word anywhere in it
  const found =
    TOPICS.find((t) => t.id === want) ?? TOPICS.find((t) => t.title.toLowerCase().includes(want)) ?? TOPICS.find((t) => t.text.toLowerCase().includes(want))
  if (!found) return `There is no topic "${topic}". The topics:\n${list}`
  return `${found.title}\n\n${found.text}\n\n${LINKS}`
}
