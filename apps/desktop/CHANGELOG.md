# Changelog

Each version's section goes, as it is, into the notes sent with its dmg (scripts/release-notes.mjs).

## 0.2.0

Collections take the place of Knowledge. A workspace's old `knowledge/` folder stays where it is, as ordinary Markdown in Docs.

Collections
- Type a question and Owlit collects papers on it in the background, with what each paper says.
- Find more papers, Ask each paper… (a column Owlit answers for every paper), Read all in full, Draft a review…, and a daily check on a watched collection.
- Papers Owlit finds in a chat go into a collection, with Undo and Keep it separate.
- The Library groups and sorts by collection, a paper says which collections it is in, and @ reaches collections in a doc, a note or a chat.
- Home's Since you left lists the collections Owlit started or added to while you were away.

Getting PDFs
- A paper Owlit can't get alone (a publisher's check, a library sign-in, the ACM) waits for your own browser: Get it in your browser on the paper, Get them on Home and under Needs you. The PDF is taken from Downloads, after a restart too.
- Every paper without a PDF says why, and the Library has a No PDF filter grouped by why.
- ACL papers come from the ACL Anthology; papers without a DOI are looked for by title.
- Needs you counts what really needs you, and its dot leads to Get them.
- An Elsevier key refused off campus is not called invalid.

Reading
- The reader shows what Owlit cited and where you stayed; time on a digest counts as reading.
- Papers you haven't read are a step lighter wherever they are named.
- Agents can ask what you have been doing lately.

Chats
- ⇧⌘J opens an empty chat after 30 minutes away, with earlier chats about the page.
- What you type waits with its chat, on the Chat page and in the panel.
- Claude Code, Codex and npm use your system proxy, so Claude Code no longer gets 403 behind one.
- A ready Claude Code or Codex shows its version where you pick the agent.

Sharing and the Library
- Share a doc by link: readers open it in their browser with the papers it cites, and can leave comments.
- Citation counts for papers in the Library, from OpenAlex, kept up to date.
- In the Library a click goes one step in: row, card, paper.
- Imports say what they need; a stopped import says why, with Details.
- A BibTeX file with the same key twice imports both papers.

Also
- A new app icon: a feather on a forest-green tile.
- Quitting while Owlit fetches PDFs in the background no longer hangs.
- Owlit is open source (AGPL-3.0): https://github.com/hsiachi/owlit

## 0.1.0

The first version for friends.

- Library, papers with digests, docs, chats with Claude Code or Codex, and Knowledge.
- Import a Zotero library, a BibTeX file or a folder of PDFs (File › Import Papers…).
- Owlit sets up Claude Code or Codex for itself; no Node or npm needed.
- The `owlit` command for Terminal (Owlit › Install Command Line Tool…).
