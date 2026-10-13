# Questions

- Do Self-RAG's ISSUP tokens agree with an outside detector such as LettuceDetect when both judge the same RAGTruth answers?
- Does SelfCheckGPT still work when every sample sees the same retrieved context, or does the shared context make the samples agree even when the answer is wrong?
- ClashEval shows models taking a wrong document over a correct prior. Could ReDeEP's internal scores tell "followed a wrong document" apart from "ignored a right one"?
- How much of a Ragas faithfulness score comes from the judge model's own knowledge rather than from the context it is given?
- Would ARES's prediction-powered correction work with a small token classifier as the judge instead of a fine-tuned LLM?
- Is retrieving only for long-tail questions (Mallen et al.) still worth it once a model can critique its own retrieval?
