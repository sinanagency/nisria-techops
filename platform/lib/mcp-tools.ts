// mcp-tools.ts — the Nisria tool layer for the Claude ↔ Portal MCP bridge.
// Spec 001 / ADR-0013. Registered onto an McpServer by app/api/[transport]/route.ts
// (Nur's interactive Claude) and, in Phase 2, handed to a server-side Claude that
// Sasa invokes on a WhatsApp trigger. ONE tool layer, two consumers.
//
// Every tool wraps a function that already exists in the platform. The bridge
// adds no business logic of its own; it adds an honest, audited surface.
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { admin } from "./supabase-admin";
import { emit } from "./events";
import { sendText, resolveContact } from "./whatsapp";
import { SMART_TOOLS, isReadTool, runSmartTool } from "./smart-tools";
import {
  projectBeneficiary,
  scrubOrFilter,
  claudeDriveFileId,
  okResult,
  sentResult,
  notFoundResult,
  needsTargetResult,
  failedResult,
  validateSaveDocument,
  sendDedupeKey,
  isRecentDuplicate,
  documentDeepLink,
  documentHandoffText,
} from "./mcp-bridge.mjs";

const SEND_DEDUPE_WINDOW_MS = 90_000; // a re-fire inside 90s of the same (to, doc/text) is the same send
const PORTAL_ORIGIN = process.env.PORTAL_ORIGIN || "https://command.nisria.co";

// Recent send events, shaped for the pure dedupe predicate.
async function recentSendEvents(db: any): Promise<{ key: string; atMs: number }[]> {
  const sinceIso = new Date(Date.now() - SEND_DEDUPE_WINDOW_MS).toISOString();
  const { data } = await db
    .from("events")
    .select("payload,created_at")
    .in("type", ["sasa.mcp_document_sent", "sasa.mcp_message_sent"])
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data || [])
    .map((r: any) => ({ key: r?.payload?.dedupe_key, atMs: new Date(r.created_at).getTime() }))
    .filter((e: any) => !!e.key);
}

// ===========================================================================
// FULL-BRIDGE (ADR-0015): the MCP exposes the SAME tool layer Sasa uses
// (SMART_TOOLS + runSmartTool), so Claude.ai and WhatsApp share ONE brain. No
// duplicated business logic; the bridge stays a thin, audited transport.
// Exposure is TIERED for safety, because over MCP the *caller* is the model:
//   READ        -> execute now (Nur holds the OAuth passphrase = her authority)
//   REVERSIBLE  -> execute now (self-contained, undoable writes)
//   STAGE       -> prepared into pending_actions under Nur's contact; she replies
//                  "yes" on WhatsApp to execute (human gate on her own device)
//   (held)      -> deletes/merges/payroll/funding/blasts/outbound sends are NOT
//                  registered yet; no safe replay path. Move a name into a set
//                  below to open it.
// ===========================================================================

// Bespoke tools (below) we keep as-is; skip these names in the SMART_TOOLS loop.
const BRIDGE_BESPOKE = new Set(["read_brain", "search_documents", "get_document", "save_document", "send_whatsapp"]);

// Never expose to an external model surface: get_credential returns DECRYPTED
// vault secrets; a password must never land in a cloud chat transcript.
const BRIDGE_EXCLUDE = new Set(["get_credential"]);

// Reversible, self-contained writes that are safe to execute directly. Names not
// present in SMART_TOOLS are simply never registered (the loop intersects).
const BRIDGE_REVERSIBLE = new Set([
  "create_task", "complete_task", "reopen_task", "update_task", "add_task_comment", "link_task_dependency",
  "create_event", "move_event", "complete_calendar_event",
  "add_contact", "update_contact",
  "add_beneficiary", "update_beneficiary",
  "approve_case", "decline_case", "move_case", "edit_case",
  "remember_fact", "edit_brain_section", "file_document",
  "add_grant", "update_grant_status", "pursue_opportunity", "prepare_grants", "refresh_grants",
  "save_resource", "save_vault_resource", "save_press_item", "tag_press_item", "send_resource",
  "add_inventory_item", "update_inventory_item", "add_wishlist_item", "update_wishlist_item",
  "draft_email", "draft_thank_you", "draft_post", "show_draft", "mark_handled",
  "add_donor", "update_donor", "add_campaign", "update_campaign",
]);

