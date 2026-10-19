# Changelog

Each version's section goes, as it is, into the notes sent with its dmg (scripts/release-notes.mjs).

## Unreleased

- A digest you ask for starts at once, beside whatever else Owlit is doing, instead of waiting its turn behind a thread's work. The paper's page says "Owlit is reading this paper…" with Stop.
- A digest that couldn't be written says why on the paper's page ("Claude Code's usage limit is reached; it resets at 2:20", "Owlit was closed before it finished"), with Retry, and still says so after you restart owlit. Retry carries on where it stopped.
- A thread's work (Gather, Find more papers, Ask each paper, Group another way, Read N in full) starts at once, and several can run together on one thread or on several. The thread says what each is doing ("Reading papers in full… and 1 more") with Stop.
- Thread work that couldn't finish says why on the thread ("Claude Code's usage limit is reached; it resets at 2:20"), with a Retry that works and carries on where it stopped, still there after you restart owlit.
- Owlit answers your reply under one of its comments at once, instead of waiting behind a thread's work, and remembers what you said in earlier replies under the same comment. While it answers the card says so with Stop; if it couldn't, the card says why with Retry, still there after you restart owlit.
- Go through runs beside whatever else Owlit is doing. The doc's menu says "Owlit is going through…" with Stop going through, and if it couldn't finish, says why with Retry going through, after a restart too.
- Ask Owlit in a chat to "read the rest in full", find more papers for a thread, ask each paper something or group them another way, and it does the same work the thread's button does, there in the chat.
- Asking Owlit in a chat for a digest of a paper with no PDF or text now gets "no digest" rather than a promise. Ask Owlit in a chat to fix a digest and it rewrites it; the chat's card says so and Undo puts the old one back.
- When your agent's usage limit is reached, owlit says so in one sentence with when it resets ("Claude Code's usage limit is reached; it resets at 2:20"), and a digest, thread run or reply under a comment that hits the limit stops there instead of trying again.
- Owlit's memory keeps lines written only in Chinese: a second one is no longer taken for the first.
- Settings › Owlit › Remember what I do says what turning it off costs ("papers you finish stay as you left them") and that it applies on this Mac.
- A reply survives closing or reloading the window: open it again and the reply is still live, with Stop and whatever it waits on you for, and it ends where you can see it.
- Type while Owlit works and your message waits under the reply ("Sends when Owlit finishes", × to take it back), then goes when the reply ends. With a command waiting on you, typing answers it Don't allow and Owlit carries on with your words next; files and mentions in the composer go with your message.
- Chinese answers come on word by word, as English ones do, instead of in lumps.
- Stop works at once, even while the agent is still starting, and Esc in the composer stops too. After two minutes with no word from the agent, the reply says so ("No word from Claude Code for 2 min") with Stop.
- The composer takes lists: "- ", "* " or "1. " at a line's start begins one, Shift+Enter adds an item (on an empty one, ends the list), Tab indents. Enter still sends, and the list goes as Markdown.
- The ⌘J ask bar is the same composer as everywhere else: @-mentions, the agent and role pickers, and what you typed is still there after Esc.
- Ask Owlit on a passage from a paper or doc the docked chat isn't about starts a new chat in the panel, and New chat keeps the passage.
- Retrying a broken reply no longer puts its edits on the card of the answer before it, and a Write step in a chat counts what it changed, as the card does.
- Keep Owlit out of a doc now holds: Owlit can't edit, delete, move or comment on that doc, in any role and on every agent.
- An edit Owlit asks to make outside your docs (outside the workspace, in owlit's own folders, in a hidden folder) is refused before it lands, in every role.
- A reply cut off because you quit owlit or opened another workspace says so ("Stopped when owlit closed", "Stopped when you switched workspace") with Retry, instead of looking as if you pressed Stop.
- In a Reviewer chat, Owlit can reply under your comments; resolving them still needs Assistant or Co-author.
- Memory lines you wrote or changed in Settings stay yours: Owlit adds lines and changes its own, but no longer rewrites or removes yours.
- In Assistant, an agent's request to run a command is refused instead of asking you; Co-author still asks.
- A background run on Codex works in Codex's read-only mode, whichever mode Codex was left in.
- An agent outside owlit using owlit's tools, or a program on the workspace's socket, can no longer act as a chat by naming one: only the agents owlit starts work within a chat's role.
- In a Reviewer chat, Owlit may add papers to your library and rename its own threads, on every agent; the papers show as added by Owlit and you can undo each. Reviewer and Assistant now say they "never change anything with commands": reading with commands is fine in every role.
- Ask Owlit in a chat to go through a meeting's transcript, reviews or someone's comments, and it starts the same Go through as the doc's menu: its reading lands beside the material, its points as comments on your docs. A transcript attached to the chat works too; its reading goes in your Meetings folder.
- An answer's "From N papers" line counts a paper "in full" only when Owlit read its whole text; one read in part is "from the text", or "from pp. 4–5" when Owlit asked for those pages.
- When Owlit answers a thread's paper again from the full text, the cell says "Changed after reading in full · p. N" in Owlit's colour until you've seen it, and its card keeps the earlier answer under the new one ("was: … · from the abstract"). In About, a Read in full batch says for how many papers the answers changed.
- On Claude Code, Owlit's reads stay inside the workspace folder in every role, for its file tools and its shell commands alike, and your papers and owlit's own state are read through owlit's tools, so what it read leaves its trace. A Reviewer or Assistant's commands write nothing in the workspace; a Co-author's write inside it only. Background work (digests, threads) runs under a Reviewer's controls. Settings › Owlit › Privacy says what the agent reads.
- A thread's long tasks say their size before they start. "Read all in full" is now "Read 12 in full", counting the papers answered from their abstracts that have a PDF to read, with "About 10 minutes with your agent · 3 have no PDF and are left out" on hover; the run reads those rows and no others. "Find more papers…" opens a field, What to look for, filled with the thread's question for you to narrow; what you ask for is kept on the thread as a question asked.
- A role belongs to its chat: a new chat starts as Assistant, whatever the last one used, and a role picked in the composer changes that chat alone ("In this chat, Owlit works as"). A chat in another role says so above its first message, and in the Owlit panel's header after its title. The agent and model you pick stay the default for new chats, as before.
- What each role lets Owlit do is said in one set of lines, read off the rule core decides by: in the composer's role menu, on the first launch's Agent step (as Assistant, its usual role), under Settings › Owlit › What Owlit may do, and to the agent itself in its role note and tool descriptions. Delete and move no longer claim to ask "when your settings say so".
- In Assistant, Owlit's edits to your docs no longer wait on an Allow card: they land at once as proposals, recorded as Owlit's. The doc shows each changed passage marked, with Keep and Undo on hover (⌘⏎ and ⌘⌫ at the cursor) and a line above the first, "Owlit changed 3 passages · Keep all · Undo all", until you have seen it. A doc Owlit deletes or moves goes to the Trash or its new place and shows on the answer's card with Undo. The turn goes on past the edit, so a task that writes several passages finishes while you are away, and typing never has to refuse an edit to go on.
- Owlit can now reply to and resolve your comments, star, tag and mark your papers read, rename threads, and take back its own comments and highlights, each within its role and recorded with Undo: a Reviewer changes nothing of yours, an Assistant does these without asking and asks before touching your words, a Co-author goes ahead. What each role may do is decided in one place for every route in, the `owlit` command included, and Claude Code's editing tools and shell are kept out of owlit's own folders in every role.
- A doc's Versions lists every change and who made it: your edits, Owlit's and another program's. Undo, there or under an answer, puts back just the passage that change touched and keeps what you wrote since; a passage you edited after it stays, and owlit says which. In a thread Undo takes back the rows and answers one write added, on a paper one field.
- Keep mine, when a doc changed on disk while you edited it, keeps the other program's text in Versions, under yours. A change another program makes while Owlit works no longer passes for Owlit's.
- A doc shows a thin line beside the paragraphs Owlit or another program changed since you last looked, with who and when on hover.
- The dots on threads, comments, chats and digests, and the result card under an answer with its Undo, survive a restart and agree across windows.
- When your reply shows one of Owlit's comments was wrong, Owlit corrects the comment itself instead of only saying so underneath: it reads "edited", shows what it first said ("was: …"), and is new to you again; your replies stay.
- Clicking a citation in a doc opens the paper beside the doc, at the cited sentence, where Owlit's panel docks: with its page, the Digest | PDF switch, its full page and Close. Esc puts it away and the cursor back at the citation; ⇧⌘J brings Owlit back in its place; ⌘-click, or a window narrower than 1100px, opens the paper's own page as before. Reading it there counts as reading the paper.
- A chat answer says under it what it was built from, from what Owlit actually opened: "From 3 papers · 2 in full · 1 abstract only · 1 without a PDF". Resting on a count marks those papers' citations in the answer, and Owlit says "from the abstract only" in the sentence itself when that is all it read.
- Resting on a citation of a paper, in a chat, a doc, a comment or a thread's page, shows a card: the paper, the sentence the claim rests on, its page, what Owlit read, how far you read it, and "Owlit couldn't find this sentence in the paper" when it isn't there. A thread cell's popover is the same card with Rewrite under it.
- Clicking a citation in a doc opens the paper with its sentence ringed, as chat citations do, and Back returns to the doc and to the thread page scrolled where you left them.
- Owlit cites papers with the sentence it rests on in its comments, replies and Go through, as it does in chats, and a thread exported as a doc keeps each answer's sentence with its page.
- A thread answers the papers whose text is already in your library from the full text from the start. An answer from a paper's title only (it has no abstract) is greyed in the row and the table, counted in About, and written "title only" in the CSV.
- A digest's header says when it was read from the text without the figures, from fewer pages than the PDF has, or in another language than the paper's.
- Owlit writes a digest only when you ask: from the paper's Digest side, its menu or a chat. Opening or starring a paper no longer starts one, and the setting "Digests for every paper" is gone.
- A paper opens on the side you last read of it, the digest or the PDF, each where you left it; a digest you asked for opens as soon as it is ready.
- A paper turns Read by itself when you reach its end: most of its pages read in the PDF, or its digest scrolled to the end after two minutes on it. A toast offers Undo, and a status you set back stays. A paper without a PDF turns Reading too, from its digest or abstract.
- Hovering a paper's status says how far you got, such as "12 min, pp. 1–6" or "the digest, 3 min", and agents asking what you read hear the same: read in full, looked at, or not opened here.
- Only papers Owlit added and you haven't opened are named lighter in docs and chats; papers you imported look as usual.
- Owlit works only when you ask: a star only stars, threads aren't watched for new papers (Watch for new papers is gone), and reading a paper in full doesn't re-answer its rows. The "On its own" setting and what ran under it (comments on a doc you open or stop editing, the daily look over your docs, a digest and threads for a paper that landed, going through a Meetings folder) are gone too. Ask for each from where it is: a digest on the paper, Find more papers on the thread, Go through from a doc's menu. A comment Owlit makes while you type in that doc shows at once, marked new.
- A chat answer ends when Owlit's turn ends: on Claude Code, Owlit no longer hands parts of the work to helpers of its own, and a reply never goes on after it finished.
- Owlit's background work shows only where it lands: the thread's line, the paper's Digest side (now with Stop), the doc's menu for a Go through (Stop going through), and "Owlit is answering…" with Stop in the comment you replied to. The breathing marks on paper and thread rows and on a doc's Owlit chip, the ring on Chat in the rail, the hover cards listing runs, and opening a run in the Owlit panel are gone.
- Home keeps Continue, Waiting on you and Recent; Since you left and Library's Up next are gone, and what they said shows where it happened: the thread's dot, the doc's changed lines, the chat's finished mark, the paper's new digest.
- Owlit knows which browser the extension is in from the app that connects, so Dia and Arc are called by their names, and a sign-in opens there even when another browser is your default. A connection made before this learns its browser at its next request.
- Sign in and Open on a waiting line bring the browser with the extension to the front, not only a new tab in it.
- Signing in to Tsinghua's library opens tlink's sign-in page instead of a 500 error.
- Background work that fails says why in Owlit's words, such as an agent that isn't signed in, and a digest no longer takes in what Owlit's helpers wrote along the way.
- A paper a search named one way and your library files another way is the same paper in its threads: Owlit can answer its row from the full text, and your corrections to its details reach Export as a doc, the CSV and what Owlit reads of the thread.
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
