# ARES: An Automated Evaluation Framework for Retrieval-Augmented Generation Systems

## Summary

- **Background**: RAG systems are usually tuned with hand-labelled queries, passages and answers for each domain. The existing automated alternative, RAGAS, prompts an LLM with fixed hand-written prompts.
- **Gap**: Prompt-based RAG judges do not adapt to a new corpus and give no statistical guarantee on their scores.
- **Research Question**: Can small judges, fine-tuned on synthetic in-domain data and corrected with a few hundred human labels through prediction-powered inference (PPI), score and rank RAG systems accurately?
- **Methods**: A systems paper. It evaluates ARES on 9 mock RAG systems per dataset, built from 6 KILT/SuperGLUE datasets, on 10 real retriever×LLM configurations, and on 2 AIS attribution datasets, against RAGAS, a few-shot GPT-3.5 judge and per-system sampled annotations.
- **Key Findings**:
    - On the mock systems, ARES's Kendall's τ is on average 0.065 higher than RAGAS for context relevance and 0.132 higher for answer relevance, using 300 human labels.
    - On the 10 real configurations, ARES averages τ 0.91 for context relevance and 0.97 for answer relevance.
    - Answer faithfulness is tested only on two AIS datasets, where ARES comes within 2.5 points of the true hallucination rate.
    - Judges transfer across query and document shifts inside KILT/SuperGLUE but fall to τ 0.28–0.38 across languages, on code and on extraction.
- **Limitations**:
    - The mock systems' negatives are sampled the same way as ARES's own training negatives, so the main test rewards a judge built for that construction.
    - With nine systems, one swapped pair moves τ by about 0.056, so the average lead over RAGAS amounts to roughly one pair, and RAGAS wins some cells.
    - Faithfulness is never used to rank systems.
    - The paper's claim that 150 labels suffice falls below its own τ > 0.9 success bar.

## Details

### What ARES builds and what it needs

The inputs are an in-domain passage set, about 150 or more human-labelled datapoints (the "human preference validation set") and five or more few-shot query/answer examples (§3, p. 3). FLAN-T5 XXL generates a synthetic query and answer from each passage. A query is kept only if it retrieves its source passage as the top result, using ada-002 embeddings with FAISS (§4.1, p. 5). Negatives come in two kinds (§3.1, p. 3):
- *Weak*: a random unrelated passage, or an answer generated for some other passage.
- *Strong*: another passage from the same document (BM25 top-10 when the dataset has no document structure), or a contradictory answer prompted from FLAN-T5.

The paper describes the same negative recipe for answer faithfulness and answer relevance. It does not say how the training data of those two judges differ. Each metric gets its own DeBERTa-v3-Large (304M) binary classifier. Training uses cross-entropy, a 5e-6 learning rate and batch size 32, and stops after three epochs without improvement on the human set (A.1). The human set is therefore used both for early stopping and for PPI.

Scoring: each judge labels sampled triples from a system. PPI uses the human labels to rectify the judge's error and returns a 95% confidence interval. Systems are ranked by the interval midpoints (§3.3, p. 4). No pairwise significance test is used to decide whether two systems differ.

### How the test systems were made

For each of NQ, HotpotQA, FEVER, WoW, MultiRC and ReCoRD, the authors build nine "mock RAG systems". These are dataset splits with known success rates from 70% to 90% in steps of 2.5 points (§4.2, p. 5). Positives are the original gold triples. Negatives are passages and answers sampled "from either the same Wikipedia document or an entirely random Wikipedia document". This is essentially ARES's own strong/weak negative recipe. So the main experiment checks whether a judge trained to spot this kind of negative can count it. It does not check whether the judge can tell real retrieval or generation failures apart. Faithfulness is not evaluated on these datasets because there are no human-labelled hallucinations.

The metric is Kendall's τ, with τ > 0.9 called "successful" without a source (§4.3, p. 6). The paper says τ ranges from 0 to 1, but it actually ranges from −1 to 1. Nine systems give 36 pairs, so each discordant pair costs 0.056. A τ of 0.94 means one swapped pair, and 0.89 means two.

### What came back

**Mock systems, Table 1 (p. 7).** Recomputed from the table, the average accuracy gap over RAGAS is 59.9 points for context relevance, matching §5.1. The abstract and introduction say 59.3. RAGAS's context-relevance accuracy is 15–36%, which is far below chance on a binary task. The paper does not say how RAGAS's continuous scores were turned into labels, so that gap may partly reflect a thresholding mismatch. The caption says ARES ranked more accurately "across all the explored datasets". The table contradicts this in places:
- RAGAS beats ARES on ReCoRD context relevance (0.89 vs 0.83) and MultiRC answer relevance (0.94 vs 0.89).
- The GPT-3.5 judge beats ARES on ReCoRD answer relevance (0.94 vs 0.89).
- On ReCoRD context relevance, ARES's judge accuracy (67.8%) is below GPT-3.5's (81.0%).

My recomputed context-relevance τ gap over RAGAS is 0.055, not 0.065. Adding PPI never lowers τ compared with the raw judge, but 4 of 12 cells are tied, so "improved for all datasets" overstates it.

