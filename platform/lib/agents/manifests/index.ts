// DOMAIN MANIFESTS — explicit capability ownership per specialist.
//
// Each domain owns a CURATED set of tools. No overlap. The router uses these
// manifests to decide which specialist handles a request. The Guard uses them
// to detect cross-domain leakage (a Work agent talking about payments).
//
// Cross-cutting utilities (lookup_contact, search_history, remember_fact,
// flag_for_clarity, agent_activity) are available to ALL specialists.

export type Domain = "work" | "money" | "people" | "comms" | "knowledge" | "general" | "programs";

export interface DomainManifest {
  domain: Domain;
  model: string;
  tools: string[];
  description: string;
  permission: "admin" | "team" | "both";
}

// WORK — tasks, calendar, scheduling (49% of usage)
export const WORK_MANIFEST: DomainManifest = {
  domain: "work",
  model: "claude-haiku-4-5-20251001",
  tools: [
    "create_task", "complete_task", "reopen_task", "update_task", "delete_task",
    "add_task_comment", "list_task_comments", "link_task_dependency", "list_task_dependencies",
    "query_calendar", "check_conflicts", "create_event", "move_event", "delete_event",
    "complete_calendar_event", "list_tasks", "read_brief", "member_activity",
    "dispatch_meeting_bot",
  ],
  description: "Tasks, reminders, calendar, scheduling. Handles create/complete/update tasks, manage calendar events, check schedules.",
  permission: "both",
};

// MONEY — payments, donations, finance (17% of usage)
export const MONEY_MANIFEST: DomainManifest = {
  domain: "money",
  model: "claude-sonnet-4-6",
  tools: [
    "record_payment", "update_payment", "delete_payment", "schedule_payment", "mark_payment_paid",
    "query_donations", "lookup_donor", "newest_donor", "finance_summary", "latest_gift",
    "list_campaigns", "list_payroll", "list_bank_transactions", "donor_activity",
    "log_payout",
    // restored from orphan sweep (existed in smart-tools, unassigned to any domain)
    "add_donor", "update_donor", "add_campaign", "update_campaign", "set_monthly_goal",
    "log_team_payment", "set_beneficiary_funding",
  ],
  description: "Payments, donations, finance. Handles log payments (staged then confirmed), query donations, view financial summaries. NEVER invent figures.",
  permission: "admin",
};

// PEOPLE — team, contacts, beneficiaries (12% of usage)
export const PEOPLE_MANIFEST: DomainManifest = {
  domain: "people",
  model: "claude-sonnet-4-6",
  tools: [
    "team_detail", "list_team", "add_team_member", "update_team_member",
    "find_beneficiary", "list_beneficiaries", "add_beneficiary", "update_beneficiary",
    "delete_beneficiary", "merge_beneficiary", "approve_case", "decline_case",
    "move_case", "edit_case", "merge_case", "delete_case", "add_contact", "update_contact",
    // restored from orphan sweep
    "activate_member", "set_bot_access", "import_contacts", "merge_contact", "delete_contact",
    "set_public_profile",
  ],
  description: "Team, contacts, beneficiaries. Handles look up contacts, manage team roster, handle beneficiary intake/updates. PII WALL: never share beneficiary funding or pay amounts with team-tier users.",
  permission: "both",
};

// COMMS — outbound messaging (20% of usage)
export const COMMS_MANIFEST: DomainManifest = {
  domain: "comms",
  model: "claude-sonnet-4-6",
  tools: [
    "message_person", "post_to_group", "send_file_to_person", "relay_to_colleague",
    "draft_email", "draft_thank_you", "draft_all_thank_yous", "draft_post",
    "flag_to_nur", "run_group_digest", "show_outbound_audit", "read_contact_thread",
    // restored from orphan sweep: inbound email triage + social + newsletter + drafts + groups
    "read_email", "search_inbox", "inbox_status", "mark_handled",
    "post_to_social", "publish_social_post", "send_newsletter", "show_draft",
    "list_groups", "group_activity", "list_content",
  ],
  description: "Outbound messaging. Handles send messages (gated for approval), draft emails, post to groups. NEVER claim a message was sent unless message_person returned ok=true this turn.",
  permission: "admin",
};

