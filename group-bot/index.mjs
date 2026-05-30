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
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import pino from "pino";

const PLATFORM_URL = (process.env.PLATFORM_URL || "").replace(/\/$/, "");
const SECRET = process.env.GROUP_BOT_SECRET || "";
const AUTH_DIR = process.env.AUTH_DIR || "./auth";
const ALLOW = (process.env.GROUP_ALLOWLIST || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const log = pino({ level: process.env.LOG_LEVEL || "info" });

if (!PLATFORM_URL || !SECRET) {
  log.error("PLATFORM_URL and GROUP_BOT_SECRET are required");
  process.exit(1);
}

const subjectCache = new Map(); // jid -> group subject
const nameToJid = new Map();    // lowercased group name -> jid (for portal-targeted sends)
const POLL_MS = Number(process.env.OUTBOX_POLL_MS || 4000);
let pollTimer = null;

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

// resolve a portal group name to a WhatsApp jid: exact first, then contains
function resolveJid(name) {
  const n = String(name || "").toLowerCase().trim();
  if (nameToJid.has(n)) return nameToJid.get(n);
  for (const [k, jid] of nameToJid) if (k.includes(n) || n.includes(k)) return jid;
  return null;
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
        try { await sock.sendMessage(jid, { text: s.text }); ok = true; }
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
  const sock = makeWASocket({ version, auth: state, logger: pino({ level: "silent" }), printQRInTerminal: false, markOnlineOnConnect: false });

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
      postLink({ qr: null, connected: true });
      // prime the name->jid map so portal sends can target groups by name
      sock.groupFetchAllParticipating()
        .then((groups) => { for (const g of Object.values(groups || {})) remember(g.id, g.subject); log.info({ groups: nameToJid.size }, "groups primed"); })
        .catch(() => {});
      // start outbox polling (replace any prior timer bound to an old socket)
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(() => pollOutbox(sock), POLL_MS);
    }
    if (connection === "close") {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      log.warn({ code, loggedOut }, "connection closed");
      if (!loggedOut) setTimeout(start, 3000); // reconnect unless the session was revoked
      else log.error("logged out. delete AUTH_DIR and re-scan the QR.");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      try {
        const jid = m.key?.remoteJid || "";
        if (!jid.endsWith("@g.us")) continue;        // groups only (1:1 belongs to the Cloud API number)
        if (m.key?.fromMe) continue;                 // ignore our own posts
        const text = textOf(m);
        if (!text) continue;

        const name = await groupName(sock, jid);
        if (ALLOW.length && !ALLOW.some((a) => name.toLowerCase().includes(a))) continue; // not an allowed group

        const participant = (m.key?.participant || "").split("@")[0]; // sender phone in a group
        if (!participant) continue;

        const { reply } = await ingest({
          group: name,
          sender_phone: participant,
          sender_name: m.pushName || null,
          text,
          message_id: m.key?.id || "",
        });

        if (reply && reply.trim()) {
          await sock.sendMessage(jid, { text: reply.trim() });
          log.info({ group: name }, "replied");
        }
      } catch (e) {
        log.error({ err: e?.message }, "message handler error");
      }
    }
  });
}

start().catch((e) => { log.error({ err: e?.message }, "fatal"); process.exit(1); });
