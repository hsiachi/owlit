---
id: checking-whether-rag-answers-are-support
---
# Checking whether RAG answers are supported

You are comparing ways to tell whether an answer's claims are supported: Self-RAG's learned critique tokens, SelfCheckGPT's sampling consistency, and trained or white-box detectors. Your open point is whether these approaches flag the same claims, and nothing in your library answers it yet.

## Understanding

- Asai et al. 2023: Self-RAG's reflection tokens split into retrieval tokens, signalling when to retrieve, and critique tokens, judging generation quality. ^s1
  - [p.1](owlit://library/arxiv-2310.11511#passage=reflection-tokens) — The model emits these itself while generating.
- Asai et al. 2023: A trained critic inserts reflection tokens into the training corpus offline, so no critic model is hosted during training. ^s2
  - [p.2](owlit://library/arxiv-2310.11511#passage=offline-critic) — The critic is partly supervised on GPT-4 labels.
- You: The critique tokens act like a built-in groundedness check, but since they are learned from GPT-4 labels through a critic, they are only as good as that critic. ^s3
  - [Note on Self-RAG](owlit://library/arxiv-2310.11511) — From my note on Self-RAG.
- Manakul et al. 2023: If an LLM knows a concept, sampled responses stay consistent; for hallucinated facts, samples diverge and contradict one another. ^s4
  - [p.1](owlit://library/arxiv-2303.08896#passage=sampling-idea) — Tested on GPT-3 biographies with no retrieved context.
- Manakul et al. 2023: Token probability or entropy metrics need token-level distributions, which users of limited external APIs may not have. ^s5
  - [p.1](owlit://library/arxiv-2303.08896#passage=uncertainty-access) — The reason SelfCheckGPT works from sampled text alone.
- Owlit thinks: Among your detection papers, SelfCheckGPT needs only text, LettuceDetect needs labelled training data, and ReDeEP needs labels plus white-box access to the generator. ^s6
  - [Chat](owlit://chat/2cd85522-7934-47c5-a56b-6aa328f604ae) — Owlit's comparison table; only LettuceDetect and ReDeEP check against retrieved context.
- You: I have not found a comparison of critique tokens, sampling-consistency checks and internal-signal detectors on the same RAG outputs. ^s7
  - [Related work](owlit://docs/Hallucination%20in%20RAG/Related%20work.md) — From the last paragraph of my related-work draft.

## Questions

- You: Does ISSUP catch the same unsupported claims a separate detector (SelfCheckGPT, LettuceDetect) would, or does the model learn to grade itself too kindly? ^q1
  - [Note on Self-RAG](owlit://library/arxiv-2310.11511) — From your note on Self-RAG. Nothing answers it yet.
- You: Is ISSUP close enough to an NLI check to compare with SelfCheckGPT? ^q2
  - [p.1](owlit://library/arxiv-2310.11511#p1) — From your comment on a Self-RAG highlight. Nothing answers it yet.
- You: Do a learned critique token, a sampling-consistency check and an internal-signal detector flag the same claims? ^q3
  - [Related work](owlit://docs/Hallucination%20in%20RAG/Related%20work.md) — From your related-work draft. Nothing answers it yet.

## Sources

- 2026-10-13 · [Asai et al. 2023](owlit://library/arxiv-2310.11511) · you highlighted pp.1–2 and edited your note
- 2026-10-13 · [Manakul et al. 2023](owlit://library/arxiv-2303.08896) · you highlighted p.1
- 2026-10-13 · [Related work](owlit://docs/Hallucination%20in%20RAG/Related%20work.md) · you wrote in your draft
- 2026-10-13 · [Chat](owlit://chat/2cd85522-7934-47c5-a56b-6aa328f604ae) · you asked for a comparison of the detection papers
