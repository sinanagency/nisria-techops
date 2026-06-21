// Guarded lifecycle state machine for end products.
// production → in_stock → reserved → sold → shipped → in_transit → delivered
// branch: → returned → restock (→ in_stock). Illegal jumps are REFUSED.
// Idempotent: transitioning to the state you're already in is a no-op (the
// double-ship guard), not an error and not a duplicate event.

export type LifecycleState =
  | "production"
  | "in_stock"
  | "reserved"
  | "sold"
  | "shipped"
  | "in_transit"
  | "delivered"
  | "returned"
  | "restock";

export const LIFECYCLE_STATES: LifecycleState[] = [
  "production", "in_stock", "reserved", "sold",
  "shipped", "in_transit", "delivered", "returned", "restock",
];

// Allowed forward edges. Anything not listed is illegal.
const EDGES: Record<LifecycleState, LifecycleState[]> = {
  production: ["in_stock"],
  in_stock: ["reserved", "sold", "archived" as any].filter(Boolean) as LifecycleState[],
  reserved: ["sold", "in_stock"],          // can release a reservation
  sold: ["shipped", "returned"],           // cancel-to-returned, or ship
  shipped: ["in_transit", "delivered", "returned"],
  in_transit: ["delivered", "returned"],
  delivered: ["returned"],                 // post-delivery return
  returned: ["restock"],
  restock: ["in_stock"],
};

export type TransitionResult =
  | { ok: true; idempotent: boolean; from: LifecycleState | null; to: LifecycleState }
  | { ok: false; refused: true; reason: string; from: LifecycleState | null; to: string };

export function canTransition(from: LifecycleState | null, to: string): boolean {
  if (!LIFECYCLE_STATES.includes(to as LifecycleState)) return false;
  if (from === null) return to === "production" || to === "in_stock"; // entry points
  if (from === to) return true; // idempotent
  return (EDGES[from] ?? []).includes(to as LifecycleState);
}

export function evaluateTransition(from: LifecycleState | null, to: string): TransitionResult {
  if (!LIFECYCLE_STATES.includes(to as LifecycleState)) {
    return { ok: false, refused: true, reason: `unknown lifecycle state '${to}'`, from, to };
  }
  if (from === to) {
    return { ok: true, idempotent: true, from, to: to as LifecycleState };
  }
  if (!canTransition(from, to)) {
    return {
      ok: false,
      refused: true,
      reason: `illegal transition ${from ?? "∅"} → ${to} (allowed from ${from ?? "∅"}: ${
        from === null ? "production, in_stock" : (EDGES[from] ?? []).join(", ") || "none"
      })`,
      from,
      to,
    };
  }
  return { ok: true, idempotent: false, from, to: to as LifecycleState };
}
