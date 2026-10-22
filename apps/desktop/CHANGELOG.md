# Changelog

Each version's section goes, as it is, into the notes sent with its dmg (scripts/release-notes.mjs).

## Unreleased

- A row's ⋯ menu opens from the keyboard: Tab from the row reaches it (in the Docs tree, the chat list, Threads and the Library, where the star is reached the same way) and Enter opens it; Shift+F10 on a row opens its right-click menu; Escape puts you back on the row.
- The app icon is a brighter green with a white feather, the same green as the browser extension's button.
- Projects: a folder is a project when it holds a project.md (its first line is the name; status:, due: and current: are optional, and when you tell Owlit which draft is current it writes the current: line). "Make this a project" is on a folder's menu in the Docs tree, a marked folder wears a small sign, and the example workspace ships one. Threads are filed under a marked folder's path, and the threads page groups by name. Owlit hears its memory per project: a chat hears the lines kept for its own project in full and one line about each other project, can read another project's lines when the conversation touches it, and keeps a new fact for the project or for every chat; Settings groups the lines by project, with Keep for… to move one, and a reply's first line says what Owlit kept in mind and opens that group. A chat in no project has an "in: —" chip above the composer to put it in one; a reading of a transcript attached to a chat lands beside the earlier readings of that meeting, or in the chat's project. Home groups the work by project (the doc last worked on, what waits on its current drafts, what changed since you looked, "Where did I stop?"), folds quiet and done projects (a project stays live while you work on it in your last few sittings, by typing, by chatting about it, or by having Owlit edit its docs), and offers "Make this a project" once on folders worked on lately. The Library narrows to a project: what its current drafts cite (naming the drafts it counted), or everything it cites, with "also cited in …" on shared papers and how far Owlit read each; a paper's page lists the sentences of your docs that cite it.
- Owlit says it read a paper in full only when it could have: a long paper asked for whole now comes from its start as far as one tool result holds, says which pages are left, and counts as those pages until Owlit reads the rest; a paper read to its end in runs counts as the full text.
- A digest's Details are written as paragraphs again, each opening with what that part of the paper claims, with lists kept for short items; every paragraph says in words whether a statement is the paper's own measurement, something it cites, something its authors argue, or Owlit's inference; and the note uses its length rather than stopping at half of it. Digests written before this are marked as written another way, and the paper page offers to rewrite them.
- Owlit's marks in a doc no longer leave gaps in the text: a passage's Undo floats at its end, one at a time, while the pointer is near it (or Tab reaches it). The line above the marks says they clear when you leave the doc, and Clear marks clears them now, keeping the edits; the chat's Undo and Versions still take them back.
- Commands in the composer: type "/" at the start of a message for /review (Owlit reads a doc as a reader and leaves comments where it doesn't hold; the chat becomes Reviewer), /revise (Owlit revises a doc by its comments with you, a paragraph at a time, editing and resolving each with what was done or who turned it down), and /go-through (a meeting or reviews against your docs). A later review starts from the earlier comments: a point that still stands is answered under its old comment, which opens again, and a point you turned down isn't raised again. The suggestion chips under an empty chat are gone; a line there names the commands.
- A citation's card shows its sentence in its place: the section and page, the sentence before and after in grey, the works the sentence cites itself, and a click opens the PDF at it. Under the paper's name it says how much of the paper you read; under the passage, how far Owlit had read the paper when it wrote the citation (a page it read, the abstract, the whole paper, or nothing), from what owlit saw it read, not from Owlit's word. A citation you wrote has no Owlit line, and nothing on the card says "checked". Under a doc's title, one line says how many of its citations weren't read in the paper ("8 of 26 citations not read in the paper · 6 from the abstract · 2 not read"), and clicking a part marks those citations and brings the first into view; the same line shows when you copy a doc's references or share it.
- Owlit writes a finding, figure or quote only from text it read in that conversation, one sentence per fact, checks whether the sentence is the paper's own finding or its report of someone else's, cites a paper it didn't read as a whole, and no longer writes "abstract only" into your docs. Asked to tie or check a doc's citations, it reports in its reply, not in comments on the doc.
- Every paper gets its first look for a PDF when it comes in, the papers a thread names too; they used to wait until opened. Papers nobody ever looked for get that look when the workspace opens.
- owlit stops looking for a PDF on its own after its last spaced-out look (a day, 3, 7 and 30 days after the first); the paper then says "No PDF found", what was tried, and that owlit won't look again. A site waiting for your sign-in or a check is tried once more on owlit's own, then waits for you, instead of every quarter of an hour; after a restart its line is up at once.
- The No PDF list has "Get them all with my access": every paper there with a DOI goes to the browser extension in one go, and a line at the top of the Library says how many PDFs came.
- A thread's report says in one line which of its read-first papers you can't open and why: Owlit gets their PDFs before it writes, with a tool that waits for owlit's look and says where each stands. The PDF status under Owlit's answers comes from that moment, never from memory.
- Doors into asking Owlit, each opening a chat with the question begun and nothing sent: Threads has a "Find papers on a question…" button, in its header and when it is empty; a doc's menu (and a PDF's or transcript's among the docs) has "Go through this with Owlit", which opens the panel beside the doc with the file named in the question; and in the Library, Enter on words that match papers offers "Ask Owlit to find papers about this" too, not only when nothing matches.
- Ask Owlit on a passage goes on in the latest chat about that doc or paper instead of starting a new one, unless the panel is on a chat about it already or you pressed New chat.
- Opening the Owlit panel beside a paper, doc or thread opens the latest chat about it, or a new one, never the chat you last had elsewhere.
- How far Owlit read a paper is said in the same words everywhere, on one scale: full text, part of the text, abstract only, title only. The card under an answer says it per paper ("From 6 papers · 2 full text, 4 abstract only"); a thread's rows and the line over them ("3 full text, 5 abstract only") say the same, and a row answered after reading some pages says "Part of the text", not "Full text", whatever Owlit called it. Owlit's rules ask it to use the same words when it talks about it in a chat.
- A star, status or tag Owlit sets shows in the Library at once, without a reload.
- A doc written from an owlit chat is never "Made by outside owlit" in Versions: a write during a Co-author's turn that no tool call named is Owlit's, by that chat.
- The Co-author role's lines on the Owlit engine no longer say it runs commands; the engine has no command tool.
- The Threads list shows Owlit's one line as plain words, without Markdown marks; a thread whose project folder isn't in the workspace says "no folder named …" instead of "was in …".
- A thread row's "how found" line can't say a paper is cited by an older one: "cited by X 2022" on a 2026 paper becomes "cites X 2022", and papers from a paper's citations are recorded as citing it.
- "Find papers on a question" starts the question with "Find papers on", not "Find recent papers on".
- In the card under an answer, clicking anywhere on a doc's row opens the doc, not only its arrow.
- In the Chinese interface, a chat's grouped step lines ("搜索了 8 次论文", "追踪了 2 次论文的引用") and the step that reads owlit's guide are in Chinese, as the single steps already were; a digest's two section headings show in the interface's language; Owlit's edits "直接生效" instead of "落下"; a highlight's comment is 评论 like every other comment; the empty digest pane, the first-run line and the tour say 导读, not 摘要; and the date on the "owlit looks again" line has no spaces around it.
- A thread's About no longer prints the question twice when the chat it came from is named after that question: the link reads "a chat".
- Every paper has a cite key, the one its BibTeX entry carries (lee2025sensible: first author, year, first word of the title), given once when the paper joins the library and kept, shown in the paper's panel (click to copy). Owlit knows it too, so a LaTeX paragraph asked for in a chat cites with the same keys Copy references writes. BibTeX and APA references now carry the volume, issue, pages and publisher, which owlit looks up for the papers already in the library.
- The example workspace has a third thread, Test data behind the papers, whose grouping shows as a column with groups inside groups; the chat that made it, where Owlit asked which papers to take and asked before writing; and a comment of Owlit's on Related work, with a reply.
- The card under an answer says in one line what it was built from: "From 6 papers · 3 abstract only", or "all read". Click it for the papers, each with how Owlit read it. In a narrow Owlit panel the rest of the card is shorter too: the line saying what the reply changed is a count ("4 changes"), and a thread, paper or doc no longer shrinks to one character beside its detail. A table's columns of sentences keep a readable width and the table scrolls sideways.
- A citation's card names the abstract it shows as the abstract, instead of saying Owlit took the claim from it.
- The toast for a comment Owlit leaves while you're away from its chat says "Comment added", and Owlit's answers about how to use owlit name the roles, signing in to Claude Code and Codex from Settings, and every part of Settings.
- The list beside the rail (chats, docs) can be opened while the Owlit panel is docked, also when you had hidden it before opening the panel.
- The list beside the rail (chats, docs) can be made wider or narrower by dragging its right edge, and keeps its width after a restart. Double-click the edge to go back to the usual width.
- Threads has a new icon in the rail, on Home and in mentions: a route, a line through two points, in place of the stack of layers.
- The Owlit button in a doc's header is gone. The dot it carried, for comments Owlit left since you last looked, sits on the comments button instead, and a click there opens the first of them.
- A link in a doc to another doc by its file's path (`[the draft](notes/Draft.md)`, or the full path, as an agent writes it) is drawn like an @-mention and opens that doc, in the text and in a table.
- The browser extension's button acts at once: on a paper's page it adds the paper (or saves the PDF the page names for a paper you have without one), and a small card in the page's corner says how it went, with Open to see it in owlit. The button opens its panel only to connect, when owlit has no workspace open, or on pages where no card can be drawn. Its one setting is on the button's right-click menu.
- The extension's icon is owlit's green tile with the feather, the same everywhere: on every toolbar, light or dark, on the browser's extensions page and in the store.
- The extension's icon on the browser's extensions page is sharp on a 2x display.
- When a paper's page sends the owlit extension on to a site it may not read (your library's link to an APA paper lands on doi.apa.org), Owlit now asks you to let the extension read that site, instead of asking you to sign in to your library again and again. APA's PsycNet is one of the sites the extension knows.
- On a site where papers wait for your sign-in or a check, the extension's card says how many wait there, and that owlit goes on once you're through; its panel counts them as they come ("Going on · 1 of 3").
- The extension's Open with every owlit window closed opens the paper once the window is up, instead of saying owlit isn't open. Its card after a click no longer gives way to a "waits for your sign-in" card, a card fading out no longer blocks clicks on the page beneath, and its panel has Allow for a paper added without its PDF. A news or blog piece that links a study's DOI isn't taken for the paper.
- A workspace from owlit 0.2.0 reads right without being converted: what you read then counts as read, highlights you made stay yours, and Owlit can take back papers it added then.
- Owlit's reply under a comment no longer drops a reply you add while it writes. Owlit can't make your doc its own by moving it, or by deleting it and writing one in its place, and a memory line you rewrote stays yours.
- `owlit mcp` tells an agent outside owlit what it may do: read the workspace, and add and change things of its own.
- With "Take PDFs I open" on, opening the page of a paper you have without its PDF brings the PDF in, as opening the PDF itself did. The extension also reads papers from IEEE Xplore and from pages that describe them only in JSON-LD, and says plainly that Google Scholar's results list papers.

