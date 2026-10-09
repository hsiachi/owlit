// How to use owlit, for Owlit when the user asks about owlit itself (owlit_help in owlit-mcp). It says
// how to do things and where they are, never why. It describes the app as it is: a change to a feature
// that one of these paragraphs mentions changes the paragraph in the same commit.
//
// Version 1 (2026-10-10): first version.

interface GuideTopic {
  id: string
  title: string
  text: string
}

const TOPICS: GuideTopic[] = [
  {
    id: "workspace",
    title: "The workspace",
    text: `The workspace is one folder on the user's Mac. Their docs are the Markdown files in it, papers live in library/, Owlit's topics in knowledge/, and owlit's own state in .owlit/. File › Open Workspace… (⌘O) opens another folder and File › Open Recent lists earlier ones. Other programs (Finder, Obsidian, git) can change the folder too; owlit follows along.`,
  },
  {
    id: "papers",
    title: "Adding papers",
    text: `In the Library, paste a DOI, an arXiv id or a paper's link into the find field at the top: owlit looks it up and offers to add it. PDFs can be dropped anywhere in the window, or chosen from the find field. File › Import a pitta Library… brings in a pitta library. To have papers found and added, ask in Chat ("Find recent papers on … and add the ones that fit"). Importing from Zotero or BibTeX isn't there yet.`,
  },
  {
    id: "pdfs",
    title: "Getting PDFs (library proxy)",
    text: `owlit fetches a paper's PDF by itself when one is free. For papers the user's library pays for, set up Settings › Library proxy once: pick the library, or paste any link opened through it. The user signs in in owlit's own window, and papers waiting on the sign-in carry on. When a publisher wants a person to pass a check, the paper says so and offers Check now, which shows the publisher's page in place; the Library's "Needs you" filter lists every such paper. A contact email and free API keys in Settings › Paper sources make lookups faster.`,
  },
  {
    id: "reading",
    title: "Reading and highlighting",
    text: `Open a paper from the Library to read it. Selecting text brings up a small bar: four highlight colours (keys 1–4), Copy (⌘C), Comment, and Ask Owlit, which sends the passage to Owlit. ⌘F finds in the PDF. The panel beside the PDF has Notes (one Markdown note per paper), Highlights, Knowledge and About. Status (Unread, Reading, Read), the star and tags are set from the paper's menu or the paper page.`,
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
    text: `Owlit runs a coding agent installed on this Mac: Claude Code, Codex, Gemini CLI or a custom command. Settings › Agents lists them with their state, the install command for one that is missing, and Check again; it can add a custom agent. An agent must be signed in: run its command (for example claude) once in Terminal. Settings › Agents also picks the agent and language for background work such as reading notes.`,
  },
  {
    id: "knowledge",
    title: "Knowledge",
    text: `Knowledge holds Owlit's topics: what the user has come to understand, one line per sentence, each saying who said it. Owlit writes and updates them in the background from what the user read, highlighted, wrote and said; a topic starts once two separate things the user touched are about the same question, so Knowledge is empty at first. On a line: Edit (the line becomes the user's, kept word for word), Ask Owlit, Remove (for good). A topic's menu has Update now, Pause updates, Rename, Merge into…, Split…, Archive and Delete.`,
  },
  {
    id: "undo",
    title: "Undoing Owlit's changes",
    text: `Every change Owlit makes outside a chat (a paper added, a note on a doc, a topic line, a file written) gets a line under its answer with View, and Undo where it can be undone. An edit Owlit proposes to a doc or a note is shown in place first, with Apply or Discard; once applied, ⌘Z undoes it in one step.`,
  },
  {
    id: "settings",
    title: "Settings",
    text: `Settings (⌘, or the gear at the bottom of the left rail) has six sections: Appearance (theme and paper tone), Agents, Paper sources (contact email, Semantic Scholar and OpenAlex keys), Library proxy, PDF reading (built-in, or MinerU for better text) and Privacy. Changes are kept as they are made; there is no Save.`,
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    text: `⌘K finds anything (papers, docs, chats). ⌘J opens Owlit. ⌘, opens Settings. ⌘O opens a workspace. ⌘N makes a new doc in Docs and a new chat in Chat. ⌘Z undoes, Owlit's last change included. Help › Keyboard Shortcuts (⌘/) lists them all.`,
  },
]

const LINKS = `To take the user to a place, write a link they can click: a Settings section as owlit://settings/<section> (appearance, agents, sources, proxy, reading, privacy), for example [Settings › Library proxy](owlit://settings/proxy), and the shortcut list as [Keyboard shortcuts](owlit://shortcuts). Say only what this guide says; if it doesn't cover something, say you don't know rather than guessing.`

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
