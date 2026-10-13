# Ragas: Automated Evaluation of Retrieval Augmented Generation

## Summary

- **Background**: RAG pipelines need tuning across retriever, corpus, LM and prompt. The usual checks, perplexity and short-answer QA, need reference data or token probabilities that API models do not expose.
- **Gap**: No reference-free way to score a RAG pipeline separately on its retrieval and its generation.
- **Research Question**: Can LLM-prompted metrics for faithfulness, answer relevance and context relevance agree with human pairwise judgements without ground-truth answers?
- **Methods**: Three metrics computed with gpt-3.5-turbo-16k prompts plus ada-002 embeddings. They are validated on WikiEval, a new set of 50 Wikipedia-derived questions, where each item pairs a good candidate with a deliberately degraded one.
- **Key Findings**:
    - Ragas picks the human-preferred candidate with accuracy 0.95 for faithfulness, 0.78 for answer relevance and 0.70 for context relevance.
    - It beats both ChatGPT baselines (direct 0–10 scoring and direct ranking) on all three dimensions.
- **Limitations**:
    - Each degraded candidate was built to be worse, and the low-relevance contexts are padded versions of the good ones, so the accuracies show that obvious contrasts get detected, not that the scores are calibrated on real RAG output.
    - With 50 pairs per dimension, the context-relevance margin over GPT Score is about 3–4 items, and no significance test is reported.

## Details

### What the three metrics compute

All prompts run on gpt-3.5-turbo-16k (§3, p. 3).

- **Faithfulness** $F = |V|/|S|$. An LLM splits the answer into statements. A second prompt then gives a Yes/No verdict on whether each statement is supported by the retrieved context. The question plays no role in the verification step.
- **Answer relevance** $AR = \frac{1}{n}\sum_i \mathrm{sim}(q, q_i)$. The LLM generates $n$ questions from the answer, and the score is the mean ada-002 cosine similarity between each generated question and the original. The paper never states $n$. The definition says AR penalises both incomplete *and* redundant answers (p. 3).
- **Context relevance** $CR$ = sentences the LLM extracts as crucial ÷ total sentences in the context (p. 4). The prompt can return "Insufficient Information", and the paper does not say how that is scored.

CR is a ratio over context length. Two contexts with the same relevant content will always rank the shorter one higher.

### How WikiEval builds its pairs

- The 50 Wikipedia pages cover events since early 2022, chosen to be past the model's training cutoff (§4, p. 4). ChatGPT wrote the questions and the answers from each page's introduction.
- How each degraded candidate was made:
    - Faithfulness: ChatGPT answered without any context.
    - Answer relevance: ChatGPT was prompted to "Answer the given question in an incomplete manner".
    - Context relevance: the context was padded with sentences scraped from back-links, or with ChatGPT completions for pages that had no back-links (pp. 4–5).
- Two annotators, described only as fluent in English, picked the better candidate in each pair. Raw agreement was about 95% for faithfulness and context relevance and about 90% for answer relevance. Disagreements were settled by discussion. No chance-corrected statistic such as kappa is reported.

### What came back

Table 1 (p. 5) reports pairwise accuracy against the human choice:

| | Faith. | Ans. Rel. | Cont. Rel. |
|---|---|---|---|
| Ragas | 0.95 | 0.78 | 0.70 |
| GPT Score | 0.72 | 0.52 | 0.63 |
| GPT Ranking | 0.54 | 0.40 | 0.52 |

GPT Score ties were broken at random. The authors give two explanations, neither tested. They attribute the lower answer-relevance score to "very subtle" differences between candidates. They attribute the context-relevance score to ChatGPT struggling to pick out the crucial sentences, especially in long contexts (p. 5). GPT Ranking scoring 0.40 on a two-way choice is below chance, and the paper does not comment on it.

### Related Work

The paper places itself along three lines:

- LLM-based hallucination and factuality detection: few-shot prompting, token probabilities (BARTScore, Kadavath et al.), hidden-state classifiers, SelfCheckGPT's sampling consistency.
- LLM-as-evaluator for text generation: GPTScore, direct ChatGPT rating, pairwise LLM judging and its order bias.
- Reference-based metrics: BERTScore, MoverScore.

The baselines it compares against are its own prompts in the style of the direct-rating and pairwise-judging work, not those published systems.

### The boundary of the conclusion

- **What the evidence supports.** Table 1 shows only that Ragas separates a constructed good/bad pair in the direction the construction intended. The conclusion's wording, that Ragas is "closely aligned with human predictions" and gives developers "valuable insights" (p. 5), reaches further than that.
- **The human labels may add little.** Every degraded candidate was made worse on purpose, and the faithfulness negative is a no-context answer about post-cutoff events. So the human preference probably matches the construction in almost every item. The paper does not report how often annotators disagreed with the construction.
- **Context relevance may be decided by length.** Table 4 (p. 8) shows the low-relevance context as a strict superset of the high one. CR divides by sentence count, so it should favour the shorter context even with an imperfect extractor. A length-only baseline would show how much the LLM extraction adds, and none was run. Its 0.70 is then the more telling number: Ragas misses about 15 of 50 pairs where length alone points to the answer.
- **Redundancy is never tested.** AR is said to penalise redundant information, but every answer-relevance negative is an *incomplete* answer.
- **Nothing measures absolute scores.** All evaluation is pairwise. No result shows that a given F or CR value means the same thing across questions or pipelines.
- **One model throughout.** The same ChatGPT family wrote the questions, the answers and the degraded candidates, and also ran the metric and both baselines. Agreement could depend on that shared model.
- **Unmeasured claims.** The motivating claims are not measured: faster evaluation cycles, better than perplexity or short-answer QA evaluation (§1), and context focus mattering for cost and "lost in the middle" (p. 3). The llama-index and Langchain integration is described, not evaluated.
