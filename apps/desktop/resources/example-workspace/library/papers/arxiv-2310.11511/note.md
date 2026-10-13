Adaptive retrieval is what I came for: the model decides when to retrieve instead of always pulling the top k passages.

The critique tokens (ISREL, ISSUP, ISUSE) act like a built-in groundedness check, but they are learned from GPT-4 labels through a critic, so they are only as good as that critic.

Gains are clearest on PopQA and on ASQA citation precision, with 7B and 13B Llama 2.

Open question: does ISSUP catch the same unsupported claims a separate detector (SelfCheckGPT, LettuceDetect) would, or does the model learn to grade itself too kindly?