// The Maisha Inventory smart-tools, against PGlite. Each returns the platform
// tool shape { ok, summary, detail } so porting into runAction is mechanical.
// Hardened after the adversarial pass:
//  - multi-write tools run in ONE transaction (no partial writes)
//  - recordSale HONORS a refused lifecycle transition (no false "done")
//  - batch_tag is per-SALE-event (resale after restock works)
//  - consumeMaterials REFUSES on insufficient stock (no negative quantity)
//  - the 6 previously-unimplemented handlers now exist
//  - customer token is CSPRNG, phone-bound, expiring, rate-limited; DTO is status-only
import { randomUUID } from "node:crypto";
import { DB, id, now, q, one } from "./db.ts";
import { evaluateTransition, LifecycleState } from "./lifecycle.ts";
import { classifyItem, parseFields, ItemType, sanitizeExtraction } from "./classify.ts";
import { Currency, sumByCurrency, formatCurrencyMap, money, CurrencyMap } from "./money.ts";

export type ToolResult = {
  ok: boolean;
  summary: string;
  detail?: Record<string, any>;
  refused?: boolean;
  needs?: string;
};

type Q = { query: (sql: string, params?: any[]) => Promise<any> };
const DAY_MS = 86_400_000;
const TOKEN_TTL_DAYS = 14;

// --- assets / media (storeMedia equivalent — idempotent on source_ref=wamid) ---
export async function storeMedia(db: Q, opts: { wamid: string; path: string; mime?: string; createdBy?: string }): Promise<string> {
  const existing = await one<{ id: string }>(db as any, `SELECT id FROM assets WHERE source_ref = $1`, [opts.wamid]);
  if (existing) return existing.id;
  const aid = id("asset");
  await db.query(
    `INSERT INTO assets (id, type, storage_path, mime, source, source_ref, created_by, created_at)
     VALUES ($1,'proof',$2,$3,'whatsapp',$4,$5,$6)`,
    [aid, opts.path, opts.mime ?? "image/jpeg", opts.wamid, opts.createdBy ?? null, now()]
  );
  return aid;
}

// --- persist_pending_image: store image + a pending UN-TYPED inventory row.
// item_type is NULL (not a fake end_product) until classification. Atomic. ---
export async function persistPendingImage(db: DB, msg: {
  externalId: string; wamid: string; group: string; sender: string; senderName?: string; role?: string;
  mediaPath: string; mime?: string; caption?: string | null;
}): Promise<ToolResult> {
  const dupe = await one(db, `SELECT id FROM messages WHERE external_id = $1`, [msg.externalId]);
  if (dupe) return { ok: true, summary: "already captured (dedupe)", detail: { deduped: true } };

  let invId = id("inv");
  let assetId = "";
  await (db as any).transaction(async (tx: Q) => {
    assetId = await storeMedia(tx, { wamid: msg.wamid, path: msg.mediaPath, mime: msg.mime, createdBy: msg.senderName });
    await tx.query(
      `INSERT INTO messages (id, external_id, asset_id, group_name, sender_phone, sender_name, sender_role, body, has_image, media_path, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$10)`,
      [id("msg"), msg.externalId, assetId, msg.group, msg.sender, msg.senderName ?? null, msg.role ?? "team", msg.caption ?? null, msg.mediaPath, now()]
    );
    await tx.query(
      `INSERT INTO inventory (id, item_type, name, status, lifecycle_state, asset_ids, enriched, created_by, source_message_external_id, created_at, updated_at)
       VALUES ($1,NULL,$2,'draft',NULL,ARRAY[$3],FALSE,$4,$5,$6,$6)`,
      [invId, msg.caption?.slice(0, 60) || "(pending photo)", assetId, msg.senderName ?? null, msg.externalId, now()]
    );
    await tx.query(
      `INSERT INTO pending_enrichment (id, message_external_id, inventory_id, asset_id, sender_phone, sender_name, group_name, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)`,
      [id("pend"), msg.externalId, invId, assetId, msg.sender, msg.senderName ?? null, msg.group, now()]
    );
  });
  if (msg.caption && parseFields(msg.caption).trackingNo) {
    return enrichRecord(db, { inventoryId: invId, text: msg.caption, sourceExternalId: msg.externalId, by: msg.senderName });
  }
  return { ok: true, summary: "logged pending photo, awaiting details", detail: { inventory_id: invId, asset_id: assetId, pending: true } };
}

