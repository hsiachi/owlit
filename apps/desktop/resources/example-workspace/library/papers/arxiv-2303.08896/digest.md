# SelfCheckGPT: Zero-Resource Black-Box Hallucination Detection for Generative Large Language Models

## Summary

- **Background**: Detecting LLM hallucinations has relied on token probabilities, which APIs may not expose, or on fact verification against an external database.
- **Gap**: The paper sets out to detect hallucinations when only the generated text is available and no external knowledge source is used.
- **Research Question**: Can consistency between one LLM response and N stochastically re-sampled responses to the same prompt flag non-factual sentences and rank passages by factuality?
- **Methods**: GPT-3 (text-davinci-003) wrote 238 WikiBio-style biographies, and the authors hand-labelled their 1,908 sentences. Five consistency scorers (BERTScore, QA, n-gram, NLI, Prompt) were compared against GPT-3's own token probabilities and against LLaMA/OPT proxy LLMs.
- **Key Findings**:
    - SelfCheckGPT-Prompt reached 93.42 AUC-PR for non-factual sentences, against 83.21 for GPT-3's Avg(−log p), with a random baseline of 72.96.
    - At passage level, Prompt correlated with human scores at Pearson 78.32, and NLI came close at 74.14 for much less compute.
    - Proxy-LLM probabilities were near random or even negatively correlated.
- **Limitations**:
    - The evidence comes from one generator (text-davinci-003) on one genre (biographies), so the claim that it works for "any black-box LLM" is untested.
    - The headline Prompt scores use ChatGPT as the judge, so they do not show a model checking itself.
    - On the harder subset that excludes fully fabricated passages, every method falls to 53 AUC-PR or below.
    - Giving the same scorers the real Wikipedia paragraph beats self-sampling for NLI and Prompt.

## Details

### How hallucination was operationalised

The prompt was "This is a Wikipedia passage about {concept}:". The 238 concepts were sampled at random from the 20% longest WikiBio test articles, to avoid obscure subjects (§6, p. 5). The main response was generated at temperature 0, and the N=20 comparison samples at temperature 1.0 (§7, p. 6).

Each sentence was labelled Major Inaccurate (1, unrelated to the topic), Minor Inaccurate (0.5) or Accurate (0). Annotators checked facts with Wikipedia or Google (Figure 3). The split was 39.9% major, 33.1% minor and 27.0% accurate, so non-factual sentences are the majority class. That is why the random AUC-PR for NonFact is already 72.96.

Only 201 of the 1,908 sentences were double-annotated. On those, Cohen's κ was 0.595 for 3 classes and 0.748 for 2 classes, and disagreements were resolved to the worse label. The paper does not say how many annotators there were or who they were. The other ~89% of the labels rest on a single judgement.

Passage scores are the average of the sentence labels. Their histogram has a large peak at 1.0, which the authors call "total hallucination" (Figure 4, p. 6). The NonFact* task removes these passages (leaving 206 passages and 1,632 sentences) and asks for major-inaccurate sentences only.

### The scorers and what they are compared against

Every variant outputs a per-sentence score $S(i)\in[0,1]$ (§5, pp. 3–5):

- **BERTScore** (RoBERTa-Large): one minus the mean of each sample's best-matching sentence score.
- **QA**: MQAG questions are generated from the sentence and answered against each sample. Inconsistency is scored with a Bayesian formula plus answerability soft-counting, with $\beta_1=\beta_2=0.8$ (App. B).
- **n-gram**: an n-gram LM is trained on the samples plus R, and scores the sentence by the average or maximum of $-\log \tilde p$.
- **NLI**: DeBERTa-v3-large fine-tuned on MNLI gives P(contradict), normalised over the entailment and contradiction logits only.
- **Prompt**: the model is asked "Is the sentence supported by the context above? Answer Yes or No", with Yes=0, No=1 and N/A=0.5.

The grey-box baselines use GPT-3's own log-probabilities. Entropy is computed from only the top-5 tokens the API returns, so the entropy baselines are truncated (Table 2 note). The black-box baselines are proxy LLMs: LLaMA 7–30B, OPT, GPT-J and NeoX.

Kadavath et al.'s self-evaluation and Kuhn et al.'s semantic uncertainty are discussed in §2 but were not run. The only black-box competitor actually tested is the proxy LLM, and it fails badly.

### What came back

Results are in Table 2 (p. 7):

