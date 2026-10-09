// What core's search index finds (search.*). Keys: a paper id, a doc's workspace path, a chat id.

export interface SearchHit {
  key: string
  title: string
  // A few words around the match, from wherever it was (the text, the abstract, the authors)
  snippet: string
  // Every word is in the title: these come first
  inTitle?: boolean
}

export interface PaletteResults {
  papers: SearchHit[]
  docs: SearchHit[]
  chats: SearchHit[]
}

export interface SearchStatus {
  // indexing: the first full read of the workspace is under way and results are partial
  state: "ready" | "indexing"
  papers: number
  docs: number
  chats: number
}

// Something that links to a paper or doc: a doc, a chat, or a paper's note
export interface LinkSource {
  source: "paper" | "doc" | "chat"
  key: string
  title: string
}