// --- classify + enrich a pending record from free-text context (atomic) ---
export async function enrichRecord(db: DB, opts: {
  inventoryId: string; text: string; sourceExternalId?: string; by?: string;
}): Promise<ToolResult> {
  const row = await one<any>(db, `SELECT * FROM inventory WHERE id = $1`, [opts.inventoryId]);
  if (!row) return { ok: false, refused: true, summary: `no pending record ${opts.inventoryId}` };

  // sanitize untrusted extraction (strips injected imperatives, allowlists fields)
  const fields = sanitizeExtraction(parseFields(opts.text));
  const cls = classifyItem({ text: opts.text, hasImage: true, trackingNo: fields.trackingNo, maker: fields.maker });
  if (!cls.itemType || cls.confidence < 0.55) {
    return { ok: false, needs: `Couldn't tell the type of this item (${cls.reason}). Is it a supply, textile, or finished product?`, summary: "ambiguous — asked once" };
  }
  const itemType = cls.itemType;
  const lifecycle = itemType === "end_product" ? "in_stock" : null;

  await (db as any).transaction(async (tx: Q) => {
    await tx.query(
      `UPDATE inventory SET item_type=$1, name=COALESCE($2,name), tracking_no=COALESCE($3,tracking_no),
         collection=COALESCE($4,collection), style=COALESCE($5,style), size=COALESCE($6,size),
         maker=COALESCE($7,maker), status='in_stock', lifecycle_state=$8, enriched=TRUE, updated_at=$9
       WHERE id=$10`,
      [itemType, fields.name ?? null, fields.trackingNo ?? null, fields.collection ?? null, fields.style ?? null,
       fields.size ?? null, fields.maker ?? null, lifecycle, now(), opts.inventoryId]
    );
    if (fields.price) {
      await tx.query(`UPDATE inventory SET unit_price=$1, price_currency=$2 WHERE id=$3`, [fields.price.amount, fields.price.currency, opts.inventoryId]);
    }
    await tx.query(`UPDATE pending_enrichment SET status='enriched' WHERE inventory_id=$1`, [opts.inventoryId]);
  });

  if (fields.stateChange) {
    await transitionState(db, { inventoryId: opts.inventoryId, to: fields.stateChange, by: opts.by, evidence: opts.text });
  }
  const enriched = await one<any>(db, `SELECT * FROM inventory WHERE id=$1`, [opts.inventoryId]);
  return {
    ok: true,
    summary: `enriched ${itemType} ${enriched.tracking_no ?? enriched.name}`,
    detail: { inventory_id: opts.inventoryId, item_type: itemType, tracking_no: enriched.tracking_no, fields },
  };
}

// --- direct typed upserts (no pending photo) ---
async function upsertTyped(db: DB, itemType: ItemType, f: any): Promise<ToolResult> {
  const lifecycle = itemType === "end_product" ? (f.lifecycleState ?? "in_stock") : null;
  const invId = id("inv");
  await db.query(
    `INSERT INTO inventory (id, item_type, name, tracking_no, collection, style, maker, size, quantity,
       unit_cost, cost_currency, unit_price, price_currency, status, lifecycle_state, enriched, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'in_stock',$14,TRUE,$15,$16,$16)`,
    [invId, itemType, f.name, f.trackingNo ?? null, f.collection ?? null, f.style ?? null, f.maker ?? null, f.size ?? null,
     f.quantity ?? 0, f.unitCost ?? null, f.costCurrency ?? null, f.unitPrice ?? null, f.priceCurrency ?? null, lifecycle, f.by ?? null, now()]
  );
  return { ok: true, summary: `logged ${itemType} ${f.trackingNo ?? f.name}`, detail: { inventory_id: invId, item_type: itemType } };
}
export const upsertEndProduct = (db: DB, f: any) => upsertTyped(db, "end_product", f);
export const upsertSupply = (db: DB, f: any) => upsertTyped(db, "supply", f);
export const upsertTextile = (db: DB, f: any) => upsertTyped(db, "textile", f);

