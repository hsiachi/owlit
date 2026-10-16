import type { Chat } from "@owlit/protocol"
import { docs, papers } from "./sources"

const day = 24 * 60 * 60 * 1000
const now = Date.now()

// A few seeded conversations so the list panel and history have something to show
export const seedChats: Chat[] = [
  {
    id: "seed-1",
    title: "Summarize the Transformer paper",
    createdAt: now - 2 * 60 * 60 * 1000,
    updatedAt: now - 2 * 60 * 60 * 1000,
    pinned: true,
    connectorId: "claude-code",
    modelId: "claude-sonnet-5-5",
    role: "assistant",
    messages: [
      {
        id: "m1",
        role: "user",
        createdAt: now - 2 * 60 * 60 * 1000,
        mentions: [papers[0]],
        parts: [{ type: "text", text: "Summarize @[Attention Is All You Need] in three bullet points." }],
      },
      {
        id: "m2",
        role: "assistant",
        createdAt: now - 2 * 60 * 60 * 1000 + 5000,
        status: "done",
        connectorId: "claude-code",
        modelId: "claude-sonnet-5-5",
        parts: [
          {
            type: "tool_call",
            toolCallId: "t1",
            title: "Reading Attention Is All You Need",
            kind: "read",
            status: "completed",
            locations: [{ path: "library/papers/attention-is-all-you-need/digest.md" }],
          },
          {
            type: "text",
            text: "- **Self-attention replaces recurrence.** The Transformer models token dependencies with multi-head attention alone, allowing full parallelism during training.\n- **Encoder–decoder with positional encodings.** Sinusoidal position signals give the model order information without recurrence.\n- **State of the art at lower cost.** It reached 28.4 BLEU on WMT14 En–De with far less training compute than prior models.",
          },
        ],
      },
    ],
  },
  {
    id: "seed-2",
    title: "Draft the related work section",
    createdAt: now - 1 * day,
    updatedAt: now - 1 * day,
    pinned: false,
    connectorId: "claude-code",
    modelId: "claude-opus-5-5",
    role: "coauthor",
    messages: [
      {
        id: "m3",
        role: "user",
        createdAt: now - 1 * day,
        mentions: [docs[1]],
        parts: [{ type: "text", text: "Draft a related-work paragraph on RAG for @[proposal-draft.md]." }],
      },
    ],
  },
  {
    id: "seed-3",
    title: "Compare RLHF and instruction tuning",
    createdAt: now - 4 * day,
    updatedAt: now - 4 * day,
    pinned: false,
    messages: [],
  },
  {
    id: "seed-4",
    title: "Reading log cleanup",
    createdAt: now - 20 * day,
    updatedAt: now - 20 * day,
    pinned: false,
    messages: [],
  },
]
