# Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection

## Summary

- **Background**: Standard RAG prepends a fixed number of retrieved passages to every input. It does this whether or not retrieval is needed and whether or not the passages are relevant.
- **Gap**: No prior method trains one LM both to decide when to retrieve and to grade its own passages and outputs, in a form that can be steered at decoding time.
- **Research Question**: Can a single LM, fine-tuned to emit "reflection tokens" for retrieval need, relevance, support and utility, beat larger LLMs and standard RAG on factuality and citation accuracy?
- **Methods**: Llama2 7B and 13B were fine-tuned on about 150k instruction-output pairs. The reflection tokens in those pairs were inserted offline by a Llama2-7B critic distilled from GPT-4 labels. The models were evaluated zero-shot on six tasks against non-retrieval, standard-RAG and proprietary baselines.
- **Key Findings**:
    - Among open models, Self-RAG 13B scores highest on PopQA (55.8), PubHealth (74.5) and ARC-Challenge (73.1).
    - On ASQA its citation precision is 70.3, against 65.1 for retrieval-augmented ChatGPT and below 6 for every open RAG baseline.
    - Llama2-FT7B, trained on the same pairs without reflection tokens, is lower on most metrics, so the gain is not only from the training data.
    - Raising the ISSUP weight at inference trades MAUVE for citation precision without retraining.
- **Limitations**:
    - The abstract says Self-RAG beats ChatGPT on open-domain QA and reasoning, but ChatGPT is higher on TriviaQA (74.3 vs 69.3) and ARC (75.3 vs 73.1).
    - The paper's claim to be best among open models on all tasks fails on ASQA str-em, where retrieval-augmented Alpaca13B scores 34.8 to Self-RAG's 31.7.
    - Self-RAG got five extra web-search documents for biographies and open-domain QA, and the paper says retrieval was equal across systems only for ASQA.
    - On PubHealth, turning retrieval off at test time costs only 0.5 points, so the paper's largest margin does not show that retrieval helps.

## Details

### Reflection tokens and how the generator learns them

Generation runs one segment at a time, and a segment is one sentence in every experiment (§3.1, p. 3, fn. 3). The vocabulary gets four token groups (Table 1, p. 4):
- **Retrieve**: yes / no / continue.
- **ISREL**: relevant / irrelevant.
- **ISSUP**: fully / partially / no support.
- **ISUSE**: a 1–5 "perceived utility", which is defined as independent of factual correctness (A.1, p. 17).

Labels come in a distillation chain. GPT-4 is prompted with a separate instruction and few-shot demonstrations for each group (App. D, pp. 26–30). The paper collects about 12.6k Retrieve labels, 11.2k ISSUP, 19.3k ISREL and 3.8k ISUSE (A.1, p. 17). A Llama2-7B critic is trained on these labels. It then annotates the generator's training corpus offline: it retrieves for each sentence, labels relevance and support, and keeps a passage that is relevant and at least partially supported (A.2, pp. 18–19). The generator is trained with plain next-token loss, and retrieved text is masked out of the loss (Eq. 2, p. 5). The authors argue this is far cheaper than PPO-style RLHF because no reward model runs during training. They do not measure the cost difference.

The training mix is 145,619 instances (Table 3, p. 18), which the main text calls 150k. About 92k are Open-Instruct instruction data and about 54k are knowledge-intensive (NQ, WoW, FEVER, ASQA, OpenBookQA, ARC-Easy). ASQA and ARC-Easy are in the training data, and both sit close to two of the evaluation tasks.

Each link in the label chain is checked only against the link before it:
- **GPT-4 against humans**: the authors themselves judged 20 instances per aspect. Agreement was 95% for relevance, 95% for retrieval need, 90% for support and 80% for usefulness (A.1, p. 17).
- **Critic against GPT-4**: on held-out GPT-4 labels the critic scores 93.8 / 93.5 / 80.2 / 73.5. The parsed header gives the order Retrieve, ISSUP, ISREL, ISUSE (p. 18). The main text says ">90% agreement on most categories" (p. 5), but that holds for only two of the four.

So the support and relevance labels the generator learns from were never compared with human judgement beyond those 20 author-judged instances per aspect.

### Inference-time control

Retrieval fires when the normalised probability of Retrieve=Yes is above a threshold δ (A.3, p. 19). By default δ is 0.2 for most tasks and 0 for ALCE, which the paper says is chosen "to encourage frequent retrieval" (§4.3, p. 7). With retrieval, each of the top-K passages yields a candidate segment. A segment-level beam search (beam 2) ranks them by

