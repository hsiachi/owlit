# owlit for the Chrome Web Store and Firefox Add-ons

The Chrome Web Store takes `release/owlit-extension-<version>-chrome.zip`; addons.mozilla.org (AMO) takes
`release/owlit-extension-<version>-firefox.zip`. Both come from `pnpm --filter @owlit/extension build`.

# Chrome Web Store

## Name

owlit

## Short description (132 characters at most)

Add the paper of the page you're on to owlit, with its PDF, using your browser's access to journals.

## Description

owlit is a desktop app where you read, write and think through papers with Owlit, its assistant. This
extension connects your browser to owlit on your computer.

- **Add to owlit.** On a paper's page at a publisher, on arXiv or on IEEE Xplore, press the owlit button:
  the paper joins your Library at once, and its PDF comes with it when the page links one. A small card in
  the page's corner says how it went, with Open to see the paper in owlit.
- **Save PDF to owlit.** For a paper already in your Library without its PDF, the same press fetches the
  PDF with your browser's access (your library's sign-in, your subscriptions) and hands it to owlit.
- **PDFs you open.** When you open the PDF, or the page, of a paper your Library has without its PDF, owlit
  takes it by itself and the card says so. Right-click the button to turn this off.
- **Only asks when it must.** The button opens a small panel only to connect to owlit, when owlit has no
  workspace open, or on pages where the card can't be drawn (the browser's own pages).

The extension talks only to owlit on your own computer (127.0.0.1). It sends owlit the page's paper
details and the PDFs above, nothing else, and it connects only after you allow it in owlit's window.

You need the owlit desktop app: https://github.com/hsiachi/owlit/releases/latest

## Permissions, and what each is for

- **Read and change your data on the publishers' sites listed**: to read a paper page's details (title,
  DOI, the PDF's address) and to fetch the PDF with your cookies, so your library's access applies.
- **Other sites, one at a time**: asked only when you press the button on a site owlit doesn't list, for
  that site alone.
- **127.0.0.1**: owlit on your computer, which the extension talks to.
- **storage**: the key owlit gave this browser when you allowed it, and the one setting.
- **activeTab** and **scripting**: to read the paper's details on the page you're on when you press the
  button there, and to draw the card that says how it went.
- **webRequest**: to tell when a tab has opened a PDF, so a PDF of a Library paper without one can be
  taken.
- **notifications**: to say that owlit took a PDF where no card can be drawn in the browser's PDF viewer.
- **alarms**: to look for owlit again every 30 seconds while it isn't running.
- **contextMenus**: the button's right-click menu, which holds the one setting.

# Firefox Add-ons (addons.mozilla.org)

## Name

owlit

## Summary (250 characters at most)

Add the paper of the page you're on to owlit, with its PDF, using your browser's access to journals. For
the owlit desktop app.

## Description

owlit is a desktop app where you read, write and think through papers with Owlit, its assistant. This
add-on connects Firefox to owlit on your computer.

- **Add to owlit.** On a paper's page at a publisher, on arXiv or on IEEE Xplore, press the owlit button:
  the paper joins your Library at once, and its PDF comes with it when the page links one. A small card in
  the page's corner says how it went, with Open to see the paper in owlit.
- **Save PDF to owlit.** For a paper already in your Library without its PDF, the same press fetches the
  PDF with your browser's access (your library's sign-in, your subscriptions) and hands it to owlit.
- **In the background.** While owlit is open, it can ask the add-on for the PDFs of papers it couldn't get
  alone; the add-on fetches them from the publishers' sites with your access, one site at a time. On a
  site that waits for your sign-in, the card says how many papers wait there.
- **PDFs you open.** When you open the PDF, or the page, of a paper your Library has without its PDF, owlit
  takes it by itself and the card says so. Right-click the button to turn this off.
- **Only asks when it must.** The button opens a small panel only to connect to owlit, when owlit has no
  workspace open, or on pages where the card can't be drawn (Firefox's own pages and its PDF viewer).

The add-on talks only to owlit on your own computer (127.0.0.1). It sends owlit the page's paper details
and the PDFs above, nothing else, and it connects only after you allow it in owlit's window.

You need the owlit desktop app: https://github.com/hsiachi/owlit/releases/latest

## Permissions, and what each is for

Firefox lets you choose which sites an add-on may read. If you turn the publishers' sites off, the add-on's
panel says so and asks for them again in one click; owlit's papers at a site the add-on may not read wait until
you allow it.

- **Access your data for the publishers' sites listed**: to read a paper page's details (title, DOI, the
  PDF's address) and to fetch the PDF with your cookies, so your library's access applies.
- **Access your data for other sites, one at a time**: asked only when you press the button on a site
  owlit doesn't list, or when owlit has papers waiting at one, for that site alone.
- **127.0.0.1**: owlit on your computer, which the add-on talks to.
- **Store data** (storage): the key owlit gave this browser when you allowed it, and the one setting.
- **activeTab** and **scripting**: to read the paper's details on the page you're on when you press the
  button there, and to draw the card that says how it went.
- **webRequest**: to tell when a tab has opened a PDF, so a PDF of a Library paper without one can be
  taken.
- **Display notifications**: to say that owlit took a PDF, since no add-on can draw in Firefox's PDF viewer.
- **alarms**: to look for owlit again every 30 seconds while it isn't running.
- **Menus** (contextMenus): the button's right-click menu, which holds the one setting.

## Data collection (as the manifest declares it)

- **Browsing activity**: the address of a paper's page, sent to owlit on your computer when you press the
  button or when the page is a publisher's.
- **Website content**: the page's paper details (from its head, and the scripts that describe the paper)
  and the PDFs above, sent to owlit on your computer.

Nothing goes to owlit's developers or anyone else.

## Notes for the reviewer

The add-on is built from the public repository (AGPL-3.0): https://github.com/hsiachi/owlit, folder
`apps/extension`. With Node 24 and pnpm 10, at the repository's root: `pnpm install`, then
`pnpm --filter @owlit/extension build`; the add-on is `apps/extension/dist/firefox/`. The panel is React,
bundled by Vite; the two innerHTML warnings from the linter are in React DOM itself. The card in the page
(`content.js`) is plain DOM in a shadow root and sets no markup. To try it, the owlit
desktop app must be running (https://github.com/hsiachi/owlit/releases/latest); its first Connect asks you to allow the add-on in owlit's
window.
