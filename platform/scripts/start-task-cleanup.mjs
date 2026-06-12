// Kicks off the task-cleanup flow for one contact (Nur, by default).
//
// Run AFTER the worker is deployed with the Layer 0a cleanup router. Without
// the router live, Nur's "yes" reply would fall through to parseTasks and
// the LLM would treat it as a new task instruction.
//
// Usage:
//   node scripts/start-task-cleanup.mjs <contact_id>
//   node scripts/start-task-cleanup.mjs   # defaults to Nur
//
// Loads env from .env.local. Uses the same sendTextAndLog the worker uses
// (so the brand-leak wall runs on the consent message too).

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = join(__dirname, '..')
// Minimal .env.local loader (avoids dotenv dep so the script can run from a
// clean checkout). Quotes / comments not handled — script is operator-run.
for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const NUR_CONTACT_ID = 'c54a0965-a67d-4137-94fb-c47e316db058' // wa_phone: 00971501622716
const contactId = process.argv[2] || NUR_CONTACT_ID

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}
if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
  console.error('Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID')
  process.exit(1)
}

const { createClient } = await import('@supabase/supabase-js')
const ws = (await import('ws')).default
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  realtime: { transport: ws },
})

const { data: contact, error: cErr } = await db
  .from('contacts')
  .select('id, name, phone, channel')
  .eq('id', contactId)
  .single()
if (cErr || !contact) {
  console.error('Contact not found:', cErr?.message)
  process.exit(1)
}
console.log('contact:', contact.name, contact.phone, contact.channel)

if (contact.channel !== 'whatsapp') {
  console.error('Contact is not a whatsapp contact:', contact.channel)
  process.exit(1)
}

// Sanity: no live cleanup already in flight (idempotency)
const { data: existing } = await db
  .from('pending_actions')
  .select('id, status, payload, created_at')
  .eq('contact_id', contactId)
  .eq('kind', 'task_cleanup')
  .in('status', ['awaiting_confirm', 'in_progress'])
  .limit(1)
if (existing && existing.length) {
  console.error('Cleanup already in flight:', existing[0])
  process.exit(2)
}

// In DRY_RUN, preview only — no DB write, no Meta send.
const DRY = process.env.DRY_RUN === '1'

// INLINE the proposeTaskCleanup logic (Node can't import .ts directly without
// a loader; the lib is the source of truth, this is a one-shot bootstrap).
let message, pendingId, total
{
  const { data: tasks } = await db
    .from('tasks')
    .select('id, title, status, created_at')
    .in('status', ['todo', 'in_progress', 'in_review'])
    .order('created_at', { ascending: true })
    .limit(500)
  total = (tasks || []).length
  if (total === 0) { console.error('No open tasks.'); process.exit(0) }
  const totalBatches = Math.ceil(total / 10)
  message = `Your task list has ${total} open items. The oldest go back to late May. Want to walk through them with me to clear what's done and drop what's no longer relevant? I'll send 10 at a time, you tell me what to do with each. Reply "yes" to start, "no" to skip for now.`
  if (DRY) {
    pendingId = '(dry-run, not inserted)'
  } else {
    const payload = { state: 'awaiting_consent', cursor: 0, total, batch_ids: [], stats: { done: 0, dropped: 0, edited: 0, kept: 0 } }
    const { data: ins, error: iErr } = await db
      .from('pending_actions')
      .insert({
        contact_id: contactId,
        kind: 'task_cleanup',
        payload,
        summary: `Task cleanup proposal (${total} open tasks, ${totalBatches} batches).`,
        status: 'awaiting_confirm',
      })
      .select('id')
      .single()
    if (iErr || !ins) { console.error('pending_action insert failed:', iErr?.message); process.exit(1) }
    pendingId = ins.id
  }
}

console.log('\npending_action.id:', pendingId)
console.log('total open tasks:', total)
console.log('\n--- consent message ---')
console.log(message)
console.log('--- end ---\n')

if (DRY) {
  console.log('DRY_RUN=1, not sending, no DB write.')
  process.exit(0)
}

// Send via Meta Graph directly. Mirrors lib/whatsapp.ts:send() shape so the
// outbound + log + wall behavior is identical.
const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
const url = `https://graph.facebook.com/v23.0/${phoneId}/messages`
const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    messaging_product: 'whatsapp',
    to: contact.phone.replace(/^\+/, '').replace(/^00/, ''),
    type: 'text',
    text: { body: message },
  }),
})
const sendBody = await res.text()
if (!res.ok) {
  console.error('Send failed:', res.status, sendBody)
  process.exit(1)
}
console.log('SENT. Meta response:', sendBody.slice(0, 200))

// Log to messages table so the transcript stays complete.
await db.from('messages').insert({
  channel: 'whatsapp',
  direction: 'out',
  body: message,
  status: 'sent',
  handled_by: 'sasa-task-cleanup-bootstrap',
  contact_id: contactId,
})

console.log('\nDone. Awaiting Nur\'s "yes"/"no" reply.')
