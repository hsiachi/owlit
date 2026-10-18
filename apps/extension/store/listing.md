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

- **Add to owlit.** On a paper's page at a publisher or on arXiv, press the owlit button: the paper joins
  your Library, and its PDF comes with it when the page links one.
- **Save PDF to owlit.** For a paper already in your Library without its PDF, the button fetches the PDF
  with your browser's access (your library's sign-in, your subscriptions) and hands it to owlit.
- **PDFs you open.** When you open the PDF of a paper your Library is missing, owlit takes it by itself
  and says so. A switch in the popup turns this off.

The extension talks only to owlit on your own computer (127.0.0.1). It sends owlit the page's paper
details and the PDFs above, nothing else, and it connects only after you allow it in owlit's window.

You need the owlit desktop app: https://owlit.ink

## Permissions, and what each is for

- **Read and change your data on the publishers' sites listed**: to read a paper page's details (title,
  DOI, the PDF's address) and to fetch the PDF with your cookies, so your library's access applies.
- **Other sites, one at a time**: asked only when you press the button on a site owlit doesn't list, for
  that site alone.
- **127.0.0.1**: owlit on your computer, which the extension talks to.
- **storage**: the key owlit gave this browser when you allowed it, and the popup's switch.
- **activeTab** and **scripting**: to read the paper's details on the page you're on when you open the
  popup there.
- **webRequest**: to tell when a tab has opened a PDF, so a PDF of a Library paper without one can be
  taken.
- **notifications**: to say that owlit took a PDF, since the browser's PDF viewer can't show it.
- **alarms**: to look for owlit again every 30 seconds while it isn't running.

# Firefox Add-ons (addons.mozilla.org)

## Name

owlit

## Summary (250 characters at most)

Add the paper of the page you're on to owlit, with its PDF, using your browser's access to journals. For
the owlit desktop app.

## Description

owlit is a desktop app where you read, write and think through papers with Owlit, its assistant. This
add-on connects Firefox to owlit on your computer.

- **Add to owlit.** On a paper's page at a publisher or on arXiv, press the owlit button: the paper joins
  your Library, and its PDF comes with it when the page links one.
- **Save PDF to owlit.** For a paper already in your Library without its PDF, the button fetches the PDF
  with your browser's access (your library's sign-in, your subscriptions) and hands it to owlit.
- **In the background.** While owlit is open, it can ask the add-on for the PDFs of papers it couldn't get
  alone; the add-on fetches them from the publishers' sites with your access, one site at a time.
- **PDFs you open.** When you open the PDF of a paper your Library is missing, owlit takes it by itself
  and says so. A switch in the popup turns this off.

The add-on talks only to owlit on your own computer (127.0.0.1). It sends owlit the page's paper details
and the PDFs above, nothing else, and it connects only after you allow it in owlit's window.

You need the owlit desktop app: https://owlit.ink

## Permissions, and what each is for

Firefox lets you choose which sites an add-on may read. If you turn the publishers' sites off, the popup
says so and asks for them again in one click; owlit's papers at a site the add-on may not read wait until
you allow it.

- **Access your data for the publishers' sites listed**: to read a paper page's details (title, DOI, the
  PDF's address) and to fetch the PDF with your cookies, so your library's access applies.
- **Access your data for other sites, one at a time**: asked only when you press the button on a site
  owlit doesn't list, or when owlit has papers waiting at one, for that site alone.
- **127.0.0.1**: owlit on your computer, which the add-on talks to.
- **Store data** (storage): the key owlit gave this browser when you allowed it, and the popup's switch.
- **activeTab** and **scripting**: to read the paper's details on the page you're on when you open the
  popup there.
- **webRequest**: to tell when a tab has opened a PDF, so a PDF of a Library paper without one can be
  taken.
- **Display notifications**: to say that owlit took a PDF, since Firefox's PDF viewer can't show it.
- **alarms**: to look for owlit again every 30 seconds while it isn't running.

## Data collection (as the manifest declares it)

- **Browsing activity**: the address of a paper's page, sent to owlit on your computer when you press the
  button or when the page is a publisher's.
- **Website content**: the page's paper details and the PDFs above, sent to owlit on your computer.

Nothing goes to owlit's developers or anyone else.

## Notes for the reviewer

The add-on is built from the public repository (AGPL-3.0): https://github.com/hsiachi/owlit, folder
`apps/extension`. With Node 24 and pnpm 10, at the repository's root: `pnpm install`, then
`pnpm --filter @owlit/extension build`; the add-on is `apps/extension/dist/firefox/`. The popup is React,
bundled by Vite; the two innerHTML warnings from the linter are in React DOM itself. To try it, the owlit
desktop app must be running (https://owlit.ink); its first Connect asks you to allow the add-on in owlit's
window.
