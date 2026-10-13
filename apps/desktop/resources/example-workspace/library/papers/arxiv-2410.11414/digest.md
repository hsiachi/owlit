# ReDeEP: Detecting Hallucination in Retrieval-Augmented Generation via Mechanistic Interpretability

## Summary

- **Background**: In RAG, a model can contradict a retrieved document that is correct and relevant, which the authors call RAG Hallucination. They separate this from Knowledge Conflict, because a conflict between the context and parametric knowledge does not always produce a hallucination.
- **Gap**: The authors sort existing detectors into three causal groups: PCE, ECP and MPE. They argue that none of the three separates the model's use of external context from its use of parametric knowledge.
- **Research Question**: Which internal components are linked to RAG hallucinations? Can a detector that scores those components separately beat existing detectors?
- **Methods**: A correlational and interventional study of attention heads and FFNs in Llama2-7B-chat on the RAGTruth training set. This produces ReDeEP, a weighted difference of FFN-based PKS and head-based ECS, tested on RAGTruth and Dolly (AC) with three LLaMA models against 16 baselines.
- **Key Findings**:
    - On Llama2-7B, 1006 of 1024 heads score higher ECS on truthful responses, and later-layer FFNs add more parametric knowledge on hallucinated responses.
    - ReDeEP has the best AUC in all six model × dataset cells, but on RAGTruth its lead over the best baseline is only about 0.015–0.04.
    - AARF wins more GPT-4o pairwise truthfulness judgements than the unmodified model, but the text gives no counts.
- **Limitations**:
    - The mechanism was found in one model, and the "causal" test only shows that disrupting these components raises NLL on truthful responses.
    - The ablation shows ECS alone does almost all of the work, so the decoupling argument rests on small increments.
    - The best variant, ReDeEP(chunk), scores context use with an external BGE embedding model, so its gains are not purely internal-mechanism signals.

## Details

### What the two scores measure

Both scores are proxies the authors designed themselves. They concede the metrics "may not be exact" (§3.1, p. 5).

- **External Context Score (ECS)**, per head and per token (§3.1, p. 4–5). Take the top 10% of context tokens by the head's attention weight. Mean-pool their last-layer hidden states. ECS is the cosine similarity between that pooled vector and the current token's last-layer hidden state. A response's ECS is the average over its tokens. The score blends two things the paper later wants to tell apart: whether the head attended to the right tokens, and whether that information survived into the final layer.
- **Parametric Knowledge Score (PKS)**, per layer (Eq. 5). This is the JSD between the LogitLens vocabulary distributions of the residual stream before and after the FFN. It measures how much the FFN changes the next-token distribution. Calling that change "parametric knowledge" is an interpretation borrowed from Geva et al., not something the paper measures.
- **Copying head score** (Appendix B). Elhage et al.'s count of positive eigenvalues is replaced by a heuristic: the trace of $W_U W_{OV} W_E$, Gershgorin disks, IQR outlier counts and a rank sum. The paper does not check this heuristic against the exact eigenvalue method. "Copying Heads" in this paper therefore means heads ranked by this approximation.

### The mechanistic evidence

All of §3 uses Llama2-7B-chat on the RAGTruth training set. The number of truthful and hallucinated responses is not given in the text.

