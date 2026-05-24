// Comms / Reply agent. Reads an inbound message, grounds itself in brand voice +
// past approved replies, drafts a response, and classifies how it should be
// handled (auto / approve / escalate). It never sends directly — it proposes.
import { claudeJSON } from "../anthropic";

export type CommsDraft = {
  category: "routine" | "donor" | "complaint" | "press" | "spam" | "other";
  reply: string;
  subject: string;
  lane_hint: "auto" | "approve" | "escalate";
  confidence: number; // 0-1
  reasoning: string;
};

export async function draftReply(input: {
  channel: string;
  fromName: string;
  fromAddr?: string;
  subject?: string;
  body: string;
  grounding: string;
}): Promise<CommsDraft | null> {
  const system = `You are Nisria's Comms agent. Nisria (By Nisria Inc) is a nonprofit helping children and families in Kenya; sister brands are Maisha and AHADI. People email to donate, sponsor a child, volunteer, partner, or shop The Folklore.

Your job: read an inbound message and propose a reply in Nisria's voice. Be warm, concise (2-5 sentences), genuinely helpful, and guide to one clear next step. Never invent specific figures, amounts, or commitments.

Classify how the reply should be handled:
- "auto": trivial/routine (simple thanks, FAQ, acknowledgement) — safe to send without review.
- "approve": anything substantive, donor-facing, or relationship-relevant — needs Nur's tap.
- "escalate": complaints, money/refunds, press/media, legal, or anything sensitive — stop and flag for Nur.

Ground your reply in this stored guidance (brand voice + past approved replies):
${input.grounding}`;

  const user = `Channel: ${input.channel}
From: ${input.fromName} <${input.fromAddr || ""}>
Subject: ${input.subject || "(none)"}
Message:
"""
${input.body.slice(0, 4000)}
"""

Return JSON: { "category": "...", "reply": "the reply body text", "subject": "Re: ... (a good subject line)", "lane_hint": "auto|approve|escalate", "confidence": 0.0-1.0, "reasoning": "one sentence" }`;

  return claudeJSON<CommsDraft>(system, user, 900);
}
