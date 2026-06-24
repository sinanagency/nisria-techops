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
import { sendText } from "./whatsapp";
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

export function registerNisriaTools(server: any) {
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
