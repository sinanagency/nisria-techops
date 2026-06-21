// Nisria WhatsApp GROUP userbot. A thin transport, not a brain.
//
// It links a dedicated WhatsApp number (QR scan, once), sits in the team groups,
// and for every group message: forwards {group, sender, text} to the platform's
// /api/group/ingest (the ONE brain, runSasa group mode), which stores it, updates
// the portal, and decides whether to reply. Any reply text returned is posted
// back to the group. No brain logic lives here on purpose, so this box stays
// replaceable and the brain stays single-sourced.
//
// Env:
//   PLATFORM_URL      e.g. https://command.nisria.co
//   GROUP_BOT_SECRET  shared secret, must match the platform env
//   AUTH_DIR          where the WhatsApp session persists (Railway volume, e.g. /data/auth)
//   GROUP_ALLOWLIST   optional comma-separated group-name substrings; empty = all groups
//   PROXY_URL         optional. route the WhatsApp session through a sticky
//                     residential/mobile proxy so the linked-device login does not
//                     originate from a datacenter IP (the main ban signal). Accepts
//                     socks5://user:pass@host:port or http(s)://user:pass@host:port.
//                     Empty = direct connection (current behaviour, nothing changes).
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } from "@whiskeysockets/baileys";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import pino from "pino";