- **RQ1, external context.** 1006 of 1024 heads have $\Delta E > 0$ (truthful minus hallucinated), and most heads' ECS correlates negatively with the hallucination label (Fig. 4a–b, p. 6). Per-head copying scores correlate with these maps at PCC 0.41 and 0.46 (Fig. 4c). This is the basis for saying that "heads associated with hallucinations are often Copying Heads". A correlation of around 0.4 across heads supports "tend to be", not "are".
- **RQ1, parametric knowledge.** Later-layer FFNs have higher PKS on hallucinated responses and correlate positively with the label (Fig. 4d–e). The authors then *define* these layers as "Knowledge FFNs". The category is picked out by its correlation with hallucination, so its link to hallucination is partly true by construction.
- **Lost versus mis-attended (Appendix C, Table 2).** On responses Llama2-7B got wrong, the context span with the highest mean attention was checked by GPT-4o: could it support the annotated conflict? It could in 77.5% of cases. The authors take this to mean that hallucinations come mainly from the model *losing* information the heads attended to. That is an inference: the check shows only that attention landed on the relevant span, and it rests on a single GPT-4o judgement per item. They propose copy-suppression heads (McDougall et al.) as a possible cause, but do not test it.
- **RQ2, "causal" intervention (Appendix D).** Two interventions: replace the attention scores of the top 32 Copying Heads with $\mathcal{N}(0,1)$ noise, and multiply the top 5 Knowledge FFNs' contributions by 10. Each is compared with matched control heads or layers. The outcome is the change in NLL on *truthful* responses, and the experimental groups shift NLL more (Fig. 5 left). The text gives no numbers. What this shows is that these components matter more for reproducing faithful text than nearby ones do. It does not show that their natural variation causes hallucination, and hallucination rate is never the outcome.
- **RQ3 (Appendix E).** Llama2-7B answered the truthful-set queries without retrieval, and GPT-4o kept the answers matching the reference as the "LLM-known" set $\hat{D}_T$. Compared with $D_H$, this set has higher ECS and lower PKS (Fig. 5 right). The two sets differ in query, task and response at the same time, so this is a contrast between groups, not a controlled comparison.
- **Authors' reading.** They link the FFN result to early-exit work (DoLa, CALM): when the context is sufficient, shallow layers suffice, and deeper parametric additions "confuse" the model (p. 7). This is offered as consistency with prior work and not tested here.

### From mechanism to detector

- **ReDeEP(token)** (§4.1): $H_t(t)=\sum_{l\in F}\alpha P^l_t-\sum_{(l,h)\in A}\beta E^{l,h}_t$, averaged over the response. The paper calls α and β "regression coefficients", and the text after the equation swaps which one belongs to which score. In the implementation, α = 1 throughout and β, the number of top heads and the number of top FFN layers are chosen on the RAGTruth validation set. On Dolly (AC) they are chosen by "twofold validation" (Appendix I). So the detector is a weighted difference tuned by hand, not a fitted regression model.
- **The selected configurations vary a lot.** Heads range from top-1 to top-11, FFN layers from top-1 to top-30, and β from 0.1 to 1.8 across models, datasets and variants (Appendix I). There is no stable "Copying Head / Knowledge FFN" set that carries over between settings.
- **ReDeEP(chunk)** (§4.2): the context and response are split with LangChain's RecursiveCharacterTextSplitter. For each response chunk, the context chunk with the highest mean attention is found, and ECS becomes the cosine similarity of their **BGE embeddings** (bge-base-en-v1.5). PKS is averaged within each chunk. In this variant, internal attention only chooses *which* pair to compare. The comparison itself is an external semantic-similarity model.
- **AARF** (§4.3): during decoding, if a token's $H_t$ exceeds τ, the outputs of the selected heads are multiplied by a constant > 1 and the selected FFNs by a constant in (0,1). The text calls these α₂/β₂ and Appendix I calls them α₁/β₁. Settings are 5/0.2 on RAGTruth and 2/0.5 on Dolly (AC), with τ between 0.0 and 0.6. No weights are updated.

### Detection and mitigation results

Table 1 (p. 10) reports AUC, PCC, Recall and F1. §5.1 also lists Accuracy as a metric, but the table has no Acc column. The parsed table does not label its three blocks by model. The order in §5.1 suggests Llama2-7B, Llama2-13B, then Llama3-8B; this is an inference from that order.

| AUC, best ReDeEP vs best baseline | RAGTruth | Dolly (AC) |
|---|---|---|
| Block 1 (Llama2-7B?) | 0.7458 vs 0.7290 (RAGAS) | 0.7949 vs 0.7110 (Trulens) |
| Block 2 (Llama2-13B?) | 0.8244 vs 0.8089 (SEP) | 0.8420 vs 0.7214 (EigenScore) |
| Block 3 (Llama3-8B?) | 0.7522 (token) vs 0.7092 (SAPLMA) | 0.7354 vs 0.7040 (Trulens) |

