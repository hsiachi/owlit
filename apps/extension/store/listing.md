# owlit for the Chrome Web Store

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