- A paper you add by its arXiv id, or that a chat or the extension finds under another id, teaches the paper already in your Library that id, and looks for its PDF there: a free arXiv copy is no longer missed. A preprint and its published version, added at different times under different titles, become one paper. A copy kept apart because you worked with it says which paper it looks like.
- Adding a paper says the same thing from the find field, a chat's step, an attachment or a dropped PDF: "Added to library" with Undo, or "Already in your library" with Open. A PDF dropped on a paper that had none says "PDF attached". An import's done card has Undo for the whole import.
- Missing PDFs are looked for again while owlit stays open, every hour for a look that couldn't reach the network, not only at launch. Unpaywall's open copies are looked for even without a contact email in Settings.
- An import from Zotero or BibTeX gives its PDF to a paper your Library already had without one, and says how many did.
- Clicking a waiting line's Open it or Sign in now answers: "Opened in Chrome. Pass the check there; owlit goes on by itself.", then "Getting 14 PDFs from dl.acm.org · 3 so far", then "12 PDFs came from dl.acm.org · 2 without · Show" until you put it away.
- A paper owlit couldn't find a PDF of says "No PDF found" in the list, the table and its page. Its card offers Open the page and Choose file first, says "Download it there, then drop it here" after you open the page, and asks to use your library's access (Set up opens the library proxy and the extension in Settings). Look again that finds nothing says when owlit looks next; Refresh details says what changed.
- Venues read the way people say them (IMWUT, NeurIPS, CHI, KDD…), and a preprint without one shows arXiv. The Added column shows only the date.
- The monthly citation recount changes a paper's file only when its count changed, so a synced workspace no longer shows every paper as changed once a month. Preprints are looked up again then, to learn their published version.
- Importing a folder of PDFs that is inside your workspace moves them into the Library instead of copying them; a Docs folder of nothing but PDFs offers Import as papers….
- A thread's papers fetch their PDFs only when you open one or Owlit reads it. The Library can show one thread's papers (In thread), and a paper's page lists the threads it is in.
- Owlit can look at a paper's figures and pages as pictures when you ask what a figure shows. A Chinese paper's title is recognised on its PDF.
- A doc with Owlit's notes from before comments opens again instead of showing an error page; they read as Owlit's comments.
- Home lists your threads beside docs, chats and papers, and every Recent row says what came since you looked: "3 new papers", "Ruth edited", "2 comments", "Owlit finished", "Digest ready". A doc shows on Home once you have written in it, not because a sync touched it, and someone else's change says who made it.
- Waiting on you has no Dismiss: a reply that broke waits there for three days, then stays only as the chat's red mark.
- "Find papers on a question" on an empty Home starts a chat for it; chats from Help › Ask Owlit how to… stay off Home.
- The first launch is shorter and shows Owlit as it works now: the digest comes when you ask for it, Owlit's edit lands marked with Undo, the language is asked in About you, and the proxy and Look steps are gone (both are in Settings). Enter on Change… in the last step no longer creates the folder.
- A browser sign-in shows "Open the page again" and Cancel while it waits, and leaving the step and coming back still shows it.
- File › New Workspace…, and the workspace's name in the top bar opens your recent workspaces.
- Help › Take the tour asks before leaving your workspace for the example, and the tour now stops at Threads and Chat. With reduced motion it moves without gliding.
- An unsigned Owlit tells you when a newer version is out, with Download and What's new, in Settings › Updates and in Check for Updates….
- Settings: the extension's Install… opens the release page; a key macOS didn't let Owlit read says so instead of looking unset; the Warm and Neutral paper tones are one; Dim PDF pages is kept with the rest of Appearance.
- A renamed or moved workspace folder keeps its shared links (and can stop them) and its unfinished tasks. When the share server can't be reached, Stop sharing offers to forget the link here; a link on a server owlit no longer uses can be replaced with a new one. The Share dialog says the link lasts until you stop it and carries your name.
- A doc Owlit wrote opens clean, with one line above it: "Owlit wrote this doc · from <chat> · Undo". Underlines are for Owlit's edits to words that were already there, and ⌘⌫ undoes a passage only with the cursor at its end.
- One Undo per Owlit edit: Undo on a passage, Undo all, the chat's card and Versions all take back the same change, and the card says when you undid part of it in the doc. Keep and Keep all are gone; the marks leave once you've seen the doc. An edit to the doc you have open no longer raises an "Edit applied" toast.
- "Digest ready" is said even when the digest lands a moment after Owlit's turn ends. A reply that ended, or an agent slow to start, no longer shows "nothing for a while". An answer whose last paragraph starts "API Error:" keeps it, unless it is Claude Code's own error line. A usage limit that resets in a few hours says so plainly.
- ⌘⌫ undoes a landed paragraph with the cursor at the end of its words, where its Undo sits, and two of Owlit's passages in one place no longer show two marks and two Undos. An Owlit edit the open doc already showed raises no toast.
- A thread table grouped by a comparison keeps papers whose sentence is gone, in its list and in the Markdown export.
- Going to a passage of a paper from a link, the tour or a chat turns it to the PDF for that visit only; it reopens on the side you last chose.
- Who made a change shows by name as soon as the workspace's members are read. A citation whose quote ran over lines keeps its link.
- A doc counts as seen once each of Owlit's passages and each changed paragraph has been on screen a moment, not after three seconds anywhere in it. A paragraph someone else removed leaves a small mark in the margin where it was.
- Comments stay on their words when Owlit edits around them, and a comment on a few words ("2. ") no longer jumps to another copy of them.
- Versions shows what each change did: words added and removed, and its passages when you open it.
- Esc then Tab in a doc reaches its citations (the card shows; Enter opens the paper) and the Undo of Owlit's passages.
- @ in a doc takes several words ("@vaswani attention") and offers papers a thread found that aren't in your Library yet.
- A shared doc waits until you've seen Owlit's edits before readers get them; the doc's header says "Waiting for you".
- Keep Owlit out and Dismiss on Owlit's comments are gone: tell Owlit in the chat, undo its edit or resolve its comment. A comment dismissed before now shows among Resolved comments.
- Go through is asked for in a chat ("go through this meeting against my docs"); the doc's menu no longer has it.
- Copy references in a doc's menu copies the papers the doc cites, in the order you first cite them, as APA text or as BibTeX. Papers a thread found that aren't in your Library come along too.
- A thread is Owlit's report on a question you asked, with the papers it rests on. Ask in any chat ("find me what's known about…", "give me three papers on…") and Owlit decides from what you need whether to take a quick look or survey the field, and may ask you a question or two first; a survey says what it searched, what it counted in and what it left out. The report opens the thread, as long as it needs, naming its papers; each paper's row says what the paper is and how it bears on your question, with the passage and how far Owlit read it.
- You change a thread by asking in a chat ("regroup these by method", "add the 2024 papers", "rewrite the report for my intro"), and each change is one Undo on the chat's card. The thread's page has no buttons any more: Gather, Find more papers, Ask each paper, Compare, Read N in full, Rewrite, Remove, Groups… and the Threads page's field are gone, and so is Move to project in a thread's menu. A thread is a list until you ask for a column, then a table; Group by stays.
- A thread's papers are papers in your Library, added as Owlit's without fetching their PDFs. Threads from before keep their memo as the report until Owlit writes a new one.
- A paper opened in a thread shows the card the Library shows (authors, venue, citations, whether its PDF is there, the abstract), then what the thread says of it with the passage. In a thread's table any cell opens it, also from the keyboard, and a What it is column says what each paper is. Export as a doc follows the table's Group by, and the CSV opens in Excel with accents and Chinese intact.
- Owlit's edits to a paper's note show above the note until you have seen them: the old words struck, the new ones underlined, each with Undo.
- On a window 1400px wide or more, clicking a citation in a doc while the chat is docked opens the paper between the doc and the chat, instead of closing the chat.
- A paper's About says which of your docs cite it.
- Highlights, Add to note, Ask Owlit and a paper's text read Chinese without stray spaces where the PDF's lines broke, and a quote in Chinese is found and ringed across a line break.
- Copy BibTeX gives every paper its own key: two papers that would share one get a, b after it, and a paper whose first author is written in Chinese is keyed by its DOI instead of "anon". Braces, backslashes, ~ and ^ in a title are escaped.
- With reduced motion on, the PDF reader jumps to a passage, highlight or page instead of scrolling there smoothly.
- A digest you ask for starts at once, beside whatever else Owlit is doing, instead of waiting its turn behind a thread's work. The paper's page says "Owlit is reading this paper…" with Stop.
- Asking for a digest of a paper whose text owlit hasn't read yet answers at once: the paper's page says "Owlit is getting the text…", then "Owlit is reading this paper…" once Owlit starts. If the text can't be read, the page says so with Retry.
- Retry runs on the agent and model Settings › Owlit picks now. A digest's Retry after you changed its language writes it afresh in the new one.
- Settings › Owlit's Background work is now Tasks you hand Owlit: the agent and model for digests, thread work and Owlit's answers under its comments.
- A digest that couldn't be written says why on the paper's page ("Claude Code's usage limit is reached; it resets at 2:20", "Owlit was closed before it finished"), with Retry, and still says so after you restart owlit. Retry carries on where it stopped.
- Owlit answers your reply under one of its comments at once, instead of waiting behind a thread's work, and remembers what you said in earlier replies under the same comment. While it answers the card says so with Stop; if it couldn't, the card says why with Retry, still there after you restart owlit.
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
- Resting on a citation of a paper, in a chat, a doc, a comment or a thread's page, shows a card: the paper, the sentence the claim rests on, its page, what Owlit read, how far you read it, and "Owlit couldn't find this sentence in the paper" when it isn't there.
- Clicking a citation in a doc opens the paper with its sentence ringed, as chat citations do, and Back returns to the doc and to the thread page scrolled where you left them.
- Owlit cites papers with the sentence it rests on in its comments, replies and Go through, as it does in chats, and a thread exported as a doc keeps each answer's sentence with its page.
- A thread answers the papers whose text is already in your library from the full text from the start. An answer from a paper's title only (it has no abstract) is greyed in the row and the table, counted in About, and written "title only" in the CSV.
- A digest's header says when it was read from the text without the figures, from fewer pages than the PDF has, or in another language than the paper's.
- Owlit writes a digest only when you ask: from the paper's Digest side, its menu or a chat. Opening or starring a paper no longer starts one, and the setting "Digests for every paper" is gone.
- A paper opens on the side you last read of it, the digest or the PDF, each where you left it; a digest you asked for opens as soon as it is ready.
- A paper turns Read by itself when you reach its end: most of its pages read in the PDF, or its digest scrolled to the end after two minutes on it. A toast offers Undo, and a status you set back stays. A paper without a PDF turns Reading too, from its digest or abstract.
- Hovering a paper's status says how far you got, such as "12 min, pp. 1–6" or "the digest, 3 min", and agents asking what you read hear the same: read in full, looked at, or not opened here.
- Only papers Owlit added and you haven't opened are named lighter in docs and chats; papers you imported look as usual.
- Owlit works only when you ask: a star only stars, threads aren't watched for new papers (Watch for new papers is gone), and reading a paper in full doesn't re-answer its rows. The "On its own" setting and what ran under it (comments on a doc you open or stop editing, the daily look over your docs, a digest and threads for a paper that landed, going through a Meetings folder) are gone too. Ask for each from where it is: a digest on the paper, more papers for a thread in a chat, Go through in a chat. A comment Owlit makes while you type in that doc shows at once, marked new.
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
- A link to a paper in a big thread opens its row even when its group is folded or shows only its first papers.
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
- Move to project is back in a thread's menu, with Undo.
- Owlit's answer to your reply under its comment shows in the comment as soon as it is written, without reloading the window.
- "No word from Claude Code for 2 min" comes only after two minutes in which the agent said nothing once its session was ready, not while it is still starting.
- When Claude Code ends an answer with its own error ("API Error: Your computer went to sleep mid-response…"), the reply says Owlit stopped, with the error under Details, instead of showing it as Owlit's words.
- Home names a thread by its title, with Owlit's one line under it, instead of the whole question you typed.

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
