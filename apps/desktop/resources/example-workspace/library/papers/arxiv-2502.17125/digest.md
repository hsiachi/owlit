# LettuceDetect: A Hallucination Detection Framework for RAG Applications

## Summary

- **Background**: Even with retrieved context, RAG answers still hallucinate. Existing detectors are either LLM judges, which are slow and large, or encoders with short context windows.
- **Gap**: No permissively licensed, compact encoder detector that reads a whole RAGTruth context in one pass.
- **Research Question**: Can a ModernBERT token classifier, without NLI pretraining, match fine-tuned LLM detectors on RAGTruth?
- **Methods**: ModernBERT-base (150M) and -large (396M) are fine-tuned as token classifiers on RAGTruth and evaluated on its test split. Baseline scores are copied from the Luna, RAGTruth and RAG-HAT papers.
- **Key Findings**:
    - lettucedetect-large-v1 reaches 79.22 example-level F1, ahead of Luna (65.4) and fine-tuned Llama-2-13B (78.7), but behind RAG-HAT (83.9).
    - At span level it reaches 58.93 F1, against 52.7 for Llama-2-13B.
- **Limitations**:
    - The span-level win compares the authors' own metric implementation against numbers produced by RAGTruth's code.
    - The speed and size advantages are asserted, not measured against any baseline.
    - Nothing isolates long context as the reason for the gain, and nothing tests the model outside RAGTruth.

## Details

### What the design bets on

The paper sets out two limits of earlier detectors: encoders have short context windows and LLM judges are expensive (abstract, p. 1). Its answer is ModernBERT, which supports 8,192 tokens through RoPE and alternating local-global attention (§2, p. 2). Training uses only the binary hallucinated/supported label. RAGTruth's four hallucination types are ignored (§3, p. 4). The input is context, question and answer joined with [CLS]/[SEP] and truncated at 4,096 tokens, so the full 8k is not used (§4, p. 4). Context and question tokens are masked with label −100, and answer tokens are labelled 0/1. Training uses AdamW at lr 1e-5 with weight decay 0.01, for 6 epochs at batch size 8 on one A100. Consecutive tokens above 0.5 probability are merged into spans. Unlike Luna and RAGHalu, the model gets no NLI pretraining.

The authors measured the token lengths of RAGTruth themselves: mean 801, median 741, max 2,632 (p. 4). So every example fits easily within the 4,096-token limit. Any 4k-context encoder would see whole inputs here, and the 8k capacity does nothing on this benchmark.

### What the tables show

Data: RAGTruth (Niu et al.) has about 18k span-annotated responses across QA (MS MARCO), data-to-text (Yelp) and summarization (CNN/DM). The responses come from GPT-4, Mistral-7B and Llama-2 chat models. Train and test share these generators and tasks.

Example level (Table 2, p. 5): large-v1 reaches P 80.44, R 78.05, F1 79.22, and base-v1 reaches F1 76.07. Large-v1 beats fine-tuned Llama-2-13B on every task, but only narrowly: 70.18 vs 68.2 on QA, 88.54 vs 88.1 on data-to-text and 59.69 vs 59.1 on summarization. RAG-HAT, a DPO-trained Llama-3-8B, beats it on all three tasks. Against the best prompt baseline, gpt-4-turbo at 63.4, the gap is large. The paper does not say how an example-level label is derived from token predictions.

Span level (Table 3, p. 5): large-v1 reaches 58.93 F1 against 52.7 for Llama-2-13B, using character-level overlap. Summarization is the weak spot, with recall of 35.47 for large-v1 and 28.08 for base-v1. On summarization, base-v1 (36.71) falls below Llama-2-13B (38.6).

### Related Work

The paper places itself among three lines of work: prompt-based judges (RAGAS, Trulens, SelfCheckGPT, ChainPoll, LM-vs-LM), fine-tuned LLM judges (RAGTruth's Llama-2-13B, RAG-HAT) and encoder detectors (RAGHalu, Luna, FACTOID). It names Luna as its closest neighbour. Luna is a DeBERTa model with NLI pretraining, trained on GPT-4-annotated cross-domain QA data. LettuceDetect differs by using a ModernBERT backbone, skipping NLI pretraining, and training only on RAGTruth's human labels.

### The boundary of the conclusion

- **Baselines.** Every baseline number in Tables 2 and 3 is copied from the Luna, RAGTruth or RAG-HAT papers, and none was re-run (§5, p. 5). The 0.5-point lead over Llama-2-13B is a single run with no variance reported. That margin cannot carry "outperforms".
- **Span-level metric.** The span-level "state of the art" relies on the authors' own implementation of the metric, because RAGTruth did not release one (p. 6). The comparison therefore puts their metric next to RAGTruth's published numbers, which were produced by a possibly different procedure.
- **Efficiency.** The claim of 30 to 60 examples per second (p. 5) comes with no GPU model, batch size or input length. No baseline's throughput was measured either. The comparison against LLM judges is therefore argued, not shown.
- **"30× smaller".** The ratio holds against the 13B model, at roughly 33×. Against RAG-HAT's 8B, the only model that beats LettuceDetect, it is about 20×.
- **Abstract figures.** The "14.8% improvement" over Luna does not match Table 2: the gap is 13.8 points, or about 21% relative. The abstract also says "most prompt-based models", while §5 says "all".
- **Long context.** The paper's main motivation is long context, but nothing tests it. There is no ablation with truncated context and no comparison against a backbone with a shorter window. As noted above, RAGTruth inputs never exceed 2,632 tokens, so the benchmark cannot test the 8k capacity anyway. The gain could equally come from ModernBERT pretraining or from training on human labels.
- **Checkpoint selection.** The best checkpoint was chosen by token-level F1 (p. 4), but the paper does not say which split was used. If no held-out split was used, the reported test scores may be optimistic.
- **Scope.** The evidence covers English, in-distribution RAGTruth only. Performance on new generators, other domains or other benchmarks is untested.