$$f(y_t, d) = p(y_t \mid x, d, y_{<t}) + \sum_{G} w_G\, s^G_t$$

where $s^G_t$ is the normalised probability of the desirable token in group $G$ (§3.3, p. 6). ISSUP counts partial support at 0.5. ISUSE maps the scores 1–5 to −1…1 (A.3, p. 19). The default weights are 1.0 / 1.0 / 0.5 for ISREL / ISSUP / ISUSE. Hard filtering of undesirable tokens is described as an alternative, but the paper does not use it in the main results.

The paper describes the evidence for controllability in words only:
- **ISSUP weight** (Fig. 3b, p. 9): in one sweep, 7B on ASQA, raising the weight increases citation precision and lowers MAUVE. The parsed text gives no numbers.
- **Threshold** (Fig. 3c, p. 10): varying δ changes retrieval frequency "dramatically". Accuracy drops less on PubHealth than on PopQA when retrieval is reduced. The paper does not report retrieval frequency at the default δ.

### What was compared, and how

The six tasks are all zero-shot (§4.1, pp. 6–7):
- PubHealth and ARC-Challenge, scored by accuracy.
- PopQA, the long-tail subset of 1,399 queries.
- TriviaQA-unfiltered, 11,313 queries. For both QA sets, a model counts as correct if the gold answer appears in its output.
- Biographies, scored with FactScore.
- ASQA, scored with str-em, rouge, MAUVE and citation precision/recall.

