# When Not to Trust Language Models: Investigating Effectiveness of Parametric and Non-Parametric Memories

## Summary

- **Background**: Prompted LMs answer factual questions from parametric memory, and retrieval-augmented LMs add retrieved text. It is unclear when the retrieved text helps more than the model's own memory.
- **Gap**: Earlier memorization studies used QA sets made mostly of popular entities, or used pretraining-corpus counts that can't be computed from the question alone.
- **Research Question**:
    - RQ1 How much factual knowledge do LMs memorize, and what drives it?
    - RQ2 How far does retrieval make up for the gaps?
    - RQ3 Can parametric and non-parametric memory be combined adaptively?
- **Methods**: Closed-book and retrieval-augmented QA with 10 LMs from 1.3B to about 175B (GPT-Neo, OPT, GPT-3), tested on POPQA and EntityQuestions. POPQA is a new set of 14k templated Wikidata questions in which popularity is measured as Wikipedia page views.
- **Key Findings**:
    - Accuracy correlates with subject popularity, up to about 0.4 for GPT-3 davinci-003.
    - On the 4,000 least popular POPQA questions, scale barely helps: GPT-Neo 6B gets 15% and davinci-003 gets 19%.
    - Retrieval helps most on rare entities, but it hurts 10% of davinci-003's answers because the retrieved passage is wrong.
    - A popularity threshold that decides when to retrieve reaches 46.5% on POPQA, 5.3 points above any non-adaptive setup.
- **Limitations**:
    - The thresholds are tuned for each relationship type on POPQA splits, so the method assumes the relation type and the linked subject entity are known at test time.
    - GPT-3 was prompted zero-shot and every other model 15-shot, so the scaling curves mix model size with prompting regime.
    - All questions are templated single-hop entity facts, so nothing here shows the threshold works on naturally phrased questions.

## Details

### How POPQA makes popularity testable

The authors want to predict memorization from the question alone, so they use two input-side variables: subject popularity, measured as monthly Wikipedia page views, and relationship type (§3.2, p. 3). They chose page views because counting entities in pretraining corpora is expensive and noisy, and GPT-3's corpus is private. The paper only says page views "align well with our intuition" (p. 3) and never checks them against corpus frequency.

POPQA covers 16 relation types, each phrased with a template written by the authors (Table 2). Triples were sampled using **C4 term frequency** of the subject's aliases, with the rule $f > \exp(8R-6)$ weighting the sample toward popular entities, and each relation type was capped at 2,000 triples (App. A, p. 13). So the sampling uses one popularity measure and the analysis uses another. The test set has 14,282 questions. The paper says results were "fairly robust" to the choice of template but reports no numbers for this (p. 4).

For EntityQuestions, only the 82% of questions whose subject maps to a unique Wikidata entity were used. A prediction counts as correct if any substring of it exactly matches a gold answer. This is lenient toward long outputs, and zero-shot GPT-3 gives full sentences (Table 3).

### Parametric memory: popularity, relation type, scale (§4)

- Overall closed-book accuracy on POPQA is 35% for GPT-3 and 25% for GPT-Neo 20B.
- The correlation between log-popularity and whether an answer is correct is positive for almost every relation type. It is stronger in larger models: about 0.4 for davinci-003 and about 0.1 for GPT-Neo 1.3B (Fig. 4, p. 5).
- Relation type matters, but the authors' reading is that some types can be guessed. Country and sport show high accuracy with low correlation, which they attribute to surface cues in names or to a dominant answer such as "red" for color. This is an interpretation; no artifact test was run.
- On EntityQuestions the correlation for "capital" is **negative**. The cause is a U-shaped pattern: many low-popularity subjects contain the answer in their own name, as in "canton of Marseille-Belsunce" (App. C.1). So the sign of the correlation depends on which slice of the popularity range was sampled.
- On scale, accuracy rises with model size only for questions with log₁₀ popularity above 4 (Fig. 5). The claim that scaling "is not projected to move the threshold far into the long tail for practical model scales" (p. 6) is argued, not measured: no extrapolation is fitted. The models also come from three families trained on different data, and GPT-3's size is given only as "~175B".

### Retrieval: where it helps and where it misleads (§5)

Setup: one top-ranked paragraph from a December 2018 Wikipedia dump, retrieved with BM25 or Contriever. GenRead, in which the model writes its own context, is the parametric comparison. That gives 40 configurations in total.

