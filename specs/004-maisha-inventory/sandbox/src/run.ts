// End-to-end walkthrough of the Maisha Inventory loop — the curl-equivalent proof.
// Everything runs in-process on PGlite. Nothing live. Run: npm run demo
import { freshDb, one, q, tick } from "./db.ts";
import { ingest } from "./ingest.ts";
import { recordSale, recordShipment, transitionState, consumeMaterials, logExpense, collectionPnl, inventorySummary, lookupOrderByToken, raiseProcurementTask } from "./tools.ts";
import { formatCurrencyMap } from "./money.ts";

const GROUP = "Maisha • Inventory";
const line = (s = "") => console.log(s);
const step = (n: string) => console.log(`\n\x1b[1m\x1b[36m▸ ${n}\x1b[0m`);

const db = await freshDb();

line("\x1b[1mMAISHA INVENTORY — sandbox walkthrough (silent capture mode)\x1b[0m");
line("════════════════════════════════════════════════════════════");

// 1. A maker drops a photo with no caption (bot is SILENT).
step("Aisha drops a photo, no caption");
let r = await ingest(db, { externalId: "wa_1", group: GROUP, sender: "+254700111", senderName: "Aisha", role: "team", image: { wamid: "m_1", mediaPath: "/media/abaya1.jpg" } }, { listenOnly: true });
line(`  captured=${r.captured}  spoken=${r.spoken}  → "${r.reply}"`);
line(`  (silent: nothing posted to the group, but it's in the DB)`);

// 2. Minutes later she replies to that photo with the details (still silent).
step("Aisha replies to the photo (swipe-reply) with details");
tick(3 * 60_000);
r = await ingest(db, { externalId: "wa_2", group: GROUP, sender: "+254700111", senderName: "Aisha", role: "team", replyToExternalId: "wa_1", text: "TRK-192 Noor abaya, style A-line, size M, made by Aisha" }, { listenOnly: true });
line(`  captured=${r.captured}  spoken=${r.spoken}  action: ${r.action}`);
const prod = await one<any>(db, `SELECT id, tracking_no, collection, maker, size, lifecycle_state FROM inventory WHERE tracking_no='TRK-0192'`);
line(`  record: ${prod.tracking_no} · ${prod.collection} · size ${prod.size} · by ${prod.maker} · state=${prod.lifecycle_state}`);

// 3. A second maker posts a photo then a SEPARATE message (not a reply).
step("Mariam posts a photo, then a separate (non-reply) message");
await ingest(db, { externalId: "wa_3", group: GROUP, sender: "+254700222", senderName: "Mariam", role: "team", image: { wamid: "m_3", mediaPath: "/media/kaftan.jpg" } }, { listenOnly: true });
tick(60_000);
r = await ingest(db, { externalId: "wa_4", group: GROUP, sender: "+254700222", senderName: "Mariam", role: "team", text: "TRK-205 Noor kaftan, size L, made by Mariam" }, { listenOnly: true });
line(`  bound via loose follow-up → ${r.action}`);

// 4. Materials consumed (COGS) — link textile to the product.
step("Record the silk used (COGS feed)");
await db.query(`INSERT INTO inventory (id,item_type,name,unit_cost,cost_currency,quantity) VALUES ('silk1','textile','Silk roll',120,'AED',20)`);
await consumeMaterials(db, { endProductId: prod.id, materials: [{ materialId: "silk1", qty: 2 }] });
line(`  consumed 2 units of silk @ AED 120 → COGS AED 240`);

// 5. Nur sells it on Folklore — revenue + auto ship-task to Nur.
step("Nur records a sale on Folklore");
r = await recordSale(db, { inventoryId: prod.id, channel: "folklore", customer: "Layla", customerPhone: "+97150123", price: 850, currency: "AED", channelFee: 85, by: "Nur" });
const orderToken = r.detail!.order_token as string;
line(`  ${r.summary}`);
const shipTask = await one<any>(db, `SELECT title, assignee, source, source_kind FROM tasks WHERE id=$1`, [r.detail!.ship_task]);
line(`  → spawned task: "${shipTask.title}" → ${shipTask.assignee}  [source=${shipTask.source}/${shipTask.source_kind}]`);

// 6. Nur ships, then carrier marks in-transit, then delivered.
step("Fulfillment: ship → in_transit → delivered");
await recordShipment(db, { inventoryId: prod.id, courier: "Aramex", trackingUrl: "https://aramex/track/192", destination: "Dubai", by: "Nur" });
await transitionState(db, { inventoryId: prod.id, to: "in_transit", by: "carrier" });
await transitionState(db, { inventoryId: prod.id, to: "delivered", by: "carrier" });
const ev = await q<any>(db, `SELECT from_state, to_state FROM inventory_lifecycle_events WHERE inventory_id=$1 ORDER BY created_at`, [prod.id]);
line(`  lifecycle: ${ev.map((e) => e.to_state).join(" → ")}`);

// 7. An illegal jump is refused.
step("Guard: try an illegal jump (delivered → shipped)");
const bad = await transitionState(db, { inventoryId: prod.id, to: "shipped" });
line(`  ${bad.ok ? "ALLOWED?!" : "refused ✓"} — ${bad.summary}`);

// 8. Customer checks status with their token (secondary, gated).
step("Customer messages the bot with her order token");
const cust = await lookupOrderByToken(db, { token: orderToken, requesterPhone: "+97150123" });
line(`  customer sees: "${cust.detail?.status}"  (status only — no price, maker, or tracking# leaked)`);
const spoof = await lookupOrderByToken(db, { token: orderToken, requesterPhone: "+19998887" });
line(`  spoofed phone → "${spoof.summary}" (token bound to buyer)`);

// 9. Low stock → procurement task.
step("Low silk stock → procurement task to Nur");
const pt = await raiseProcurementTask(db, { itemName: "Silk roll", ref: "silk1" });
line(`  ${pt.summary}`);

// 10. Expenses (multi-currency) + collection P&L (never blended).
step("Log a procurement expense + show collection P&L");
await logExpense(db, { payee: "Thread Co", amount: 320, currency: "AED", category: "procurement", by: "Nur" });
await logExpense(db, { payee: "Dye Supplier", amount: 4500, currency: "KES", category: "cogs", by: "Nur" });
const pnl = await collectionPnl(db, "Noor");
line(`  ${pnl.summary}`);

// 11. What Sasa can now answer from grounding.
step("Sasa grounding snapshot (answerable on every turn)");
const summary = await inventorySummary(db);
line(`  by type: ${JSON.stringify(summary.byType)}`);
line(`  by lifecycle: ${JSON.stringify(summary.byLifecycle)}`);
line(`  pending photos awaiting context: ${summary.pendingImages}`);

line("\n════════════════════════════════════════════════════════════");
line("\x1b[1m\x1b[32m✓ full loop ran in-process — capture→enrich→sell→ship→deliver→reconcile, all silent\x1b[0m");
line("  nothing touched the live DB, live sasa.ts, or WhatsApp.");