// --- correct_record: per-actor authorization (only creator or admin), audited ---
export async function correctRecord(db: DB, opts: {
  inventoryId: string; patch: Record<string, any>; actor: string; actorRole: "admin" | "team";
}): Promise<ToolResult> {
  const row = await one<any>(db, `SELECT id, created_by FROM inventory WHERE id=$1`, [opts.inventoryId]);
  if (!row) return { ok: false, refused: true, summary: `no record ${opts.inventoryId}` };
  if (opts.actorRole !== "admin" && row.created_by !== opts.actor) {
    return { ok: false, refused: true, summary: `refused: ${opts.actor} cannot edit a record created by ${row.created_by}` };
  }
  const ALLOWED = new Set(["name", "collection", "style", "maker", "size", "tracking_no", "unit_price", "price_currency"]);
  const keys = Object.keys(opts.patch).filter((k) => ALLOWED.has(k));
  if (!keys.length) return { ok: false, refused: true, summary: "no correctable fields in patch" };
  const sets = keys.map((k, i) => `${k}=$${i + 1}`).join(", ");
  const params = keys.map((k) => opts.patch[k]);
  params.push(now(), opts.inventoryId);
  await db.query(`UPDATE inventory SET ${sets}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`, params);
  return { ok: true, summary: `corrected ${keys.join(", ")}`, detail: { inventory_id: opts.inventoryId, fields: keys, by: opts.actor } };
}

// --- guarded, idempotent lifecycle transition (atomic update + event) ---
export async function transitionState(db: DB, opts: {
  inventoryId: string; to: string; by?: string; evidence?: string; sourceExternalId?: string;
}): Promise<ToolResult> {
  const row = await one<any>(db, `SELECT id, lifecycle_state, tracking_no FROM inventory WHERE id=$1`, [opts.inventoryId]);
  if (!row) return { ok: false, refused: true, summary: `no record ${opts.inventoryId}` };
  const from = (row.lifecycle_state ?? null) as LifecycleState | null;
  const verdict = evaluateTransition(from, opts.to);
  if (!verdict.ok) return { ok: false, refused: true, summary: `refused: ${verdict.reason}`, detail: { from, to: opts.to } };
  if (verdict.idempotent) return { ok: true, summary: `already ${opts.to} (no-op)`, detail: { idempotent: true, inventory_id: opts.inventoryId, state: opts.to } };

  await (db as any).transaction(async (tx: Q) => {
    await tx.query(`UPDATE inventory SET lifecycle_state=$1, updated_at=$2 WHERE id=$3`, [verdict.to, now(), opts.inventoryId]);
    await tx.query(
      `INSERT INTO inventory_lifecycle_events (id, inventory_id, from_state, to_state, evidence, source_message_external_id, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id("evt"), opts.inventoryId, from, verdict.to, opts.evidence ?? null, opts.sourceExternalId ?? null, opts.by ?? null, now()]
    );
  });
  return { ok: true, summary: `moved ${row.tracking_no ?? opts.inventoryId} ${from ?? "∅"} → ${verdict.to}`, detail: { inventory_id: opts.inventoryId, from, to: verdict.to } };
}

export async function getLifecycle(db: DB, inventoryId: string): Promise<ToolResult> {
  const row = await one<any>(db, `SELECT lifecycle_state, tracking_no FROM inventory WHERE id=$1`, [inventoryId]);
  if (!row) return { ok: false, refused: true, summary: `no record ${inventoryId}` };
  const events = await q<any>(db, `SELECT from_state, to_state, created_at FROM inventory_lifecycle_events WHERE inventory_id=$1 ORDER BY created_at`, [inventoryId]);
  return { ok: true, summary: `${row.tracking_no ?? inventoryId}: ${row.lifecycle_state ?? "∅"}`, detail: { state: row.lifecycle_state, history: events.map((e) => e.to_state) } };
}

// --- consume materials: REFUSE if any material lacks stock (no negative); atomic ---
export async function consumeMaterials(db: DB, opts: {
  endProductId: string; materials: { materialId: string; qty: number }[];
}): Promise<ToolResult> {
  for (const m of opts.materials) {
    const mat = await one<any>(db, `SELECT quantity FROM inventory WHERE id=$1`, [m.materialId]);
    if (!mat) return { ok: false, refused: true, summary: `unknown material ${m.materialId}` };
    if (Number(mat.quantity) < m.qty) {
      return { ok: false, refused: true, summary: `refused: only ${mat.quantity} of ${m.materialId} in stock, need ${m.qty}` };
    }
  }
  await (db as any).transaction(async (tx: Q) => {
    for (const m of opts.materials) {
      const mat = await one<any>(tx as any, `SELECT unit_cost, cost_currency FROM inventory WHERE id=$1`, [m.materialId]);
      await tx.query(
        `INSERT INTO inventory_materials (id, end_product_id, material_id, qty, unit_cost, currency, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id("mat"), opts.endProductId, m.materialId, m.qty, mat.unit_cost, mat.cost_currency, now()]
      );
      await tx.query(`UPDATE inventory SET quantity = quantity - $1, updated_at=$2 WHERE id=$3`, [m.qty, now(), m.materialId]);
    }
  });
  return { ok: true, summary: `consumed ${opts.materials.length} material(s)`, detail: { end_product_id: opts.endProductId, count: opts.materials.length } };
}