const PLATFORM_URL = (process.env.PLATFORM_URL || "").replace(/\/$/, "");
const SECRET = process.env.GROUP_BOT_SECRET || "";
const AUTH_DIR = process.env.AUTH_DIR || "./auth";
const ALLOW = (process.env.GROUP_ALLOWLIST || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const log = pino({ level: process.env.LOG_LEVEL || "info" });

// Proxy agent (dormant unless PROXY_URL is set). socks* uses SocksProxyAgent,
// anything else (http/https) uses HttpsProxyAgent. Applied to both the WhatsApp
// socket and Baileys media fetches so all traffic shares one residential exit.
const PROXY_URL = process.env.PROXY_URL || "";
function makeProxyAgent(url) {
  if (!url) return undefined;
  try {
    return /^socks/i.test(url) ? new SocksProxyAgent(url) : new HttpsProxyAgent(url);
  } catch (e) {
    log.error({ err: e?.message }, "invalid PROXY_URL, falling back to direct connection");
    return undefined;
  }
}
const proxyAgent = makeProxyAgent(PROXY_URL);

if (!PLATFORM_URL || !SECRET) {
  log.error("PLATFORM_URL and GROUP_BOT_SECRET are required");
  process.exit(1);
}

const subjectCache = new Map(); // jid -> group subject
const nameToJid = new Map();    // lowercased group name -> jid (for portal-targeted sends)
const POLL_MS = Number(process.env.OUTBOX_POLL_MS || 4000);
let pollTimer = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Human-paced, rate-limited send. WhatsApp flags numbers that fire instant,
// back-to-back, machine-cadence messages, so every outbound goes through here:
// a minimum gap between sends (jittered), a "typing" presence, and a short
// compose delay scaled to the message length. Sparse + human is the whole
// anti-ban posture on the behavioural side; the proxy covers the network side.
const MIN_SEND_GAP_MS = Number(process.env.MIN_SEND_GAP_MS || 2500);
let lastSendAt = 0;
async function humanSend(sock, jid, content) {
  const now = Date.now();
  const gap = MIN_SEND_GAP_MS - (now - lastSendAt);
  if (gap > 0) await sleep(gap + Math.floor(Math.random() * 1200));
  const text = content?.text || "";
  try {
    await sock.sendPresenceUpdate("composing", jid);
    await sleep(Math.min(4000, 700 + text.length * 25) + Math.floor(Math.random() * 800));
  } catch {}
  try { await sock.sendMessage(jid, content); }
  finally {
    lastSendAt = Date.now();
    try { await sock.sendPresenceUpdate("paused", jid); } catch {}
  }
}

function textOf(m) {
  const mm = m.message || {};
  return (
    mm.conversation ||
    mm.extendedTextMessage?.text ||
    mm.imageMessage?.caption ||
    mm.videoMessage?.caption ||
    mm.documentMessage?.caption ||
    ""
  ).trim();
}

// The contextInfo of whatever message subtype this is. Carries quoted replies
// and @mentions, which is how a team signals "done on THIS" or "this is for X".
function contextOf(m) {
  const mm = m.message || {};
  return mm.extendedTextMessage?.contextInfo || mm.imageMessage?.contextInfo || mm.videoMessage?.contextInfo || mm.documentMessage?.contextInfo || null;
}
// The text of the message a reply is quoting (so a bare "done" reply still tells
// the brain WHAT was done).
function quotedTextOf(ctx) {
  const q = ctx?.quotedMessage;
  if (!q) return "";
  return (q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || q.videoMessage?.caption || q.documentMessage?.caption || "").trim();
}
// Reactions the team uses to mean "done / approved": check, thumbs-up, 100,
// raised hands, OK hand, party. Anything else (or an empty text = un-react) is
// not a completion signal.
const DONE_EMOJI = /[✅✔\u{1F44D}\u{1F4AF}\u{1F64C}\u{1F44C}\u{1F389}]/u;

function remember(jid, subject) {
  subjectCache.set(jid, subject || jid);
  if (subject) nameToJid.set(subject.toLowerCase(), jid);
}

async function groupName(sock, jid) {
  if (subjectCache.has(jid)) return subjectCache.get(jid);
  try {
    const meta = await sock.groupMetadata(jid);
    remember(jid, meta.subject || jid);
    return meta.subject || jid;
  } catch {
    return jid;
  }
}

// push the current link state to the portal so Nur can scan a live QR from
// command.nisria.co/groups without anyone babysitting a terminal
async function postLink(state) {
  try {
    await fetch(`${PLATFORM_URL}/api/group/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-group-secret": SECRET },
      body: JSON.stringify({ ...state, ts: new Date().toISOString() }),
    });
  } catch (e) { log.warn({ err: e?.message }, "postLink failed"); }
}

// publish each WhatsApp group's real identity (subject + avatar + size) AND the real
// membership (the groups this number is actually in) to the portal. The portal uses
// it for proper group icons + the true subject, and for list_groups + Sasa truth
// (never message-history-only or a guess). Avatars come from sock.profilePictureUrl,
// best-effort per group, never throwing the loop. Primes the name->jid map too.
async function postGroups(sock) {
  try {
    const all = await sock.groupFetchAllParticipating();
    const groups = [];
    for (const g of Object.values(all || {})) {
      remember(g.id, g.subject);
      let avatar = null;
      try { avatar = await sock.profilePictureUrl(g.id, "image"); } catch { /* no avatar / private */ }
      groups.push({
        name: g.subject,
        subject: g.subject,
        jid: g.id,
        avatar_url: avatar,
        participant_count: Array.isArray(g.participants) ? g.participants.length : (g.size || null),
      });
    }
    if (!groups.length) return;
    await fetch(`${PLATFORM_URL}/api/group/membership`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-group-secret": SECRET },
      body: JSON.stringify({ groups, ts: new Date().toISOString() }),
    });
    log.info({ groups: groups.length }, "group identity + membership published");
  } catch (e) { log.warn({ err: e?.message }, "postGroups failed"); }
}

// resolve a portal group name to a WhatsApp jid: EXACT subject match only. The old
// fuzzy "contains" fallback could resolve a name to the WRONG group, deliver there,
// and still ack ok, so the portal marked a post delivered when it never landed in the
// named group. With exact-only, an unrecognised name returns null, the send is acked
// ok:false ("unknown group"), and the portal tells Nur, instead of misrouting silently.
function resolveJid(name) {
  const n = String(name || "").toLowerCase().trim();
  return nameToJid.has(n) ? nameToJid.get(n) : null;
}

// poll the portal outbox, deliver queued sends into their groups, ack each
async function pollOutbox(sock) {
  try {
    const r = await fetch(`${PLATFORM_URL}/api/group/outbox`, { headers: { "x-group-secret": SECRET } });
    if (!r.ok) return;
    const { sends } = await r.json();
    for (const s of sends || []) {
      const jid = resolveJid(s.group);
      let ok = false, error = "";
      if (!jid) { error = `unknown group "${s.group}"`; }
      else {
        try { await humanSend(sock, jid, { text: s.text }); ok = true; }
        catch (e) { error = e?.message || "send failed"; }
      }
      await fetch(`${PLATFORM_URL}/api/group/outbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-group-secret": SECRET },
        body: JSON.stringify({ id: s.id, ok, error }),
      });
      if (ok) log.info({ group: s.group }, "delivered from outbox");
      else log.warn({ group: s.group, error }, "outbox send failed");
    }
  } catch (e) {
    log.error({ err: e?.message }, "pollOutbox error");
  }
}

