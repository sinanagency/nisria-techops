// Pure keyword scorer for the router's fast-lane. Extracted from router.ts so the
// routing logic is testable WITHOUT dragging the model client (../anthropic) and
// the supabase admin chain. The only import is a TYPE (erased at runtime), so this
// module runs under plain node, which is how the eval suite executes.
//
// This is the FAST-LANE only. The live router (router.ts routeMessage) is
// understand-first: the model reads every message; this scorer just lets a
// dead-obvious keyword hit skip the model for cost/latency. A wrong score here
// only costs a model call, never a wrong action.
import type { Domain } from "./manifests";

export const DOMAIN_PATTERNS: { domain: Domain; patterns: RegExp[] }[] = [
  {
    domain: "work",
    patterns: [
      /\bassign\s+(?:this|that|it|the)?\s*(?:task|reminder|to\s+me|to\s+[A-Z][a-z]+)/i, // "assign this task to me: Pay X" -> work, not money
      /\b(?:remind\s+me|set\s+(?:a\s+)?reminder|remind\s+(?:me\s+)?to)\b/i, // "remind me to send X at 2pm" -> work, NOT comms (the "send" is the reminder body, not an outbound)
      /\badd\s+(?:this|a|the)?\s*(?:task|reminder)\b/i,
      /\b(remind|reminder|task|todo|assign|deadline|due\s+(?:on|date|time))\b/i,
      /\b(done\s+with|completed|finished|mark\s+(?:as\s+)?done|reopen)\b/i,
      /\b(open\s+tasks|pending\s+tasks|my\s+tasks|what.*task)\b/i,
      /\b(meeting|calendar|schedule|event|appointment|travel)\b/i,
      /\b(create\s+(?:a\s+)?task|add\s+(?:a\s+)?task|log\s+(?:a\s+)?task)\b/i,
      /\b(check\s+(?:conflicts|calendar)|what'?s\s+(?:on\s+)?(?:this\s+)?(?:week|month|today))\b/i,
    ],
  },
  {
    domain: "money",
    patterns: [
      /\b(paid|payment|kes|usd|ksh|\$)\s*\d/i,
      /\b(salary|rent|mpesa|receipt|invoice|budget)\b/i,
      /\b(log\s+(?:a\s+)?payment|record\s+(?:a\s+)?payment|donation|donor)\b/i,
      /\b(finance|financial|money\s+in|money\s+out|raised|campaign)\b/i,
      /\b(how\s+much|total|balance|payroll|bank\s+(?:statement|transaction))\b/i,
    ],
  },
  {
    domain: "comms",
    patterns: [
      /\b(message|send|tell|notify|ping|whatsapp|text|dm)\b[\s\S]{0,25}\bto\s+[A-Z][a-z]+/i, // "send a message to Violet"
      /\b(send|message|tell|notify|ping)\s+(?:me|them|him|her|[A-Z][a-z]+)\b/i,
      /\bsend\s+(?:a\s+|an\s+)?(?:whatsapp\s+|text\s+)?(?:message|msg|note|reply)\b/i,
      /\b(email|newsletter|thank[\s-]?you|draft)\b/i,
      /\b(post\s+to\s+(?:group|facebook|instagram)|social\s+post|publish\s+(?:the\s+)?post)\b/i,
      /\b(flag\s+to\s+nur|relay\s+to|group\s+digest|reply\s+to|inbox)\b/i,
      /\b(outbound|sent|delivered)\b/i,
    ],
  },
  {
    domain: "people",
    patterns: [
      /\b(beneficiary|child|case|intake|ob\s+number)\b/i,
      /\b(contact\s+details|phone\s+number|reach)\s+(?:for\s+)?(?:me|them|him|her|[A-Z][a-z]+)\b/i,
      /\b(?:phone|mobile|cell)\s*number\b/i, // "phone number" anywhere
      /['’]s\s+(?:phone|number|email|contact|cell|mobile)\b/i, // "Mark's phone/number/email"
      /\b(team\s+member|roster|add\s+(?:a\s+)?(?:team\s+)?member|update\s+(?:team\s+)?member|activate\s+[A-Z])/i,
      /\b(who\s+is|find\s+(?:a\s+)?(?:person|contact|beneficiary)|look\s+up)\b/i,
      /\b(approve|decline|merge)\s+(?:case|beneficiary)\b/i,
    ],
  },
  {
    domain: "programs",
    patterns: [
      /\b(inventory|stock|folklore|maisha)\b/i,
      /\b(wishlist|wish\s+list|needs?\s+funded|fund(?:ed)?\s+(?:the\s+)?(?:school\s+kit|bed|laptop|fees|item))\b/i,
      /\b(school\s+kits?|sewing|fabric|garment)\b/i,
      /\b(add|list|update)\s+(?:an?\s+)?(?:inventory|wishlist)\b/i,
    ],
  },
  {
    domain: "library",
    patterns: [
      /\b(save|keep|bookmark|store)\s+(?:this|the|that)?\s*(?:link|article|resource|video|clip|post|reel|page|url)\b/i,
      /\b(remember|note)\s+(?:this|the|that)?\s*(?:link|article|resource|url)\b/i,
      /\bhttps?:\/\/\S+/i, // a bare URL shared to keep
      /\b(find|get|show|pull up|send)\s+(?:me\s+)?(?:the|that|those)\s+(?:link|article|resource|clip|video|pics?|pictures?|photos?|samples?)\b.*\b(again|earlier|before|we (?:saved|shared))\b/i,
      /\b(my|our|the)\s+(?:saved\s+)?(?:resources|links|bookmarks|reading list)\b/i,
    ],
  },
  {
    domain: "knowledge",
    patterns: [
      /\b(document|file|pdf|upload|attach)\b/i,
      /\b(remember|note\s+that|keep\s+in\s+mind|brain|fact)\b/i,
      /\b(search\s+(?:for\s+)?(?:document|file)|find\s+(?:a\s+)?(?:document|file))\b/i,
      /\b(grant|opportunity|funder|application)\b/i,
      /\b(what\s+(?:did|do)\s+(?:we|you)\s+(?:say|discuss|agree|talk)\s+about)\b/i,
    ],
  },
];

// Score a message against all domain patterns. Returns {domain, score, matches}.
export function scoreDomains(text: string): { domain: Domain; score: number; matches: number }[] {
  const results: { domain: Domain; score: number; matches: number }[] = [];
  for (const { domain, patterns } of DOMAIN_PATTERNS) {
    let score = 0;
    let matches = 0;
    for (const pattern of patterns) {
      const m = text.match(pattern);
      if (m) {
        matches++;
        score += m[0].length * 0.1; // weight by specificity: longer match = more specific
      }
    }
    results.push({ domain, score, matches });
  }
  return results.sort((a, b) => b.score - a.score);
}
