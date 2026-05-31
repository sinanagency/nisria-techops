// The single source for the in-app Guide (/guide).
//
// LIVING DOCUMENT. This file is kept in lockstep with the platform until Nur
// receives her login. When a surface is added, renamed, or an onboarding step
// changes, update it here. The narrative (map + objectives) lives here; the
// done/pending STATUS is computed live from Supabase in app/guide/page.tsx so it
// can never go stale or claim something is finished that is not. (Honesty law.)

export type Owner = "you" | "sasa" | "taona";

export const OWNER_LABEL: Record<Owner, string> = {
  you: "You do this",
  sasa: "Sasa does this",
  taona: "Taona is wiring this",
};

// ---- THE MAP: every surface, grouped by Nur's five pillars ------------------

export type MapItem = {
  label: string;
  href: string;
  what: string; // plain-language "what this is"
  objective: string; // why it exists / what it is for
};

export type Pillar = {
  key: string;
  title: string;
  blurb: string;
  items: MapItem[];
};

export const PILLARS: Pillar[] = [
  {
    key: "command",
    title: "Your cockpit",
    blurb: "Where you start every day and where you talk to Sasa.",
    items: [
      { label: "Home", href: "/", what: "Your morning briefing: what needs you, the money picture, what changed.", objective: "One screen to know where the organisation stands without digging." },
      { label: "Smart", href: "/smart", what: "Talk or type to Sasa. Drop a file and she routes it.", objective: "Run the org by conversation. Ask, and the work gets done or drafted." },
      { label: "Inbox", href: "/inbox", what: "Every message, WhatsApp and email, in one place.", objective: "Never lose a donor, guardian, or funder message across channels." },
      { label: "Launchpad", href: "/launchpad", what: "A grid of every app in the platform.", objective: "Find any surface fast when you do not remember where it lives." },
    ],
  },
  {
    key: "fundraising",
    title: "Fundraising and donors",
    blurb: "The money that keeps the Safe House running, and the people behind it.",
    items: [
      { label: "Donors", href: "/donors", what: "Every donor with their lifetime giving and history.", objective: "Know who gives, so you can thank them and keep them close." },
      { label: "Donations", href: "/donations", what: "Every gift that has come in, filterable.", objective: "See the flow of giving, gift by gift, in real numbers." },
      { label: "Campaigns", href: "/campaigns", what: "Your fundraising campaigns and their progress.", objective: "Track each appeal against its goal." },
      { label: "Grants", href: "/grants", what: "Live grant opportunities plus the ones you are pursuing.", objective: "Turn matched funding into applications without starting from blank." },
    ],
  },
  {
    key: "data",
    title: "Programs and records",
    blurb: "The children, the money out, the documents, the compliance.",
    items: [
      { label: "Beneficiaries", href: "/beneficiaries", what: "The children and alumni, with consent-gated profiles.", objective: "The heart of the work. Private by default, donor-grade when consented." },
      { label: "Finance", href: "/finance", what: "Money out: expenses and obligations, KES and USD kept apart.", objective: "See real spend against funding, never mixing currencies." },
      { label: "Reports", href: "/reports", what: "Filed reports, classified and searchable.", objective: "Every report findable when a funder asks." },
      { label: "Legal & Compliance", href: "/legal", what: "Entity facts, obligations, and the document register.", objective: "Keep both entities in good standing, nothing slips." },
      { label: "Inventory", href: "/inventory", what: "Stock, and listing tools for The Folklore.", objective: "Know what you hold and turn it into listings." },
    ],
  },
  {
    key: "content",
    title: "Content and outreach",
    blurb: "Telling the story and reaching new supporters.",
    items: [
      { label: "Content", href: "/content", what: "Draft and queue posts for Instagram and Facebook.", objective: "Keep the brands visible without living inside the apps." },
      { label: "Outreach", href: "/outreach", what: "Send a newsletter or email blast to donors and contacts.", objective: "Bring supporters along with the work in their inbox." },
      { label: "Library", href: "/library", what: "Photos and documents, captioned and searchable.", objective: "One home for the assets the work produces." },
      { label: "Document Studio", href: "/studio", what: "Generate grant docs and letters with Sasa.", objective: "Produce funder-ready documents from what the system already knows." },
    ],
  },
  {
    key: "people",
    title: "People and the brain",
    blurb: "Your team, your bots, and what Sasa knows about the organisation.",
    items: [
      { label: "Team", href: "/team", what: "The roster, roles, and who is on the bot.", objective: "Know who does what, and route work to them." },
      { label: "Groups", href: "/groups", what: "WhatsApp group intelligence.", objective: "Keep team group chatter feeding the one brain." },
      { label: "Agents", href: "/agents", what: "The AI fleet and the autonomy dials.", objective: "Decide how much Sasa does on her own versus asking you first." },
      { label: "Settings", href: "/settings", what: "The Brain, accounts, integrations, signature, goal.", objective: "Teach Sasa about Nisria and connect the outside tools." },
    ],
  },
];

