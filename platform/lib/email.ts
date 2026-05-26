import nodemailer from "nodemailer";
import { admin } from "./supabase-admin";
import { getLogo, logoImgTag } from "./logos";
import { stripDashes } from "./humanize";

// Sends from the org Gmail mailbox via SMTP (app password). Server-only env.
//
// R2-5 (#43, #44): the connector now
//   1. picks a BRANDED signature by the SENDING ACCOUNT (sasa@ -> Nisria,
//      maisha@ -> Maisha) and auto-appends it, and
//   2. accepts real ATTACHMENTS (a Studio document, a grant-ready doc, or a
//      Library asset) fetched server-side from the private `assets` bucket.
//
// SMTP is a single Gmail box (SMTP_USER). The "account" is the LOGICAL sending
// identity: it selects the From display name + which signature to append. We
// keep this server-side; the Gmail app password never leaves the server.

export type SendAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export type SendOpts = {
  // logical sending account (e.g. "sasa@nisria.co" | "maisha@nisria.co").
  // Picks the From display name + the signature. Defaults to the org mailbox.
  account?: string | null;
  attachments?: SendAttachment[];
};

const BRAND_FROM: Record<string, string> = {
  "sasa@nisria.co": "By Nisria Inc",
  "maisha@nisria.co": "Maisha",
};

// Fetch the editable signature for a sending account. Falls back to a minimal
// text signature if the row or column is empty, so a send never breaks on a
// missing signature.
async function signatureFor(account?: string | null): Promise<{ fromName: string; signatureHtml: string }> {
  const acct = (account || "").trim().toLowerCase();
  let fromName = BRAND_FROM[acct] || "By Nisria Inc";
  let signatureHtml = "";
  let brand = acct === "maisha@nisria.co" ? "maisha" : "nisria";
  if (acct) {
    try {
      const { data } = await admin()
        .from("email_accounts")
        .select("label,brand,signature_html")
        .eq("address", acct)
        .maybeSingle();
      if (data) {
        if (data.signature_html) signatureHtml = String(data.signature_html);
        if (data.label) fromName = String(data.label) === "Nisria" ? "By Nisria Inc" : String(data.label);
        if (data.brand) brand = String(data.brand);
      }
    } catch {
      // best-effort: a lookup failure must not block the send
    }
  }
  if (!signatureHtml) {
    const tag = acct === "maisha@nisria.co" ? "Maisha · a By Nisria Inc initiative" : "By Nisria Inc · helping children and families in Kenya";
    signatureHtml = `<div style="margin-top:18px;border-top:1px solid #e3e5e8;padding-top:12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#667;font-size:12px;line-height:1.5"><strong style="color:#15171a">${tag}</strong><br/>${acct || "sasa@nisria.co"} · nisria.co</div>`;
  }
  // P8: prepend the brand logo (data URI, renders in any inbox) so every send is
  // branded. Best-effort: a missing logo simply leaves the wordmark signature.
  try {
    const logo = await getLogo(brand);
    const tag = logoImgTag(logo, { height: 40, alt: fromName });
    if (tag) signatureHtml = `<div style="margin-top:18px">${tag}</div>${signatureHtml}`;
  } catch {}
  return { fromName, signatureHtml };
}

// Turn the plain-text body Nur typed into safe HTML (escaped, newlines -> <br>)
// so the same string renders cleanly above the HTML signature block.
function bodyToHtml(text: string): string {
  const esc = String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc.replace(/\r?\n/g, "<br/>");
}

export async function sendEmail(to: string, subject: string, text: string, opts: SendOpts = {}) {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) throw new Error("SMTP not configured");

  // THE send chokepoint: no email ever leaves with an em/en dash, no matter which
  // path queued it (a pre-gate draft, a compact-card approve that sends the stored
  // proposal, or an edited reply). Dash-only so a legitimate bracket like a
  // funder's "[STP 10th Cohort]" subject tag is preserved.
  subject = stripDashes(subject);
  text = stripDashes(text);

  const { fromName, signatureHtml } = await signatureFor(opts.account);

  const t = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  // HTML email = body + branded signature. A plain-text alternative (without the
  // signature markup) keeps non-HTML clients readable.
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#2a2d31">${bodyToHtml(text)}${signatureHtml}</div>`;

  await t.sendMail({
    from: `${fromName} <${user}>`,
    to,
    subject,
    text,
    html,
    attachments: (opts.attachments || []).map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  });
}
