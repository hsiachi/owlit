# Changelog

Each version's section goes, as it is, into the notes sent with its dmg (scripts/release-notes.mjs).

## Unreleased

- Owlit can now reply to and resolve your comments, star, tag and mark your papers read, rename and watch threads, and take back its own comments and highlights, each within its role and recorded with Undo: a Reviewer changes nothing of yours, an Assistant does these without asking and asks before touching your words, a Co-author goes ahead. What each role may do is decided in one place for every route in, the `owlit` command included, and Claude Code's editing tools and shell are kept out of owlit's own folders in every role.
- A doc's Versions lists every change and who made it: your edits, Owlit's and another program's. Undo, there or under an answer, puts back just the passage that change touched and keeps what you wrote since; a passage you edited after it stays, and owlit says which. In a thread Undo takes back the rows and answers one write added, on a paper one field.
- Keep mine, when a doc changed on disk while you edited it, keeps the other program's text in Versions, under yours. A change another program makes while Owlit works no longer passes for Owlit's.
- Since you left counts from when you left, also when owlit was closed, and names what changed: the papers added to each thread, the docs Owlit wrote or edited, the comments it left.
- A doc shows a thin line beside the paragraphs Owlit or another program changed since you last looked, with who and when on hover.
- The dots on threads, comments, chats and digests, and the result card under an answer with its Undo, survive a restart and agree across windows; a background run's changes can be undone from its chat.
- When a recheck or your reply shows one of Owlit's comments was wrong, Owlit corrects the comment itself instead of only saying so underneath: it reads "edited", shows what it first said ("was: …"), and is new to you again; your replies stay.
- A thread's About names the batch Owlit answered again after you read a paper in full: "Answered again from the full text".
- Clicking a citation in a doc opens the paper beside the doc, at the cited sentence, where Owlit's panel docks: with its page, the Digest | PDF switch, its full page and Close. Esc puts it away and the cursor back at the citation; ⇧⌘J brings Owlit back in its place; ⌘-click, or a window narrower than 1100px, opens the paper's own page as before. Reading it there counts as reading the paper.
- A chat answer says under it what it was built from, from what Owlit actually opened: "From 3 papers · 2 in full · 1 abstract only · 1 without a PDF". Resting on a count marks those papers' citations in the answer, and Owlit says "from the abstract only" in the sentence itself when that is all it read.
- Resting on a citation of a paper, in a chat, a doc, a comment or a thread's page, shows a card: the paper, the sentence the claim rests on, its page, what Owlit read, how far you read it, and "Owlit couldn't find this sentence in the paper" when it isn't there. A thread cell's popover is the same card with Rewrite under it.
- Clicking a citation in a doc opens the paper with its sentence ringed, as chat citations do, and Back returns to the doc and to the thread page scrolled where you left them.
- Owlit cites papers with the sentence it rests on in its comments, replies and Go through, as it does in chats, and a thread exported as a doc keeps each answer's sentence with its page.
- A thread answers the papers whose text is already in your library from the full text from the start. An answer from a paper's title only (it has no abstract) is greyed in the row and the table, counted in About, and written "title only" in the CSV.
- A digest's header says when it was read from the text without the figures, from fewer pages than the PDF has, or in another language than the paper's.
- Owlit writes a digest only when you ask: from the paper's Digest side, its menu, a chat, or by starring it. Opening a paper no longer starts one, and the setting "Digests for every paper" is gone.
- A paper opens on the side you last read of it, the digest or the PDF, each where you left it; a digest you asked for opens as soon as it is ready.
- A paper turns Read by itself when you reach its end: most of its pages read in the PDF, or its digest scrolled to the end after two minutes on it. A toast offers Undo, and a status you set back stays. A paper without a PDF turns Reading too, from its digest or abstract.
- Hovering a paper's status says how far you got, such as "12 min, pp. 1–6" or "the digest, 3 min", and agents asking what you read hear the same: read in full, looked at, or not opened here.
- Only papers Owlit added and you haven't opened are named lighter in docs and chats; papers you imported look as usual.
- Once you read a paper in full, Owlit answers its thread rows again from the full text and looks again at its comments that cite it, without a setting.
- Owlit no longer looks at your docs or your library on its own: the "On its own" setting and what ran under it (comments on a doc you open or stop editing, the daily look over your docs, a digest and threads for a paper that landed, going through a Meetings folder) are gone for now. Go through still runs from a doc's menu.
- Owlit knows which browser the extension is in from the app that connects, so Dia and Arc are called by their names, and a sign-in opens there even when another browser is your default. A connection made before this learns its browser at its next request.
- Sign in and Open on a waiting line bring the browser with the extension to the front, not only a new tab in it.
- Signing in to Tsinghua's library opens tlink's sign-in page instead of a 500 error.
- When Owlit hands work to helpers and its answer pauses for them, the chat keeps working until they report, instead of showing them stopped.
- Background work that fails says why in Owlit's words, such as an agent that isn't signed in, and a digest no longer takes in what Owlit's helpers wrote along the way.
- A paper a search named one way and your library files another way is the same paper in its threads: Owlit can answer its row from the full text, and your corrections to its details reach Export as a doc, the CSV and what Owlit reads of the thread.
- A comment Owlit held while you were typing lands in the workspace it was made in when you switch to another, never in a doc of the same name there.
- Turning off Remember what I do in owlit stops the record of what you do, but no longer stops digests for papers you open or Owlit's look at docs you open.
- Since you left lists Owlit's work that started before you left and finished after.
- Choosing a language during the first launch keeps you on that step, and Settings opened before a workspace no longer shows an error.
- A reply you typed on a comment is still there when its card opens again.
- A link to a paper in a big thread opens its row even when its group is folded or shows only its first papers, and a paper you removed from a thread is struck through where its summary still names it.
- Compare with a doc keeps sentences whole at "et al." and initials, and offers short Chinese sentences.
- Previous and Next keep working under the Unread filter after the open paper turns Reading.
- A thread's answer for a paper with no abstract says it came from the title only, and a paper with no PDF no longer offers to highlight in it.
- @ opens right after Chinese text, and on a full-width ＠.
- The last words typed in a paper's note reach the disk when you quit, reload or open another workspace right after typing.
- A paper or thread that changed while Owlit was opening your workspace shows its change, instead of how it was a moment before.
- A workspace in a folder macOS keeps Owlit out of (such as Documents, after Don't Allow) says where to allow it, and stays in your recent workspaces; so does one on a drive that isn't plugged in.
- After Owlit crashed or was force-quit, its workspace opens again instead of sometimes saying it is open in another Owlit.
- Your API keys survive a Keychain prompt you deny, or a new build Keychain doesn't know yet: they show as not set and come back once Keychain lets Owlit read them.
- An error Owlit didn't expect names the file and why (locked in Finder, disk full, read-only) where it can, and is in the diagnostics.
- A link in your workspace that leads outside it, or into Owlit's own folders, no longer shows in Docs, and Owlit and agents can't read or write through it.
- Clicking a file in Docs opens documents, pictures and media in their app; anything that could run, such as a .command file, is shown in Finder instead.
- ⌘B is Bold again in docs, notes and the composer; it no longer hides the list panel. The window can't get narrow enough to lose the sidebar or Settings' sections.
- ⌘K stays quick with a large library, showing the best 20 of each kind.

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