// ---- THE SEQUENCE: ordered onboarding, status computed live ------------------
//
// Each step's `check` is interpreted in app/guide/page.tsx against live data.
// `you` = Nur populates it · `sasa` = the AI maintains it · `taona` = external
// wiring Taona is handling. `target` (optional) gives a "done when N" threshold;
// otherwise any count > 0 counts as done.

export type CheckKey =
  | "brain"
  | "team"
  | "donors"
  | "beneficiaries"
  | "finance"
  | "grants"
  | "library"
  | "email_accounts"
  | "content_channels"
  | "whatsapp"
  | "signature";

export type Step = {
  n: number;
  title: string;
  why: string;
  owner: Owner;
  href: string;
  check: CheckKey;
  target?: number;
};

export const SEQUENCE: Step[] = [
  {
    n: 1,
    title: "Teach Sasa about Nisria (the Brain)",
    why: "Everything Sasa drafts, from thank-yous to grant letters, is grounded in what she knows about the mission, voice, and rules. This is the highest-leverage thing you do.",
    owner: "you",
    href: "/settings",
    check: "brain",
  },
  {
    n: 2,
    title: "Confirm your team roster",
    why: "Sasa routes tasks to real people and lets the right team members use the WhatsApp bot. Check names, roles, and phone numbers are right.",
    owner: "you",
    href: "/team",
    check: "team",
  },
  {
    n: 3,
    title: "Set your email signature",
    why: "Every reply and newsletter Sasa sends signs off as you. Set it once so outgoing mail looks right.",
    owner: "you",
    href: "/settings",
    check: "signature",
  },
  {
    n: 4,
    title: "Review the donors Sasa already imported",
    why: "Givebutter giving is synced in. Skim the list so the people behind the numbers feel familiar before you start stewarding them.",
    owner: "sasa",
    href: "/donors",
    check: "donors",
  },
  {
    n: 5,
    title: "Review the beneficiary profiles",
    why: "The children and alumni were extracted from your Drive. Check the records and consent flags so private stays private.",
    owner: "sasa",
    href: "/beneficiaries",
    check: "beneficiaries",
  },
  {
    n: 6,
    title: "Confirm the finance picture",
    why: "Expenses were read from your monthly sheets. Confirm the spend looks right so the money-out numbers can be trusted.",
    owner: "you",
    href: "/finance",
    check: "finance",
  },
  {
    n: 7,
    title: "Look at the grant opportunities",
    why: "The grant hunter found real matched funding. Mark the ones worth pursuing and Sasa drafts the application.",
    owner: "sasa",
    href: "/grants",
    check: "grants",
  },
  {
    n: 8,
    title: "Check the email accounts are connected",
    why: "The Inbox needs your mailboxes connected so messages land here and replies send as you.",
    owner: "taona",
    href: "/settings",
    check: "email_accounts",
  },
  {
    n: 9,
    title: "Connect the social channels",
    why: "Once Instagram and Facebook are linked, Content posts go out from here instead of inside each app.",
    owner: "taona",
    href: "/content",
    check: "content_channels",
  },
  {
    n: 10,
    title: "Bring WhatsApp fully online",
    why: "The bot already sends and receives. The last piece is a permanent token so it never expires. Taona is closing this out.",
    owner: "taona",
    href: "/groups",
    check: "whatsapp",
  },
];

// ---- WHAT IS STILL BEING BUILT ----------------------------------------------
// Honest "coming next" so changes between now and handover do not confuse her.
// Keep this list current as items ship (move them out when done).

export const COMING_NEXT: string[] = [
  "Live two-way social posting once the Instagram and Facebook channels finish verification.",
  "A permanent WhatsApp connection so the bot never needs re-authorising.",
  "Semantic search across the Brain so Sasa recalls by meaning, not just keywords.",
  "Google Drive import directly inside the Library.",
  "More of Sasa's specialist agents (content, fundraising, field) coming online.",
];

export const GUIDE_VERSION = "2026-05-29";