**Real systems, Table 5 (p. 16).** There are 10 configurations: {BM25, ada-002, ColBERTv2} × {MPT-7b-Instruct, GPT-3.5, GPT-4}, plus Facebook RAG. Each retrieves one passage, and the test sets are NQ, WoW and FEVER (§5.3, pp. 7–8). An answer counts as correct if it contains the KILT answer. The paper does not say how ground-truth context relevance was set. ARES is at least as good as every comparator in every cell. My recomputed answer-relevance average is 0.99, not the reported 0.97. The paper reports that the PPI intervals covered the true values more than 95% of the time, with widths of 7.4 points (context relevance) and 6.1 (answer relevance). Neither the number of intervals nor the cited Figures 2–3 appear in the text. Table 5's caption is copied from Table 1 and still refers to "mock RAG system[s]".

**Faithfulness, Table 2 (p. 7).** The column headers are lost in the parsed text. Assuming WoW is listed first, the predicted versus true faithful rates are 0.478 vs 0.458 (WoW, n=707) and 0.835 vs 0.859 (CNN/DM, n=510), each using 200 human labels. Judge accuracy on WoW is 62.5%. That is one prevalence estimate per dataset. No ranking of systems and no RAGAS comparison is done for faithfulness.

**Cross-domain, Table 6 and §5.4 (p. 8).** Judge accuracy can collapse while τ holds up:
- NQ→FEVER answer relevance: accuracy 28.4%, τ 0.89.
- FEVER→NQ answer relevance: accuracy 22.6%, τ 0.83.
- NQ→ReCoRD context relevance: accuracy 29.1%, τ 0.78.

So in these settings the ranking comes from PPI's human labels, not from the judge. Larger shifts fail: XGLUE τ 0.33, CodeSearchNet 0.28 and T-Rex 0.38, each with an NQ-trained judge. The PPI label count for those runs is not given.

### Annotation budget and label sources

Table 3 (p. 15) varies the human set from 25 to 400 labels on NQ, MultiRC and ReCoRD. At 150 labels, context-relevance τ is 0.72 (NQ), 0.83 (MultiRC) and 0.72 (ReCoRD), all below the 0.9 bar. Only at 300–400 labels do most cells reach about 0.89 or higher. So the "approximately 150" requirement repeated throughout the paper is not supported by its own criterion, and the main results use 300.

The "78% fewer annotations" claim compares 300 labels with 1,350 (150 per mock system × 9). That arithmetic works only if the 300 are shared across all nine systems. The paper does not say how the PPI labels are drawn from each system's outputs, even though PPI needs labels from the distribution being estimated.

Using 500 GPT-4 labels instead of human labels (Table 4) lowers τ by 0 to 0.17 in the table. The caption says 0.05 to 0.30.

### Related Work

The paper positions itself along four lines:
- LLM-as-judge evaluation: MT-Bench and Chatbot Arena, AutoCalibrate, and GPT-based NLG evaluators.
- LLM-based checking of attribution and factuality.
- Resources for knowledge-intensive pipelines, such as ALCE, Hagrid and LongEval.
- Synthetic query generation with round-trip filtering, from Promptagator and UDAPDR.

Its two closest comparisons are EXAM, which needs sub-questions for each query (a cost ARES avoids), and RAGAS, which uses fixed heuristic prompts and is the main baseline (v0.0.18, run with GPT-3.5).

### Discussion

The authors read the comparison with the GPT-3.5 judge as a trade-off. The fine-tuned judge separates systems more precisely, while the GPT-3.5 judge needs no fine-tuning but costs money per query (§5.1, p. 6). They say GPT-4 labels are worse than human ones but "arguably" promising. They also report that the cross-domain judges stay usable because PPI makes up for lost accuracy.

### The boundary of the conclusion

The headline claim is that ARES "accurately evaluates RAG systems" on three dimensions with a few hundred labels. Each part of that claim rests on different evidence:
- **Context and answer relevance on mock systems (Table 1).** Here the test negatives are built the same way as the training negatives (§3.1 vs §4.2). The margins over baselines are often one swapped pair out of 36.
- **Context and answer relevance on real systems (Table 5).** This is the strongest evidence, but it covers 10 configurations on three Wikipedia datasets, each retrieving a single passage. The ground truth for context relevance is not described.
- **Faithfulness (Table 2).** This rests on two prevalence estimates. It supports "estimates a hallucination rate" but not "ranks systems by faithfulness".

Reading the paper's own accounting in both directions:
- The "150 labels" requirement has no support under the τ > 0.9 bar (Table 3).
- The "PPI improves every dataset" claim includes ties.
- The "beats RAGAS across all datasets" caption is contradicted by the ReCoRD and MultiRC cells.
- The paper reports, but never draws a conclusion from, the cross-domain judge accuracies of 22–29% next to τ of 0.78–0.89 (Table 6). Read plainly, these show that ranking quality can come mostly from the human labels. It is never tested how far the 300 labels alone would get under classical inference with the same budget. The sampled-annotation baseline uses a different budget and allocation.

A reader can take from the paper that a DeBERTa judge with PPI ranks Wikipedia-style English RAG configurations at least as well as RAGAS and a GPT-3.5 judge, given about 300 in-domain labels. A reader cannot take away that 150 labels suffice, that faithfulness rankings are validated, or that the method holds outside English Wikipedia/news-style retrieval QA.