| Method | NonFact | NonFact* | Factual | Pearson |
|---|---|---|---|---|
| GPT-3 Avg(−log p) | 83.21 | 38.89 | 53.97 | 57.04 |
| GPT-3 Max(−log p) | 87.51 | 35.88 | 50.46 | 57.83 |
| SelfCk-BERTScore | 81.96 | 45.96 | 44.23 | 58.18 |
| SelfCk-QA | 84.26 | 40.06 | 48.14 | 61.07 |
| SelfCk-Unigram (max) | 85.63 | 41.04 | 58.47 | 64.71 |
| SelfCk-NLI | 92.50 | 45.17 | 66.08 | 74.14 |
| SelfCk-Prompt | 93.42 | 53.19 | 67.09 | 78.32 |

- **BERTScore, QA and the strong baseline.** The authors write that BERTScore, QA and n-gram "outperform the grey-box approaches in most setups". The table supports that only weakly. On NonFact and Factual, BERTScore and QA lose to GPT-3's Max or Avg(−log p), and BERTScore's passage-level margin is 0.35 points. The clear wins are NLI and Prompt.
- **n-gram.** Max beats Avg, and performance falls as n rises from 1 to 5 (Table 7).
- **Proxy LLMs.** Avg(−log p) correlates negatively with human judgement for every OPT, GPT-J and NeoX model, and for LLaMA-7B (Table 8).
- **Number of samples.** Performance rises smoothly with diminishing returns, and n-gram needs the most samples (Figure 7). The values are only plotted, not tabulated.
- **Who checks.** Table 2's Prompt row uses ChatGPT (gpt-3.5-turbo) as the checker. With N=4, GPT-3 judging its own text gets Pearson 73.11, against 76.47 for ChatGPT (Table 4).
- **Agreement between judges.** GPT-3 and ChatGPT agreed on about 82% of 7,632 Yes/No calls (Table 6). The table's row/column orientation is not labelled.
- **Cost.** Prompt with N=20 over all sentences was estimated at about $200 with GPT-3 and about $20 with ChatGPT (App. C).

### Self-samples versus external knowledge

When the actual WikiBio first paragraph replaces the samples (Table 3, p. 8), results split by scorer:

- **Prompt** gains on every metric: NonFact* rises from 53.19 to 65.26 and Pearson from 78.32 to 85.90.
- **NLI** gains on every metric except NonFact, where it slips slightly from 92.50 to 91.18.
- **BERTScore and QA** are roughly unchanged.
- **Unigram** collapses, because one paragraph is too little text to train an n-gram model.

So for the two strongest scorers, self-consistency stands in for retrieval rather than matching it.

### Related Work

The paper positions itself along four lines:

- hallucination in NLG (summarisation, dialogue);
- sequence-level uncertainty estimation (token probability or entropy, semantic uncertainty);
- multi-stage fact verification against retrieved evidence;
- LLM self-evaluation and probes on internal states.

It sets itself against two of these explicitly. Azaria & Mitchell's classifier on hidden states needs white-box access and labelled data. Liu et al.'s detection benchmark uses perturbed text rather than real LLM output.

### Discussion

The authors read the n-gram (max) result to mean that a token appearing once or rarely across 20 samples is a strong hallucination signal (p. 7). They attribute the proxy LLMs' failure to differences in generation style between models, which they offer as an explanation without testing it.

They recommend NLI as the practical trade-off between performance and compute. No runtime is measured for NLI, so that recommendation rests on its architecture rather than on numbers.

### The boundary of the conclusion

- **Scope.** The claim is general detection for black-box LLMs. The evidence is one 2023 generator writing one genre, with concepts chosen to be well covered by pre-training.
- **Where the margins come from.** Total hallucinations, where the samples obviously disagree, seem to drive much of the gap. On NonFact*, the best method reaches 53.19 against a random 29.72, while the headline passage-level correlations are computed over a bimodal distribution (Figure 4).
- **No held-out data.** The paper never mentions a dev split. Unigram-max (Table 7), soft-counting (Table 5) and the β values appear to have been chosen on the same 238 passages they are reported on.
- **"Self" check.** The headline Prompt number uses a different, stronger model as the judge (Table 4). The pure self-check rests on a single N=4 comparison.
- **Consistent errors.** The method's premise is that consistency signals factuality. No experiment isolates facts that are wrong but sampled consistently, which this method cannot catch by construction.
- **Label reliability.** The κ of 0.595 on the 3-class scheme concerns exactly the minor/major boundary that NonFact* depends on.
- **Unused evidence.** Table 3 shows that retrieval, when available, beats self-sampling for the best scorers. The conclusion carries this forward only as "external databases are infeasible for every use case", a claim the paper argues rather than tests.