- **Size of the margins.** The margins are much larger on Dolly (AC) than on RAGTruth, and Dolly (AC) is the dataset tuned by twofold validation with labels the authors produced themselves. The paper reports no variance, seeds or significance tests, so "significantly outperforms" is not a statistical claim.
- **Recall and F1.** ReDeEP is not best everywhere. On RAGTruth block 2, LMvLM has higher recall (0.8357 vs 0.7440). On block 3 Dolly (AC), RAGAS has 0.8000 recall against 0.8392.
- **Chunk versus token.** "ReDeEP(chunk) generally outperforms ReDeEP(token)" (p. 9) does not hold for RAGTruth block 3, where token wins on all four metrics.
- **Identical baselines.** Perplexity, LN-Entropy, Energy and SelfCheckGPT have identical numbers in blocks 1 and 2, but Focus differs between them. The paper does not explain this. Either these baselines were not rerun for the second backbone, or the blocks were copied.
- **Ablation (Appendix J, Table 3).** Only-ECS comes close to Full: token-level RAGTruth AUC is 0.7234 vs 0.7325 and 0.8040 vs 0.8181. Only-ECS already beats every baseline in RAGTruth block 3. On Dolly (AC) chunk block 3, Only-PKS reaches 0.7334 vs Full 0.7354. Adding the second covariate always helps, but by roughly 0.01–0.04 AUC in most cells, with no error bars.
- **Efficiency (Appendix K, Fig. 7).** The authors state that chunk is faster than token, and that methods without external models (ITI, ReDeEP) are faster than LLM-judge methods. The figure's values cannot be read from the parsed text.
- **AARF (Fig. 6).** GPT-4o judged pairs (AARF vs baseline) using the prompt in Appendix L, with "Tie … generally not needed". The win/tie/loss counts appear only in the figure, and the text says only "to a certain extent". There is no human evaluation and no hallucination rate.

### Related Work

The paper sits where three lines of work meet. The first is hallucination detection, in the three causal families it defines: hidden-state probes such as SAPLMA, SEP, ITI and EigenScore; context-versus-response judges such as RAGAS, Trulens, RefChecker, ChainPoll and LMvLM; and uncertainty and sampling methods such as Perplexity, LN-Entropy, Energy, Focus and SelfCheckGPT. The second is knowledge-conflict research (Xu et al. 2024), which it uses to motivate separating RAG hallucination from conflict. The third is circuit-style mechanistic interpretability: Copying Heads via OV circuits (Elhage et al.), FFNs as key-value memories (Geva et al.), the logit lens, and early-exit decoding (DoLa). Retrieval heads (Wu et al. 2024) and the study by Wadhwa et al. 2024 on how RAG balances context and parametric knowledge are its nearest mechanistic neighbours. Neither is used as a baseline.

### The boundary of the conclusion

- **Where the mechanism comes from.** The mechanistic claim, that Copying Heads lose external information and Knowledge FFNs over-inject, rests entirely on Llama2-7B (§3, Appendix C–E). Llama2-13B and Llama3-8B only inherit it through the detector working. Since the head and layer sets chosen per setting range from 1 to 30 components (Appendix I), detector performance cannot confirm that the same components play the same role in other models.
- **What "causally related" rests on.** The Finding box on p. 7 says "causally related", but its support is RQ2: destructive noise and a 10× amplification, with NLL on truthful text as the outcome (Appendix D). That establishes that the components matter for faithful copying. It does not establish that hallucinations happen *because* their contribution varies naturally. The "lost rather than mis-attended" half of the Finding rests on a single GPT-4o-judged proportion (77.5%, Table 2).
- **Whether decoupling explains the gains.** The paper attributes ReDeEP's gains to decoupling the two scores as covariates (§5.2). Its own ablation (Table 3) shows ECS alone carries most of the performance. The chunk variant's ECS is BGE embedding similarity, which is close in kind to the ECP baselines the paper argues are confounded. So the evidence supports "an attention-guided context-similarity score is a strong detector", and supports the confounding-based argument only weakly.
- **Labels and data.** Labels for Llama3-8B on RAGTruth, and for Dolly (AC) responses, come from three graduate annotators hired by the authors (Appendix G). Inter-annotator agreement is not reported, and dataset sizes are not given in the text. The largest margins (Dolly (AC)) sit on these labels and on twofold-validated hyperparameters.
- **Unused evidence.** RQ3 (Fig. 5 right) is said to "support leveraging our Finding to detect RAG hallucination". However, no part of the detector uses whether the model already knows the answer, so the claim has nothing under it in §4–5. In the other direction, the 22.5% mis-attended cases in Table 2 are never used. AARF only amplifies heads, which would not help when the heads attend to the wrong span.
- **Scope of AARF.** Calling AARF a hallucination reducer rests only on GPT-4o pairwise preferences with unreported counts. It may be cited as a proof of concept, not as a measured reduction in hallucination rate.