- With Contriever, GPT-Neo 2.7B beats vanilla GPT-3, and Contriever adds 7 points to davinci-003 (Fig. 7).
- Retrieval wins on less popular entities, while parametric memory matches or beats it on popular ones (Fig. 8). Contriever is better overall, but BM25 is better on the least popular entities, which agrees with Sciavolino et al.
- GenRead brings little gain for small models but sizeable gains for GPT-3. It still does poorly on rare entities, and it costs 70 s per query with GPT-NeoX 20B.
- Table 1 splits davinci-003's POPQA questions into four groups. Both settings correct: 24% (recall@1 0.83). Only retrieval hurts: 10% (recall@1 0.14). Only retrieval helps: 17% (recall@1 0.88). Both wrong: 49% (recall@1 0.11). Overall recall@1 is 0.42. The examples in App. C.3 mostly show the wrong entity being retrieved, such as a namesake, and one "help" case (Pierre) is right only by coincidence.

The largest group is the 49% where both settings fail and retrieval almost never finds the answer. That points to the retriever as the main bottleneck, and the paper does not take this further.

### Adaptive Retrieval (§6)

The method retrieves only when the subject's popularity falls below a threshold chosen separately for each relation type. Thresholds are set by brute force to maximize adaptive accuracy on 75% of POPQA and tested on the other 25%, averaged over 100 random splits (App. B).

- Best result: davinci-003 using GenRead above the threshold and Contriever below it reaches 46.5%, 5.3 points above any non-adaptive method. Models under 10B gain little because they retrieve for almost every question (Fig. 10). Davinci-003 with BM25 retrieves for 40% of questions.
- On cost, the paper reports latency down by up to 9% compared with always retrieving, and about 15% lower GPT-3 API cost on EntityQuestions with equal accuracy (Fig. 12). The abstract and introduction say "up to 10%" improvement and API cost cut "by half" (p. 2), but the body never states either number directly. They could only come from Fig. 11 and Fig. 9, and the parsed text does not show those values.

### Related Work

The paper sits along three lines of work:
- LMs as knowledge bases and closed-book QA
- memorization as a function of pretraining frequency
- retrieval-augmented LMs, including work on models ignoring the retrieved context and on knowledge conflicts

The closest comparison is the concurrent Kandpal et al. 2022, which correlates question–answer co-occurrence in the pretraining corpus with accuracy. This paper replaces that with a variable available from the input and adds a dataset controlled for popularity. Earlier decisions about when to retrieve (kNN-LM, He et al. and Drozdov et al.) work at the token level; here the decision is made once per query.

### The boundary of the conclusion

- **The descriptive findings (RQ1–2) are well supported** within templated single-hop entity questions. Two datasets, ten models and 95% confidence intervals back the popularity pattern, and the authors' own limitations section restricts the claim to synthetic datasets.
- **The scaling claim is weaker than it reads.** In Fig. 5, the ~175B points are zero-shot and every other point is 15-shot (§4.1, p. 4). Zero-shot GPT-3 also answers in full sentences, which substring matching favors. So the long-tail gap between 20B and GPT-3 mixes model size, prompting regime and output length. "Not projected to move the threshold" (p. 6) has no projection behind it.
- **Adaptive Retrieval's evidence covers less than its framing.** Its input is a relation-type label and a page-view count for a gold-linked subject. POPQA supplies both for free because it is built from Wikidata (§3.3). Natural questions supply neither, as the paper itself notes for NQ (p. 4). The 46.5% therefore shows the best gain from a split that is tuned in-distribution for each relation type, not a deployable classifier. The introduction's line that "we can predict if LMs memorize certain knowledge based on ... the input question only" (p. 2) rests on correlations of at most about 0.4, never on a prediction accuracy.
- **Unused evidence that complicates the story.** The negative correlation for "capital" on EntityQuestions (App. C.1) shows that popularity is not a monotone signal for every relation. Within one relation type, the threshold assumes it is. The 49% of questions where both settings fail (Table 1) puts most remaining errors on the retriever, which the adaptive method does not touch. EntityQuestions has only vanilla and Contriever results for most models (App. C.2), so the cross-dataset check of the retrieval comparison is partial.
- **Asserted rather than measured**: that LMs will rely on stereotypes for minority groups (Ethical Considerations). No experiment covers it.