// Sensitive writes that must NOT fire on the model's say-so: prepared and parked
// for Nur's "yes" on WhatsApp. Only kinds the worker can replay belong here.
const BRIDGE_STAGE_TO_WHATSAPP = new Set(["record_payment"]);

// JSON-Schema (the subset SMART_TOOLS uses) -> a Zod raw shape for registerTool.
function jsToZod(schema: any): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") return z.any();
  switch (schema.type) {
    case "string":
      return Array.isArray(schema.enum) && schema.enum.length ? z.enum(schema.enum as [string, ...string[]]) : z.string();
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(schema.items ? jsToZod(schema.items) : z.any());
    case "object":
      return z.object(shapeFrom(schema)).passthrough();
    default:
      return z.any();
  }
}
function shapeFrom(schema: any): Record<string, z.ZodTypeAny> {
  const props = (schema && schema.properties) || {};
  const required: string[] = Array.isArray(schema?.required) ? schema.required : [];
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [k, v] of Object.entries(props)) {
    let zt = jsToZod(v);
    const desc = (v as any)?.description;
    if (desc) zt = zt.describe(String(desc));
    if (!required.includes(k)) zt = zt.optional();
    shape[k] = zt;
  }
  return shape;
}

// Map a runSmartTool result to MCP content: lead with the human summary (if any),
// then the full payload as JSON so Claude has the data. ok===false -> isError.
function smartToolToContent(r: any) {
  const ok = !(r && r.ok === false);
  const parts: string[] = [];
  if (r && typeof r.summary === "string" && r.summary) parts.push(r.summary);
  parts.push("```json\n" + JSON.stringify(r ?? null, null, 2) + "\n```");
  return { content: [{ type: "text" as const, text: parts.join("\n\n") }], isError: !ok };
}

// Nur's contact id, resolved once from NUR_WA_ID, for staging confirmations to her.
let _nurContactId: string | null | undefined;
async function nurContactId(): Promise<string | null> {
  if (_nurContactId !== undefined) return _nurContactId ?? null;
  const wa = (process.env.NUR_WA_ID || "").trim();
  if (!wa) { _nurContactId = null; return null; }
  try { _nurContactId = await resolveContact(admin(), wa); } catch { _nurContactId = null; }
  return _nurContactId ?? null;
}

// Register every allowed SMART_TOOL onto the MCP server, routed through the one brain.
function registerSmartToolBridge(server: any) {
  for (const tool of SMART_TOOLS as readonly any[]) {
    const name: string = tool?.name;
    if (!name || BRIDGE_BESPOKE.has(name) || BRIDGE_EXCLUDE.has(name)) continue;
    const read = isReadTool(name);
    const reversible = BRIDGE_REVERSIBLE.has(name);
    const stage = BRIDGE_STAGE_TO_WHATSAPP.has(name);
    if (!read && !reversible && !stage) continue; // held back

    server.registerTool(
      name,
      { title: name, description: String(tool.description || name), inputSchema: shapeFrom(tool.input_schema) },
      async (input: any) => {
        try {
          const ctx: any = { tier: "admin", rank: "owner", operatorName: "Nur" };
          if (stage) {
            const cid = await nurContactId();
            if (!cid) return failedResult("could not resolve Nur's contact to prepare this for confirmation; set NUR_WA_ID");
            ctx.confirmWrites = true;
            ctx.contactId = cid;
          }
          const r = await runSmartTool(name, input || {}, ctx);
          return smartToolToContent(r);
        } catch (e: any) {
          return failedResult(String(e?.message || e));
        }
      },
    );
  }
}