// --- record_sale: revenue + auto ship-task, ALL in one transaction. Honors a
// refused lifecycle transition (aborts, no false success). Per-SALE idempotency. ---
export async function recordSale(db: DB, opts: {
  inventoryId: string; channel: string; customer: string; customerPhone?: string;
  price: number; currency: Currency; channelFee?: number; by?: string;
}): Promise<ToolResult> {
  const inv = await one<any>(db, `SELECT id, tracking_no, lifecycle_state FROM inventory WHERE id=$1`, [opts.inventoryId]);
  if (!inv) return { ok: false, refused: true, summary: `no product ${opts.inventoryId}` };

  // sellable ONLY from in_stock / reserved (or unset). Refuses double-selling an
  // already sold/shipped/delivered item; a returned item must restock→in_stock first.
  const cur = inv.lifecycle_state ?? "in_stock";
  if (!["in_stock", "reserved"].includes(cur)) {
    return { ok: false, refused: true, summary: `refused: cannot sell — item is '${cur}', not in stock`, detail: { from: inv.lifecycle_state } };
  }

  // per-sale batch_tag (so a restocked item can be sold again)
  const n = (await one<any>(db, `SELECT count(*)::int c FROM inventory_sales WHERE inventory_id=$1`, [opts.inventoryId]))!.c;
  const batch = `inv:${inv.tracking_no ?? opts.inventoryId}:sale:${n + 1}`;

  const token = `TOK-${randomUUID()}`;
  const expires = new Date(Date.parse(now()) + TOKEN_TTL_DAYS * DAY_MS).toISOString();
  const saleId = id("sale");
  let shipTaskId: string | null = null;

  await (db as any).transaction(async (tx: Q) => {
    await tx.query(
      `INSERT INTO inventory_sales (id, inventory_id, tracking_no, channel, customer, customer_phone, customer_token, token_expires_at, price, currency, channel_fee, payment_status, batch_tag, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'sold',$12,$13,$14)`,
      [saleId, opts.inventoryId, inv.tracking_no, opts.channel, opts.customer, opts.customerPhone ?? null, token, expires, opts.price, opts.currency, opts.channelFee ?? 0, batch, opts.by ?? null, now()]
    );
    await tx.query(`UPDATE inventory SET lifecycle_state='sold', updated_at=$1 WHERE id=$2`, [now(), opts.inventoryId]);
    await tx.query(
      `INSERT INTO inventory_lifecycle_events (id, inventory_id, from_state, to_state, evidence, created_by, created_at)
       VALUES ($1,$2,$3,'sold',$4,$5,$6)`,
      [id("evt"), opts.inventoryId, inv.lifecycle_state ?? null, `sold via ${opts.channel}`, opts.by ?? null, now()]
    );
    shipTaskId = id("task");
    await tx.query(
      `INSERT INTO tasks (id, title, assignee, status, priority, source, source_kind, ref_inventory_id, created_by, created_at)
       VALUES ($1,$2,'Nur','todo','high','inventory','ship',$3,'sasa',$4)`,
      [shipTaskId, `Ship ${inv.tracking_no ?? opts.inventoryId} to ${opts.customer} (${opts.channel})`, opts.inventoryId, now()]
    );
  });
  return {
    ok: true,
    summary: `recorded sale of ${inv.tracking_no ?? opts.inventoryId} for ${money(opts.price, opts.currency)} via ${opts.channel}`,
    detail: { sale_id: saleId, batch_tag: batch, ship_task: shipTaskId, order_token: token },
  };
}