The baselines are Llama2, Alpaca (the authors' Llama2 replication), Llama2-chat and ChatGPT, each with and without retrieval, plus Llama2-FT7B (§4.2, p. 7). Numbers for SAIL, Toolformer and CoVE65B are copied from those papers, not rerun (fn. 6, p. 7). The CoVE FactScore of 71.2 is therefore borrowed.

The setup differs between systems in four ways:
- **Retrieved documents**: the paper says retrieval was identical across systems only for ASQA (GTR-XXL top-5). Self-RAG gets an extra five Google Programmable Search documents on biographies and open-domain QA (§4.3, p. 7; B.2, p. 20), and the paper does not say whether the RAG baselines got them too.
- **Wikipedia dump**: PopQA uses the December 2020 dump instead of the 2018 one (B.2, p. 20).
- **ASQA instruction**: Self-RAG gets a different instruction from the baselines (Table 5, p. 23).
- **Generation length**: baselines are capped at 100 tokens on ALCE because Llama2-chat's long outputs inflated str-em. On FactScore, baselines get 500 tokens in total and Self-RAG gets 200 per segment (B.2, p. 20).

### What came back

Full results are in Table 2 (p. 8). Self-RAG 13B / 7B score:
- PopQA 55.8 / 54.9, TriviaQA 69.3 / 66.4, PubHealth 74.5 / 72.4, ARC 73.1 / 67.3.
- Bio FactScore 80.2 / 81.2.
- ASQA em 31.7 / 30.0, MAUVE 71.6 / 74.3, citation precision 70.3 / 66.9, citation recall 71.3 / 67.8.

On biographies the margin is small. Retrieval-augmented Llama2-chat13B reaches 79.9 and Llama2-FT7B 78.2. The 7B model beating the 13B is attributed to shorter, more precisely grounded outputs (p. 9), but output lengths are not reported. The large and consistent gap is citation quality. Open RAG baselines are at 2–6 precision, which partly reflects that they were never trained to cite. On ASQA str-em, Self-RAG does not lead.

The ablations use 7B models trained on 50k instances. ASQA is evaluated on 150 sampled questions. Results (Fig. 3a, p. 9):

| Variant | PopQA | PubHealth | ASQA em |
|---|---|---|---|
| Self-RAG (50k) | 45.5 | 73.5 | 32.1 |
| No Retriever (trained without passages) | 43.6 | 67.8 | 31.0 |
| No Critic (trained on top-1 passage, SAIL-like) | 42.6 | 72.0 | 18.1 |
| No retrieval at test | 24.7 | 73.0 | – |
| Hard constraints (retrieve only on Retrieve=Yes) | 28.3 | 72.6 | – |
| Retrieve top1 | 41.8 | 73.1 | 28.6 |
| Remove ISSUP from beam score | 44.1 | 73.2 | 30.6 |

The paper reads this as "all components play important roles". The table shows something narrower:
- Removing the critic costs a lot only on ASQA.
- Removing retrieved passages from training costs a lot only on PubHealth, where the critic and retrieval at test time matter least.
- Removing ISSUP costs 1.5 points on ASQA.
- Hard constraints underperform the δ threshold by 17 points on PopQA. So the model's own Retrieve=Yes decision, taken at face value, retrieves too rarely, and the default works only because δ is set low.

Other results:
- **Training size** (Fig. 4a–c, p. 10): 5k → 150k shows mostly upward trends, larger on PopQA and ASQA. The claim that more data would help further is an extrapolation.
- **Human evaluation** (Fig. 4d, p. 10): 50 samples from PopQA and Bio, numbers read from the parsed figure text. S&P is 92.5 (PopQA) and 70.0 (Bio). ISREL agreement is 95.0 / 90.0 and ISSUP agreement 90.0 / 85.0. S&P excludes the cases where Self-RAG predicted irrelevant or no support, so it scores only the outputs the model already rated as good. The paper does not say who the annotators were or how many there were.
- **Answers not in the passages** (C.1, p. 20): only 2% of Self-RAG's correct answers are absent from its passages, against 15–20% for the baselines. The paragraph names an "Alpaca 30B" that is not among the models listed as evaluated. The measure shows copying from evidence. It does not show correctness.

### Related Work

The paper places itself along three lines:
- RAG: retrieve-once models, joint retriever–LM training, adaptive retrieval (FLARE-style, Toolformer API calls).
- Concurrent RAG variants: RA-DIT instruction-tunes retriever and LM; Yoran et al. and RECOMP filter or compress passages with external models; LATS runs tree search with LM value scores.
- Critique-guided training and decoding: RLHF/PPO, fine-grained RLHF, control tokens (CTRL, Quark), self-evaluation-guided decoding, iterative self-refinement.

The explicit contrasts are SAIL, which the No Critic ablation approximates, and CoVE on biographies, using CoVE's reported number.

### Discussion

The authors read Table 2 this way: retrieval helps baselines mainly where the answer can be copied as a substring (PopQA, Bio), and does little on PubHealth and ARC (p. 8). They explain the ISSUP–MAUVE trade-off by saying longer, more fluent generations carry more claims their citations do not support, consistent with Liu et al. 2023a (p. 10). They argue that the larger accuracy loss from retrieving less on PopQA than on PubHealth reflects how knowledge-dependent each task is. They take the Llama2-FT7B gap to mean the framework, not the data, drives the gains.

### The boundary of the conclusion

**Beating ChatGPT.** The abstract's version rests on Table 2, which supports it only for PopQA, PubHealth, Bio and ASQA rouge/MAUVE. TriviaQA and ARC go the other way, and the paper's own §5.1 list leaves them out without saying so.

**Best among open models.** This fails on ASQA str-em (Alpaca13B with retrieval: 34.8). Where it holds, the retrieval asymmetry above limits what it means. Self-RAG's extra web documents on PopQA, TriviaQA and Bio are a confounder the paper does not rule out. PopQA and Bio are also where retrieval helps most.

**"Learns when to retrieve."** The Hard constraints row (Fig. 3a) cuts against this. Used as-is, the learned decision loses badly to a low hand-set threshold. Retrieval frequency at the default threshold is never reported, so how "on-demand" the system is in practice is unknown.

**"Without hurting versatility."** The introduction and §3 promise this (pp. 1, 3), with the essay example as motivation. None of the six tasks is open-ended generation, and MAUVE on ASQA is the only fluency measure. The claim has no measurement under it.

**Evidence the paper reports but does not use:**
- PubHealth with retrieval off scores 73.0, against 73.5 with it on. The largest gain over baselines on that task therefore comes from fine-tuning, not retrieval or critique.
- The Bio reversal between 7B and 13B is noted but never related to output length.

**Strength of the comparisons.** Every result is a single run with no variance, though the paper often says "significantly". The ablations use 50k-instance models and 150 ASQA questions. Controllability is shown for one weight, on one task, with one model size. Within those limits, the citation-precision result on ASQA is the best supported.

---

I wrote the note from the paper's full text above. I didn't show any figures because the paper's figure list in the library is empty. The few numbers I took from Figure 4d (the human evaluation) were read from the parsed text, not from an image.