export function registerNisriaTools(server: any) {
  // Wire the full Sasa tool layer (tiered) onto this server first; the bespoke
  // document/send tools below extend it with MCP-native affordances.
  registerSmartToolBridge(server);

  // 1. read_brain — ground a draft in real portal data (beneficiaries; financials excluded).
  server.registerTool(
    "read_brain",
    {
      title: "Read Nisria brain",
      description:
        "Look up real Nisria context to ground a document: search beneficiaries/cases by name or ref. Returns case facts (needs, story, status). Financial/funding figures are NOT exposed.",
      inputSchema: {
        query: z.string().min(2).describe("a beneficiary name, ref code, or keyword"),
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ query, limit }: { query: string; limit?: number }) => {
      try {
        const db = admin();
        const like = `%${scrubOrFilter(query)}%`;
        const { data, error } = await db
          .from("beneficiaries")
          .select(
            "id,ref_code,full_name,location,category,status,needs,story_private,program,region,guardian_status,intake_date,tags",
          )
          .or(`full_name.ilike.${like},ref_code.ilike.${like},needs.ilike.${like}`)
          .limit(Math.min(limit || 5, 20));
        if (error) return failedResult(`brain query failed: ${error.message}`);
        const rows = (data || []).map(projectBeneficiary);
        await emit({
          type: "sasa.mcp_brain_read",
          source: "mcp:read_brain",
          actor: "claude",
          subject_type: "beneficiary",
          subject_id: null,
          payload: { query: String(query).slice(0, 80), hits: rows.length },
        });
        return okResult({ count: rows.length, beneficiaries: rows });
      } catch (e: any) {
        return failedResult(String(e?.message || e));
      }
    },
  );

  // 2. search_documents — find documents Claude (or anyone) saved before.
  server.registerTool(
    "search_documents",
    {
      title: "Search documents",
      description: "Search the Nisria document store by title or body text. Returns id, title, and a snippet.",
      inputSchema: { query: z.string().min(2).describe("text to match in titles or document bodies") },
    },
    async ({ query }: { query: string }) => {
      try {
        const db = admin();
        const like = `%${scrubOrFilter(query)}%`;
        const { data, error } = await db
          .from("documents")
          .select("id,title,folder,doc_type,extracted_text")
          .or(`title.ilike.${like},extracted_text.ilike.${like}`)
          .limit(8);
        if (error) return failedResult(`search failed: ${error.message}`);
        const needle = String(query).toLowerCase();
        const results = (data || []).map((d: any) => {
          const txt = d.extracted_text || "";
          const i = txt.toLowerCase().indexOf(needle);
          const snippet = i >= 0 ? txt.slice(Math.max(0, i - 50), i + 110).replace(/\s+/g, " ").trim() : "";
          return { id: d.id, title: d.title, folder: d.folder, doc_type: d.doc_type, snippet };
        });
        return okResult({ count: results.length, results });
      } catch (e: any) {
        return failedResult(String(e?.message || e));
      }
    },
  );

  // 3. get_document — pull a document's full text INTO Claude.
  server.registerTool(
    "get_document",
    {
      title: "Get document",
      description: "Read a saved document's full text by id (so Claude can revise or resend it).",
      inputSchema: { id: z.string().describe("the document id from search_documents") },
    },
    async ({ id }: { id: string }) => {
      try {
        const db = admin();
        const { data: doc } = await db
          .from("documents")
          .select("id,title,summary,extracted_text,doc_type,folder,drive_url")
          .eq("id", id)
          .single();
        if (!doc) return notFoundResult(`document ${id}`);
        return okResult({
          id: doc.id,
          title: doc.title,
          summary: doc.summary || null,
          doc_type: doc.doc_type,
          text: doc.extracted_text || "",
        });
      } catch (e: any) {
        return failedResult(String(e?.message || e));
      }
    },
  );

  // 4. save_document — write a Claude-authored document INTO the portal store.
  server.registerTool(
    "save_document",
    {
      title: "Save document",
      description:
        "Save a document Claude authored into the Nisria store so it is searchable and resendable. Optionally tag it with a beneficiary/case id.",
      inputSchema: {
        title: z.string().describe("the document title"),
        content: z.string().describe("the full document body (markdown ok)"),
        doc_type: z.string().optional().describe("e.g. contract, letter, social"),
        beneficiary_id: z.string().optional().describe("link to a beneficiary/case if known"),
        summary: z.string().optional(),
      },
    },
    async (args: { title: string; content: string; doc_type?: string; beneficiary_id?: string; summary?: string }) => {
      const v = validateSaveDocument(args);
      if (!v.ok) return needsTargetResult(v.field, v.hint);
      try {
        const db = admin();
        const driveFileId = claudeDriveFileId(randomUUID());
        const row: Record<string, any> = {
          drive_file_id: driveFileId,
          title: v.title,
          extracted_text: v.content,
          doc_type: args.doc_type || "claude",
          folder: "Claude",
          source: "claude",
          summary: args.summary || null,
        };
        const { data, error } = await db.from("documents").insert(row).select("id,title").single();
        if (error) return failedResult(`save failed: ${error.message}`);
        await emit({
          type: "sasa.mcp_document_saved",
          source: "mcp:save_document",
          actor: "claude",
          subject_type: "document",
          subject_id: data.id,
          payload: { title: v.title, doc_type: row.doc_type, beneficiary_id: args.beneficiary_id || null },
        });
        return okResult({ id: data.id, title: data.title, saved: true });
      } catch (e: any) {
        return failedResult(String(e?.message || e));
      }
    },
  );

  // 5. send_whatsapp — deliver a document (as a portal deep-link) or a message to WhatsApp.
  server.registerTool(
    "send_whatsapp",
    {
      title: "Send to WhatsApp",
      description:
        "Send a saved document (as a link to open in the portal) or a text message to a WhatsApp number. Defaults to Nur if no recipient is given.",
      inputSchema: {
        document_id: z.string().optional().describe("a saved document id to hand off"),
        text: z.string().optional().describe("a plain message to send (used when no document_id)"),
        to: z.string().optional().describe("recipient E.164/wa_id; defaults to Nur"),
      },
    },
    async ({ document_id, text, to }: { document_id?: string; text?: string; to?: string }) => {
      const recipient = (to || process.env.NUR_WA_ID || "").trim();
      if (!recipient) return needsTargetResult("to", "a recipient WhatsApp number (or set NUR_WA_ID)");
      if (!document_id && !(text && text.trim())) return needsTargetResult("document_id|text", "either a document_id or a text body");
      try {
        const db = admin();
        const key = sendDedupeKey(recipient, document_id, text);
        if (isRecentDuplicate(await recentSendEvents(db), key, SEND_DEDUPE_WINDOW_MS, Date.now())) {
          return okResult({ deduped: true, dedupe_key: key, note: "identical send within the last 90s; not resent" });
        }

        let body: string;
        let docMeta: { id: string; title: string } | null = null;
        if (document_id) {
          const { data: doc } = await db.from("documents").select("id,title").eq("id", document_id).single();
          if (!doc) return notFoundResult(`document ${document_id}`);
          docMeta = { id: doc.id, title: doc.title || "document" };
          body = documentHandoffText(docMeta.title, documentDeepLink(PORTAL_ORIGIN, doc.id));
        } else {
          body = String(text);
        }

        const res = await sendText(recipient, body);
        if (!res.id) {
          await emit({
            type: "sasa.mcp_send_failed",
            source: "mcp:send_whatsapp",
            actor: "claude",
            subject_type: "contact",
            subject_id: null,
            payload: { to_last4: recipient.slice(-4), document_id: document_id || null, error: String(res.error || "").slice(0, 200) },
          });
          return failedResult(`whatsapp send failed: ${res.error || "unknown"}`, { to_last4: recipient.slice(-4) });
        }
        // Honesty (Law 11): the underlying seam may fall back to a re-engagement
        // TEMPLATE when the recipient is outside the 24h window. The content still
        // lands, but it is framed as a template, not the literal body we composed.
        // Report that explicitly rather than claiming a plain delivery.
        const viaReengage = !!(res as any).viaReengage;
        await emit({
          type: docMeta ? "sasa.mcp_document_sent" : "sasa.mcp_message_sent",
          source: "mcp:send_whatsapp",
          actor: "claude",
          subject_type: "contact",
          subject_id: null,
          payload: { to_last4: recipient.slice(-4), document_id: document_id || null, dedupe_key: key, message_id: res.id, via_reengage: viaReengage },
        });
        return sentResult({
          to_last4: recipient.slice(-4),
          document_id: document_id || null,
          message_id: res.id,
          ...(viaReengage ? { delivery: "reengage_template", note: "recipient was outside the 24h window; content delivered inside a re-engagement template, not as a plain message" } : {}),
        });
      } catch (e: any) {
        return failedResult(String(e?.message || e));
      }
    },
  );
}
