# Changelog

Each version's section goes, as it is, into the notes sent with its dmg (scripts/release-notes.mjs).

## Unreleased

- Owlit knows which browser the extension is in from the app that connects, so Dia and Arc are called by their names, and a sign-in opens there even when another browser is your default. A connection made before this learns its browser at its next request.

## 0.2.1

PDFs Owlit can't get alone now come through the owlit extension for your browser, using your library's access. Owlit no longer opens tabs in your browser, watches Downloads or runs a hidden browser.

The owlit extension
- Add to owlit from any paper's page, and Save PDF to owlit for a paper that lacks one, with your browser's access to journals; a PDF you open for such a paper comes to Owlit by itself. The first time, Owlit asks you to allow it. Settings › Papers › Browser extension.
- With the extension connected, PDFs a publisher only gives your browser come in by themselves, a few at a time; no tab opens. A paper Owlit can't get alone says so and offers the extension.
- When your library or a publisher wants you to sign in again, or a site wants a check, one line on Home and atop the Library says so, with one button: one sign-in covers every paper waiting on it, and Owlit goes on by itself afterwards (it also tries again every 15 minutes). It turns amber, with a notification, only for a paper you asked for, and goes away once those papers have their PDF another way.
- That sign-in or check opens in the browser and profile where the extension is, not in your default browser; Allow… opens the extension's own page to let it read that site.
- Since you left says how many PDFs came through your browser while you were away.
- The extension stays with the Owlit it was connected to: another Owlit on this Mac (a preview) is named in its popup and gets nothing from it.
- It also comes as a Firefox add-on.

Papers without a PDF
- A paper without a PDF is called the same thing in its row, the No PDF filter and its page (Finding, Not found, No access, No PDF there), and its page says what was tried, when, and when Owlit looks again. The Needs you filter is gone; a paper a publisher's check stopped is no longer amber.
- A paper Owlit couldn't look for because the network was down is looked for again at the next start, instead of waiting for Find PDF.
- A paper whose PDF was deleted outside Owlit says the PDF is gone, offers Look again, and is looked for at the next daily look.
- A PDF you drop while Owlit is downloading another copy is never lost.
- What was tried for each paper's PDF is written in a new shape the first time 0.2.1 opens a workspace; 0.2.0 can't read it after that.

Also
- Chats and threads no longer show an empty ring before their titles when nothing is happening.
- A starred paper's star is filled in black (white in dark mode) instead of yellow, so it never reads as waiting or a comment.

## 0.2.0

Threads replace Knowledge: a thread is the papers on a question and how they connect. An old `knowledge/` folder shows in Docs as ordinary Markdown.

Threads
- Type a question and Owlit collects papers on it in the background, with what each paper says.
- Find more papers, Ask each paper… (a column Owlit answers for every paper), Read all in full, Draft a review…, and a daily check on a watched thread.
- Papers Owlit finds in a chat go into a thread, with Undo and Keep it separate.
- The Library groups and sorts by thread, a paper says which threads it is in, and @ reaches threads in a doc, a note or a chat.
- Home's Since you left lists the threads Owlit started or added to while you were away.

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