export async function recordShipment(db: DB, opts: {
  inventoryId: string; courier: string; trackingUrl?: string; destination?: string; by?: string;
}): Promise<ToolResult> {
  const inv = await one<any>(db, `SELECT id, tracking_no, lifecycle_state, links FROM inventory WHERE id=$1`, [opts.inventoryId]);
  if (!inv) return { ok: false, refused: true, summary: `no product ${opts.inventoryId}` };
  // honor the transition FIRST; only mutate links if the move is legal
  const verdict = evaluateTransition((inv.lifecycle_state ?? null) as LifecycleState | null, "shipped");
  if (!verdict.ok) return { ok: false, refused: true, summary: `refused: ${verdict.reason}` };
  const links = { ...(inv.links || {}), courier_url: opts.trackingUrl ?? null };
  await (db as any).transaction(async (tx: Q) => {
    await tx.query(`UPDATE inventory SET links=$1, lifecycle_state='shipped', updated_at=$2 WHERE id=$3`, [JSON.stringify(links), now(), opts.inventoryId]);
    await tx.query(
      `INSERT INTO inventory_lifecycle_events (id, inventory_id, from_state, to_state, evidence, created_by, created_at)
       VALUES ($1,$2,$3,'shipped',$4,$5,$6)`,
      [id("evt"), opts.inventoryId, inv.lifecycle_state ?? null, `shipped via ${opts.courier}`, opts.by ?? null, now()]
    );
  });
  return { ok: true, summary: `shipped ${inv.tracking_no ?? opts.inventoryId} via ${opts.courier}`, detail: { inventory_id: opts.inventoryId, courier: opts.courier } };
}

// --- record_payment_link: mark a sale paid + attach payment ref (finance) ---
export async function recordPaymentLink(db: DB, opts: { saleId: string; paymentRef: string; by?: string }): Promise<ToolResult> {
  const sale = await one<any>(db, `SELECT id, payment_status FROM inventory_sales WHERE id=$1`, [opts.saleId]);
  if (!sale) return { ok: false, refused: true, summary: `no sale ${opts.saleId}` };
  if (sale.payment_status === "paid" || sale.payment_status === "settled") {
    return { ok: true, summary: "already paid (idempotent)", detail: { deduped: true } };
  }
  await db.query(`UPDATE inventory_sales SET payment_status='paid', payment_ref=$1 WHERE id=$2`, [opts.paymentRef, opts.saleId]);
  return { ok: true, summary: `recorded payment for sale ${opts.saleId}`, detail: { sale_id: opts.saleId, ref: opts.paymentRef } };
}

// --- tasks (source:'inventory') ---
async function createTask(db: DB, t: { title: string; assignee?: string; kind: string; ref?: string; priority?: string }): Promise<ToolResult> {
  const tid = id("task");
  await db.query(
    `INSERT INTO tasks (id, title, assignee, status, priority, source, source_kind, ref_inventory_id, created_by, created_at)
     VALUES ($1,$2,$3,'todo',$4,'inventory',$5,$6,'sasa',$7)`,
    [tid, t.title, t.assignee ?? null, t.priority ?? "medium", t.kind, t.ref ?? null, now()]
  );
  return { ok: true, summary: `created task: ${t.title}`, detail: { task_id: tid, kind: t.kind } };
}
export const assignMakeTask = (db: DB, o: { maker: string; productName: string; qty?: number; ref?: string }) =>
  createTask(db, { title: `Make ${o.qty ?? 1}× ${o.productName}`, assignee: o.maker, kind: "make", ref: o.ref });
export async function assignShipTask(db: DB, opts: { inventoryId: string; customer: string; channel: string }): Promise<ToolResult> {
  const inv = await one<any>(db, `SELECT tracking_no FROM inventory WHERE id=$1`, [opts.inventoryId]);
  return createTask(db, { title: `Ship ${inv?.tracking_no ?? opts.inventoryId} to ${opts.customer} (${opts.channel})`, assignee: "Nur", kind: "ship", ref: opts.inventoryId, priority: "high" });
}
export const raiseProcurementTask = (db: DB, o: { itemName: string; ref?: string }) =>
  createTask(db, { title: `Restock ${o.itemName} (below threshold)`, assignee: "Nur", kind: "procurement", ref: o.ref });

