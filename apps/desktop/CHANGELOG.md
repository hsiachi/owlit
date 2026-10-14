# Changelog

Each version's section goes, as it is, into the notes sent with its dmg (scripts/release-notes.mjs).

## 0.1.1

- Share a doc by link: readers open it in their browser with the papers it cites, and can leave comments.
- Citation counts for papers in the Library, from OpenAlex, kept up to date.
- Imports say what they need: a question shows on the Library's line and its rail icon; a stopped import says why, with Details.
- A BibTeX file with the same key twice now imports both papers.
- A ready Claude Code or Codex shows its version where you pick the agent.
- Share links survive macOS asking for the keychain again after an update.
- Owlit is open source (AGPL-3.0): https://github.com/hsiachi/owlit

## 0.1.0

The first version for friends.

- Library, papers with digests, docs, chats with Claude Code or Codex, and Knowledge.
- Import a Zotero library, a BibTeX file or a folder of PDFs (File › Import Papers…).
- Owlit sets up Claude Code or Codex for itself; no Node or npm needed.
- The `owlit` command for Terminal (Owlit › Install Command Line Tool…).
