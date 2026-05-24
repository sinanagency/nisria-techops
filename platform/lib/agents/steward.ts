// Donor Steward agent. Writes a warm, personal thank-you for a recent gift,
// grounded in brand voice. Proposes only — the gateway gates the send.
import { claudeJSON } from "../anthropic";

export type ThankYou = { subject: string; body: string };

export async function draftThankYou(input: { name: string; amount: string; recurring: boolean; grounding: string }): Promise<ThankYou | null> {
  const system = `You are Nisria's Donor Steward. Write a short, sincere, personal thank-you to a donor (2-4 sentences) in Nisria's voice. Warm, specific, never generic or guilt-trippy. Mention in general terms what their support makes possible (do NOT invent figures). If the gift is recurring/monthly, acknowledge the ongoing commitment. End simply.

Brand voice + examples to match:
${input.grounding}`;
  const user = `Donor: ${input.name}
Gift: ${input.amount}${input.recurring ? " (monthly/recurring)" : " (one-time)"}

Return JSON: { "subject": "a warm subject line", "body": "the thank-you body" }`;
  return claudeJSON<ThankYou>(system, user, 500);
}