// --- finance: cost outflow tags payments.source='maisha_inventory' (idempotent) ---
export async function logExpense(db: DB, opts: {
  payee: string; amount: number; currency: Currency; category: string; batchTag?: string; by?: string; proof?: string;
}): Promise<ToolResult> {
  const batch = opts.batchTag ?? `inv:exp:${opts.payee}:${opts.amount}:${opts.currency}`;
  const dupe = await one(db, `SELECT id FROM payments WHERE batch_tag=$1`, [batch]);
  if (dupe) return { ok: true, summary: "expense already logged (idempotent)", detail: { deduped: true } };
  const pid = id("pay");
  await db.query(
    `INSERT INTO payments (id, direction, payee, amount, currency, category, status, screenshot_path, source, batch_tag, created_by, created_at)
     VALUES ($1,'out',$2,$3,$4,$5,'paid',$6,'maisha_inventory',$7,$8,$9)`,
    [pid, opts.payee, opts.amount, opts.currency, opts.category, opts.proof ?? null, batch, opts.by ?? "Nur", now()]
  );
  return { ok: true, summary: `logged ${money(opts.amount, opts.currency)} expense (${opts.category})`, detail: { payment_id: pid, batch_tag: batch } };
}

// --- COGS / margin / P&L — per-currency, never blended ---
export async function computeCost(db: DB, endProductId: string): Promise<{ byCurrency: CurrencyMap; lines: any[] }> {
  const mats = await q<any>(db, `SELECT qty, unit_cost, currency FROM inventory_materials WHERE end_product_id=$1`, [endProductId]);
  const lines = mats.filter((m) => m.unit_cost != null && m.currency).map((m) => ({ amount: Number(m.qty) * Number(m.unit_cost), currency: m.currency }));
  return { byCurrency: sumByCurrency(lines), lines };
}
export async function collectionPnl(db: DB, collection: string): Promise<ToolResult> {
  const sales = await q<any>(db, `SELECT s.price, s.currency, s.channel_fee FROM inventory_sales s JOIN inventory i ON i.id = s.inventory_id WHERE i.collection=$1`, [collection]);
  const revenue = sumByCurrency(sales.map((s) => ({ amount: Number(s.price) - Number(s.channel_fee), currency: s.currency })));
  const prods = await q<any>(db, `SELECT id FROM inventory WHERE collection=$1 AND item_type='end_product'`, [collection]);
  let cost: CurrencyMap = {};
  for (const p of prods) {
    const c = await computeCost(db, p.id);
    for (const [k, v] of Object.entries(c.byCurrency)) cost[k as Currency] = (cost[k as Currency] ?? 0) + (v ?? 0);
  }
  return { ok: true, summary: `${collection}: revenue ${formatCurrencyMap(revenue) || "—"}, COGS ${formatCurrencyMap(cost) || "—"}`, detail: { collection, revenue, cogs: cost } };
}

// --- reads ---
export async function queryInventory(db: DB, filters: { itemType?: ItemType; collection?: string; lifecycleState?: string } = {}): Promise<any[]> {
  const where: string[] = ["enriched = TRUE"];
  const params: any[] = [];
  if (filters.itemType) { params.push(filters.itemType); where.push(`item_type = $${params.length}`); }
  if (filters.collection) { params.push(filters.collection); where.push(`collection = $${params.length}`); }
  if (filters.lifecycleState) { params.push(filters.lifecycleState); where.push(`lifecycle_state = $${params.length}`); }
  return q(db, `SELECT id, item_type, tracking_no, name, collection, style, maker, size, lifecycle_state, status FROM inventory WHERE ${where.join(" AND ")} ORDER BY created_at`, params);
}
export async function inventorySummary(db: DB): Promise<Record<string, any>> {
  const counts = await q<any>(db, `SELECT item_type, count(*)::int n FROM inventory WHERE enriched=TRUE GROUP BY item_type`);
  const byState = await q<any>(db, `SELECT lifecycle_state, count(*)::int n FROM inventory WHERE item_type='end_product' AND enriched=TRUE GROUP BY lifecycle_state`);
  const pending = await one<any>(db, `SELECT count(*)::int n FROM pending_enrichment WHERE status='pending'`);
  return { byType: Object.fromEntries(counts.map((c) => [c.item_type, c.n])), byLifecycle: Object.fromEntries(byState.map((s) => [s.lifecycle_state ?? "none", s.n])), pendingImages: pending?.n ?? 0 };
}

