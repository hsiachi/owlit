---
id: retrieved-context-versus-the-model-s-own
---
# Retrieved context versus the model's own knowledge

You are looking at how a RAG model arbitrates between a retrieved document and its own parametric knowledge, through ClashEval's correction method and ReDeEP's account of hallucinations. So far you have one fix for following wrong documents and one mechanism for overriding correct ones.

## Understanding

- Wu et al. 2024: Token probability correction compares the mean token probability of the answer with and without context, and keeps the answer without context when its probability is higher. ^s1
  - [p.8](owlit://library/arxiv-2404.10198#passage=token-prob-correction) — Only for models that expose token probabilities.
- Wu et al. 2024: The calibrated version compares percentiles instead of raw probabilities, raising accuracy by 14% and cutting context bias by 20%, while prior bias rises from 2% to 8.5%. ^s2
  - [p.8](owlit://library/arxiv-2404.10198#passage=calibrated-correction) — On GPT-4o, GPT-3.5 and Llama-3, with documents deliberately enriched in errors.
- Sun et al. 2024: Even with accurate, relevant retrieved content, RAG models can hallucinate outputs that conflict with the retrieved information. ^s3
  - [p.1](owlit://library/arxiv-2410.11414#passage=conflict-hallucination) — When the retrieved document is correct but conflicts with parametric knowledge.
- Sun et al. 2024: These hallucinations occur when Knowledge FFNs overemphasize parametric knowledge in the residual stream while Copying Heads fail to retain external knowledge from retrieved content. ^s4
  - [p.1](owlit://library/arxiv-2410.11414#passage=ffn-copying-heads) — Found by inspecting the model's internals, so it needs white-box access.
- Owlit thinks: ClashEval and ReDeEP study opposite failures: following a wrong document over a correct prior, and overriding a correct document with parametric knowledge. ^s5
  - [Chat](owlit://chat/9192e0e5-7910-439e-8d76-8045ee386811) — Different setups: ClashEval perturbs documents to be wrong, ReDeEP's documents are correct.

## Sources

- 2026-10-13 · [Chat](owlit://chat/9192e0e5-7910-439e-8d76-8045ee386811) · you asked how ClashEval's calibrated token-probability method works
- 2026-10-13 · [Sun et al. 2024](owlit://library/arxiv-2410.11414) · you highlighted p.1