async function ingest(payload) {
  try {
    const r = await fetch(`${PLATFORM_URL}/api/group/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-group-secret": SECRET },
      body: JSON.stringify(payload),
    });
    if (!r.ok) { log.warn({ status: r.status }, "ingest non-200"); return { reply: "" }; }
    return await r.json();
  } catch (e) {
    log.error({ err: e?.message }, "ingest failed");
    return { reply: "" };
  }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  log.info({ proxy: proxyAgent ? "on" : "direct" }, "starting WhatsApp socket");
  const sock = makeWASocket({
    version, auth: state, logger: pino({ level: "silent" }),
    printQRInTerminal: false, markOnlineOnConnect: false,
    agent: proxyAgent, fetchAgent: proxyAgent,
  });

  sock.ev.on("creds.update", saveCreds);

  // Pairing-code link (alternative to QR): if PAIR_NUMBER is set and we are not yet
  // registered, ask WhatsApp for an 8-char code that Nur types into the dedicated
  // phone via Linked Devices -> Link with phone number. More robust than a QR image
  // (no expiring photo to send around). The session still persists to AUTH_DIR.
  const PAIR_NUMBER = (process.env.PAIR_NUMBER || "").replace(/[^0-9]/g, "");
  if (PAIR_NUMBER && !sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(PAIR_NUMBER);
        const pretty = code?.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
        log.info("PAIRING CODE (bot phone -> Linked Devices -> Link with phone number): " + pretty);
        postLink({ qr: null, pairingCode: pretty, connected: false });
      } catch (e) { log.error({ err: e?.message }, "requestPairingCode failed"); }
    }, 3000);
  }

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      log.info("Scan this QR with the Nisria GROUP WhatsApp number (Linked Devices):");
      qrcode.generate(qr, { small: true });
      // also push it to the portal so Nur can scan a live QR from /groups
      QRCode.toDataURL(qr, { width: 320, margin: 1 })
        .then((dataUrl) => postLink({ qr: dataUrl, connected: false }))
        .catch((e) => log.warn({ err: e?.message }, "qr dataurl failed"));
    }
    if (connection === "open") {
      log.info("connected. listening to team groups.");
      postLink({ qr: null, connected: true, status: "connected" });
      // prime the name->jid map AND publish real group identity (subject + avatar)
      // + membership to the portal: proper group icons and list_groups/Sasa truth.
      // postGroups remembers as it goes and sends the rich objects the endpoint reads.
      postGroups(sock).catch(() => {});
      // start outbox polling (replace any prior timer bound to an old socket)
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(() => pollOutbox(sock), POLL_MS);
    }
    if (connection === "close") {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut; // 401, session revoked
      const banned = code === 403;                            // forbidden, number flagged
      // status the platform uses to alert Nur on the 727 (down-transition only)
      const status = banned ? "banned" : loggedOut ? "logged_out" : "waiting";
      postLink({ qr: null, connected: false, status });
      log.warn({ code, loggedOut, banned }, "connection closed");
      if (loggedOut || banned) {
        // terminal: the session will not come back on its own. The platform has
        // alerted Nur; an operator must re-link a (new) number to AUTH_DIR.
        log.error("session ended (logged out or banned). delete AUTH_DIR and re-link.");
      } else {
        // benign drop: reconnect with a jittered backoff (avoid a tight loop)
        setTimeout(start, 3000 + Math.floor(Math.random() * 2500));
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      try {
        const jid = m.key?.remoteJid || "";
        if (!jid.endsWith("@g.us")) continue;        // groups only (1:1 belongs to the Cloud API number)
        if (m.key?.fromMe) continue;                 // ignore our own posts

        const name = await groupName(sock, jid);
        if (ALLOW.length && !ALLOW.some((a) => name.toLowerCase().includes(a))) continue; // not an allowed group

        const participant = (m.key?.participant || "").split("@")[0]; // sender phone in a group
        if (!participant) continue;

        // REACTION as a completion signal. A check / thumbs-up on a message is how
        // the team marks something done without typing. Ship the emoji + the id of
        // the message it targets; the platform looks that message up and lets the
        // brain tick the matching task. An empty reaction text is an un-react, skip.
        const reaction = m.message?.reactionMessage;
        if (reaction) {
          const emoji = (reaction.text || "").trim();
          const targetId = reaction.key?.id || "";
          if (emoji && targetId && DONE_EMOJI.test(emoji)) {
            await ingest({
              group: name,
              sender_phone: participant,
              sender_name: m.pushName || null,
              reaction_emoji: emoji,
              reaction_target_id: targetId,
              message_id: m.key?.id || "",
            });
          }
          continue; // a reaction is never also text or media
        }

        const text = textOf(m);
        // quoted reply + @mentions: precise context so "done" hits the right task
        // and an assignment lands on the right person.
        const mctx = contextOf(m);
        const quoted_text = quotedTextOf(mctx);
        // S9: the EXACT id of the message this reply quotes (Baileys puts it on
        // contextInfo.stanzaId). Forwarded so the platform can anchor a swipe-"done"
        // to the real logged message by external_id, not a fuzzy text copy. Mirrors
        // the reaction_target_id plumbing already shipped above.
        const quoted_id = mctx?.stanzaId ? String(mctx.stanzaId) : "";
        const mentioned_phones = (mctx?.mentionedJid || []).map((j) => String(j).split("@")[0]).filter(Boolean);

        // SHARED LINK: a URL posted in the group. WhatsApp already resolved a
        // preview (title/description/canonicalUrl) on the message, so we capture
        // that for free, no fetching, no "I can't open it". The platform stores it
        // as an attributed link on the person's timeline. The forwarded flag biases
        // FYI vs action. We do not ship the binary thumbnail (keeps the payload light).
        const et = m.message?.extendedTextMessage;
        const urlInText = (text.match(/https?:\/\/[^\s]+/i) || [])[0] || "";
        const linkUrl = (et?.canonicalUrl || et?.matchedText || urlInText || "").trim();
        const link = linkUrl ? {
          url: linkUrl,
          title: (et?.title || "").trim(),
          description: (et?.description || "").trim(),
          forwarded: !!(mctx?.isForwarded || mctx?.forwardingScore),
        } : null;

        // VOICE NOTE: no text but an audio message. Download it here and let the
        // platform transcribe (the OpenAI key lives there; the bot stays a thin
        // transport that never holds a secret). Cap the size so a long clip can't
        // blow up the JSON payload. Anything we can't grab is skipped, not faked.
        let audio_base64 = "", audio_mime = "";
        if (!text && m.message?.audioMessage) {
          try {
            const buf = await downloadMediaMessage(m, "buffer", {}, { logger: log, reuploadRequest: sock.updateMediaMessage });
            if (buf?.length && buf.length < 8 * 1024 * 1024) {
              audio_base64 = buf.toString("base64");
              audio_mime = m.message.audioMessage.mimetype || "audio/ogg";
            }
          } catch (e) { log.warn({ err: e?.message }, "voice note download failed"); }
        }
        // MEDIA: an image or document dropped in the group. Download the bytes and
        // ship them to the platform's ingest pipeline (the bot stays a thin
        // transport, the platform stores + classifies + files). Cap the size so a
        // big file can't blow up the JSON payload. A caption rides along as `text`.
        let media_base64 = "", media_mime = "", media_name = "";
        const im = m.message?.imageMessage, doc = m.message?.documentMessage;
        if (im || doc) {
          try {
            const buf = await downloadMediaMessage(m, "buffer", {}, { logger: log, reuploadRequest: sock.updateMediaMessage });
            if (buf?.length && buf.length <= 15 * 1024 * 1024) {
              media_base64 = buf.toString("base64");
              media_mime = im?.mimetype || doc?.mimetype || "application/octet-stream";
              media_name = doc?.fileName || im?.caption || "";
            }
          } catch (e) { log.warn({ err: e?.message }, "media download failed"); }
        }
        if (!text && !audio_base64 && !media_base64) continue;

        const { reply } = await ingest({
          group: name,
          sender_phone: participant,
          sender_name: m.pushName || null,
          text,
          audio_base64,
          audio_mime,
          media_base64,
          media_mime,
          media_name,
          quoted_text,
          quoted_id,
          mentioned_phones,
          link,
          message_id: m.key?.id || "",
        });

        if (reply && reply.trim()) {
          await humanSend(sock, jid, { text: reply.trim() });
          log.info({ group: name }, "replied");
        }
      } catch (e) {
        log.error({ err: e?.message }, "message handler error");
      }
    }
  });
}

process.on("SIGTERM", () => {
  log.info("SIGTERM received, shutting down");
  if (pollTimer) clearInterval(pollTimer);
  sock?.end();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("\nSIGINT received, shutting down");
  if (pollTimer) clearInterval(pollTimer);
  sock?.end();
  process.exit(0);
});

start().catch((e) => { log.error({ err: e?.message }, "fatal"); process.exit(1); });