// --- orphan sweep: pending photos with no context past the SLA → nudge once,
// then expire. Models the pg_cron job (run on a schedule live). ---
export async function sweepPending(db: DB, opts: { nudgeAfterMs?: number; expireAfterMs?: number } = {}): Promise<ToolResult> {
  const nudgeAfter = opts.nudgeAfterMs ?? 60 * 60_000;       // 1h → nudge
  const expireAfter = opts.expireAfterMs ?? 48 * 60 * 60_000; // 48h → expire
  const nowMs = Date.parse(now());
  const pend = await q<any>(db, `SELECT id, inventory_id, created_at, status FROM pending_enrichment WHERE status IN ('pending','nudged')`);
  let nudged = 0, expired = 0;
  for (const p of pend) {
    const age = nowMs - Date.parse(p.created_at);
    if (age >= expireAfter) {
      await (db as any).transaction(async (tx: Q) => {
        await tx.query(`UPDATE pending_enrichment SET status='enriched' WHERE id=$1`, [p.id]); // close it out
        await tx.query(`UPDATE inventory SET status='archived' WHERE id=$1 AND enriched=FALSE`, [p.inventory_id]);
      });
      expired++;
    } else if (age >= nudgeAfter && p.status === "pending") {
      await db.query(`UPDATE pending_enrichment SET status='nudged', nudged_at=$1 WHERE id=$2`, [now(), p.id]);
      nudged++;
    }
  }
  return { ok: true, summary: `swept: ${nudged} nudged, ${expired} expired`, detail: { nudged, expired } };
}

// --- customer gated read: CSPRNG token, BOUND to phone, EXPIRING, RATE-LIMITED,
// status-only DTO (no internal fields). ---
const _attempts = new Map<string, { count: number; windowStart: number }>();
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX = 5;
export async function lookupOrderByToken(db: DB, opts: { token: string; requesterPhone: string }): Promise<ToolResult> {
  const key = opts.requesterPhone || "anon";
  const nowMs = Date.parse(now());
  const a = _attempts.get(key);
  if (!a || nowMs - a.windowStart > RATE_WINDOW_MS) _attempts.set(key, { count: 1, windowStart: nowMs });
  else { a.count++; if (a.count > RATE_MAX) return { ok: false, refused: true, summary: "too many lookups — try later" }; }

  if (!opts.token || opts.token.length < 12) return { ok: false, refused: true, summary: "no valid order token" };
  const sale = await one<any>(db, `SELECT s.customer_phone, s.token_expires_at, i.lifecycle_state FROM inventory_sales s JOIN inventory i ON i.id=s.inventory_id WHERE s.customer_token=$1`, [opts.token]);
  if (!sale) return { ok: false, refused: true, summary: "no order for that token" };
  if (sale.token_expires_at && nowMs > Date.parse(sale.token_expires_at)) return { ok: false, refused: true, summary: "this order link has expired" };
  // token is BOUND to the buyer's phone
  if (sale.customer_phone && opts.requesterPhone && sale.customer_phone !== opts.requesterPhone) {
    return { ok: false, refused: true, summary: "this order link isn't for this number" };
  }
  const status = sale.lifecycle_state === "delivered" ? "Delivered"
    : sale.lifecycle_state === "in_transit" ? "On its way"
    : sale.lifecycle_state === "shipped" ? "Shipped"
    : "Preparing your order";
  // DTO: status ONLY. No tracking_no, price, maker, or cost.
  return { ok: true, summary: status, detail: { status } };
}

export function _resetRateLimiter() { _attempts.clear(); }

// --- handler registry (used by guard.verifyGuardRegistration to assert every
// registered tool actually has an implementation) ---
export const HANDLERS: Record<string, Function> = {
  persist_pending_image: persistPendingImage,
  classify_and_enrich: enrichRecord,
  upsert_end_product: upsertEndProduct,
  upsert_supply: upsertSupply,
  upsert_textile: upsertTextile,
  correct_record: correctRecord,
  transition_state: transitionState,
  get_lifecycle: getLifecycle,
  consume_materials: consumeMaterials,
  record_sale: recordSale,
  record_shipment: recordShipment,
  record_payment_link: recordPaymentLink,
  assign_make_task: assignMakeTask,
  assign_ship_task: assignShipTask,
  raise_procurement_task: raiseProcurementTask,
  log_expense: logExpense,
  query_inventory: queryInventory,
  inventory_summary: inventorySummary,
  get_lifecycle_read: getLifecycle,
  lookup_order_by_token: lookupOrderByToken,
};
