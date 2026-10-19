// How to use owlit, for Owlit when the user asks about owlit itself (owlit_help in owlit-mcp). It says
// how to do things and where they are, never why. It describes the app as it is: a change to a feature
// that one of these paragraphs mentions changes the paragraph in the same commit.

interface GuideTopic {
  id: string
  title: string
  text: string
}

const TOPICS: GuideTopic[] = [
  {
    id: "workspace",
    title: "The workspace",
    text: `The workspace is one folder on the user's Mac. Their docs are the Markdown files in it, papers live in library/, and owlit's own state in .owlit/ (the threads among it). File › Open Workspace… (⌘O) opens another folder and File › Open Recent lists earlier ones. Other programs (Finder, Obsidian, git) can change the folder too; owlit follows along.`,
  },
  {
    id: "papers",
    title: "Adding papers",
    text: `In the Library, paste a DOI, an arXiv id or a paper's link into the find field at the top: owlit looks it up and offers to add it. PDFs can be dropped anywhere in the window, or chosen from the find field. File › Import Papers… brings in a Zotero library, a BibTeX file or a folder of PDFs. To have papers found and added, ask in Chat ("Find recent papers on … and add the ones that fit").`,
  },
  {
    id: "pdfs",
    title: "Getting PDFs (library proxy)",
    text: `owlit fetches a paper's PDF by itself when one is free. For the rest, the owlit extension in the user's own browser fetches it in the background with their sign-ins and their library's access: install it from Settings › Papers › Browser extension and allow it once. For papers the user's library pays for, set up the library proxy once in Settings › Papers: pick the library, or paste any link opened through it; the user signs in to it in their browser. When the extension needs the user (a sign-in, the library's or a site's, a check at a site, or being allowed to read a site), Home and the top of the Library say so in one line per site, with its button; one sign-in covers every paper waiting for it. Without the extension, a paper owlit can't get alone says so and offers the extension, the publisher's page and Choose file. A PDF the user has can always be dropped on the paper. The Library's No PDF filter groups every paper without its PDF by why, and each paper's page says what was tried and when owlit looks again. A contact email and free API keys, also in Settings › Papers, make lookups faster.`,
  },
  {
    id: "reading",
    title: "Reading and highlighting",
    text: `Open a paper from the Library to read it. Selecting text brings up a small bar: four highlight colours (keys 1–4), Copy (⌘C), Comment, and Ask Owlit, which sends the passage to Owlit. ⌘F finds in the PDF. The panel beside the PDF has Notes (one Markdown note per paper), Highlights and About; About lists the threads that hold the paper. Status (Unread, Reading, Read), the star and tags are set from the paper's menu or the paper page.`,
  },
  {
    id: "citing",
    title: "Citing papers",
    text: `In a doc or a paper's note, type @ and pick a paper; it reads as "Author Year" and is a link on disk. A paper's menu has Copy citation (APA 7) and Copy BibTeX, for one paper or several selected.`,
  },
  {
    id: "docs",
    title: "Docs",
    text: `Docs are the Markdown files in the workspace, shown as the folder tree in Docs. ⌘N in Docs makes a new doc; its first line is the title and names the file. Every change is saved. Selecting text offers Ask Owlit and a comment icon (⌥⌘M). Comments, Owlit's, the user's and a shared doc's readers', sit in a column to the right of the doc, each level with its words, stored beside the file, not in it; the header's comment button shows or hides the column. A comment is flat: replies go to the whole comment, and Owlit doesn't answer replies; Ask Owlit on a comment opens a chat about it. Asking Owlit to review a doc leaves comments. A doc's menu has Versions… for earlier versions. Deleting moves the file to the system Trash, with Undo.`,
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
    id: "threads",
    title: "Threads",
    text: `A thread is papers Owlit gathered for a question, with one line from each paper about it and a short memo of Owlit's reading. Ask in a chat ("find papers on…") or type a question on the Threads page (pick about 10 papers, or as many as it takes, e.g. a venue's proceedings). Papers Owlit only found stay on the thread; opening one or Add to Library brings it into the Library. On a thread: Find more papers, Ask each paper… (a question becomes a column; Compare with a doc… sets every paper against sentences of the user's), Read all in full, Draft a review…. A page number points to the words an answer rests on; an answer without one comes from the abstract. Rewrite any sentence or answer (it stays the user's) or remove a paper (it doesn't come back). The ⋯ menu has Move to project, Export as CSV and Delete.`,
  },
  {
    id: "undo",
    title: "Undoing Owlit's changes",
    text: `Every change Owlit makes outside a chat (a paper added, a note on a doc, a topic line, a file written) gets a line under its answer with View, and Undo where it can be undone. An edit Owlit proposes to a doc or a note is shown in place first, with Apply or Discard; once applied, ⌘Z undoes it in one step.`,
  },
  {
    id: "memory",
    title: "What Owlit keeps in mind",
    text: `Owlit keeps a short list about the user for this workspace: how they like it to work ("cite as (Author, Year)", "answer in Chinese") and facts about their work ("I'm writing my thesis on…"). Every chat starts with it, whichever agent runs, and so does background work. Owlit adds a line when the user tells it to remember something or says "from now on", when they correct how it works, or when they state a fact about their work; the answer's result card shows "Remembered" with Undo. The list is in Settings › Owlit › What Owlit keeps in mind (Edit, Remove, Add one) and in the file .owlit/memory.md. The agents' own memory features are off inside owlit; this list is the only memory.`,
  },
  {
    id: "settings",
    title: "Settings",
    text: `Settings (⌘, or the gear at the bottom of the left rail) has four sections: Owlit (the name Owlit calls the user, what Owlit keeps in mind about them, the agent and language for background work such as digests, and whether owlit records what the user does), Agents (installed agents and the Owlit engine's sign-ins), Papers (contact email and Semantic Scholar and OpenAlex keys, the library proxy, and how PDFs are read: built-in, or MinerU for better text) and Appearance (theme and paper tone). Changes are kept as they are made; there is no Save.`,
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
