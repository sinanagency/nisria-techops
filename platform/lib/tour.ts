// Sasa's onboarding script. Sasa MEETS Nur, walks her ACROSS the real platform
// explaining what matters, then asks her for the information the system still
// needs. This is the content; the experience lives in components/SasaTour.tsx.
//
// LIVING DOCUMENT: keep in step with the platform until handover. New surface
// worth showing -> add a stop. New thing Sasa should collect -> add to INTAKE
// (or it is already covered by the Brain story sections, which INTAKE reads).

export type TourStop = {
  route: string; // the real page Sasa navigates to while she talks
  here: string; // short "where we are" label shown on the ribbon
  say: string; // what Sasa says, in her voice (no em-dashes, warm, first person)
};

// The walk. Ordered. Sasa navigates to each real page as she speaks.
export const TOUR_STOPS: TourStop[] = [
  {
    route: "/",
    here: "Home, your cockpit",
    say: "This is home, your cockpit. Every morning it shows you the few things that need you, where the money stands, and what changed while you were away. If you only look at one screen a day, this is it.",
  },
  {
    route: "/inbox",
    here: "Inbox, every message",
    say: "Your inbox. WhatsApp and email, donors and guardians and funders, all in one place. I draft replies in your voice and hold them for you to approve before anything sends.",
  },
  {
    route: "/donors",
    here: "Donors, the people who give",
    say: "These are your donors, with their full giving history. I already brought in everyone from Givebutter, so the people behind the numbers are here waiting for you to thank them.",
  },
  {
    route: "/finance",
    here: "Finance, the money out",
    say: "Finance is the money going out, read from your monthly sheets. I keep Kenyan shillings and dollars apart so the spend always tells the truth, never a blurred-together number.",
  },
  {
    route: "/beneficiaries",
    here: "Beneficiaries, the children",
    say: "The heart of the work. The children and the alumni, with their stories and consent kept private by default. Nothing here reaches a donor unless consent says it can.",
  },
  {
    route: "/grants",
    here: "Grants, funding to chase",
    say: "I hunt for real grant funding that fits Nisria and rank it here. When you mark one worth pursuing, I draft the application for you instead of starting from a blank page.",
  },
  {
    route: "/content",
    here: "Content and story",
    say: "Content is where we tell the story. Draft a post or let me write one, and it queues for Instagram and Facebook. Your photos and documents live next door in the Library, and the Newsletter writes itself from what has been happening.",
  },
  {
    route: "/team",
    here: "Team and the bots",
    say: "Your team and their roles, and the two WhatsApp bots that are now live and answering. I route work to the right person and keep everyone moving without you chasing them.",
  },
  {
    route: "/smart",
    here: "Smart, talk to me",
    say: "And this is me. Talk or type here any time, drop a file and I will sort it, ask me to do something and I will. You can always reach me from the button at the bottom of any screen too.",
  },
];

// The questions Sasa asks at the END, after the walk. These map to the Brain's
// story sections (lib/brain.ts), so every answer grounds everything I draft.
// `recommended` ones are the high-leverage few; the rest are skippable.
export type IntakeQuestion = {
  section: string; // SectionKey -> saveBrainSection
  ask: string; // Sasa's question, conversational
  placeholder: string;
  recommended: boolean;
};

export const INTAKE: IntakeQuestion[] = [
  {
    section: "overview",
    ask: "Before I can write as Nisria, tell me who you are in your own words. Who is Nisria, and why does it exist?",
    placeholder: "By Nisria Inc is a US nonprofit helping children and families in Kenya. We exist because...",
    recommended: true,
  },
  {
    section: "programs",
    ask: "What do you actually do on the ground? Walk me through your programs, the Safe House, education, rescue, nutrition, whatever they are.",
    placeholder: "Safe House: shelters children who... Education: covers school fees for... Nutrition: daily meals for...",
    recommended: true,
  },
  {
    section: "voice",
    ask: "Last important one. How should I sound when I write for you? Your tone, the words you use, and the ones you never use.",
    placeholder: "Warm and hopeful, never guilt-trippy. We say 'children and families', not 'victims'. No jargon.",
    recommended: true,
  },
  {
    section: "people",
    ask: "Who are the key people I should know? Your board, major donors, partners, the people who matter to the story.",
    placeholder: "Nur (founder). Board: ... Major donors: ... Field lead in Nairobi: ...",
    recommended: false,
  },
  {
    section: "events",
    ask: "Any milestones I should remember? The moments that shaped Nisria, big or small.",
    placeholder: "2021: opened the Safe House. 2023: first 30 children sponsored.",
    recommended: false,
  },
  {
    section: "assets",
    ask: "What do you hold or rely on? Property, recurring funders, partnerships.",
    placeholder: "We own the Safe House land in... Recurring funders: ... Partnership with...",
    recommended: false,
  },
];

export const TOUR_VERSION = "2026-05-30";