// KNOWLEDGE — documents, memory, grants (8% of usage)
export const KNOWLEDGE_MANIFEST: DomainManifest = {
  domain: "knowledge",
  model: "claude-haiku-4-5-20251001",
  tools: [
    "search_documents", "read_document", "summarize_document", "file_document", "delete_document",
    "list_learned", "edit_brain_section", "query_memory",
    "list_grants", "prepare_grants", "refresh_grants",
    // restored from orphan sweep: grant pipeline writes + studio docs + drive + assets
    "add_grant", "update_grant_status", "pursue_opportunity",
    "find_studio_doc", "transfer_drive_file", "list_assets",
  ],
  description: "Documents, memory, grants. Handles search/file documents, manage Brain facts, handle grant opportunities. Every document claim must reference a real document from search_documents.",
  permission: "both",
};

// GENERAL — fallback for ambiguous requests
export const GENERAL_MANIFEST: DomainManifest = {
  domain: "general",
  model: "claude-haiku-4-5-20251001",
  tools: [
    "lookup_contact", "search_history", "remember_fact", "flag_for_clarity", "agent_activity",
  ],
  description: "Conversation, meta-questions, ambiguous requests. Handles look up contacts, search history, save facts to Brain. Routes to appropriate specialist for domain-specific requests.",
  permission: "both",
};

// PROGRAMS — Maisha inventory + donor wishlist (operator-approved 7th domain)
export const PROGRAMS_MANIFEST: DomainManifest = {
  domain: "programs",
  model: "claude-haiku-4-5-20251001",
  tools: [
    "list_inventory", "add_inventory_item", "update_inventory_item",
    "list_wishlist", "add_wishlist_item", "update_wishlist_item", "fund_wishlist_item",
  ],
  description: "Maisha inventory and donor wishlist. Handles stock items (quantity, Folklore listing) and fundable needs (school kits, beds, fees). Inventory counts and wishlist funding never invent figures.",
  permission: "both",
};

// Cross-cutting utilities available to ALL specialists
export const CROSS_CUTTING_TOOLS = new Set([
  "lookup_contact",
  "search_history",
  "remember_fact",
  "flag_for_clarity",
  "agent_activity",
]);

// All manifests indexed by domain
export const MANIFESTS: Record<Domain, DomainManifest> = {
  work: WORK_MANIFEST,
  money: MONEY_MANIFEST,
  people: PEOPLE_MANIFEST,
  comms: COMMS_MANIFEST,
  knowledge: KNOWLEDGE_MANIFEST,
  general: GENERAL_MANIFEST,
  programs: PROGRAMS_MANIFEST,
};

// Build a reverse index: tool -> domain (for Guard leakage detection)
export const TOOL_TO_DOMAIN: Record<string, Domain> = (() => {
  const map: Record<string, Domain> = {};
  for (const [domain, manifest] of Object.entries(MANIFESTS)) {
    for (const tool of manifest.tools) {
      if (!CROSS_CUTTING_TOOLS.has(tool)) {
        map[tool] = domain as Domain;
      }
    }
  }
  return map;
})();

// Get the tools available to a specialist (domain tools + cross-cutting)
export function getToolsForDomain(domain: Domain, tier: "admin" | "team" = "admin"): string[] {
  const manifest = MANIFESTS[domain];
  if (!manifest) return [];

  // Team tier gets filtered tools
  if (tier === "team") {
    const TEAM_SAFE_TOOLS = new Set([
      "list_tasks", "create_task", "complete_task", "reopen_task", "add_beneficiary",
      "add_inventory_item", "team_detail", "lookup_contact", "list_campaigns",
      "remember_fact", "flag_to_nur", "relay_to_colleague",
      "query_calendar", "check_conflicts", "create_event", "move_event", "delete_event",
      // Cross-cutting
      "search_history", "flag_for_clarity",
    ]);
    return manifest.tools.filter((t) => TEAM_SAFE_TOOLS.has(t) || CROSS_CUTTING_TOOLS.has(t));
  }

  // Admin gets all domain tools + cross-cutting
  return [...manifest.tools, ...Array.from(CROSS_CUTTING_TOOLS)];
}
