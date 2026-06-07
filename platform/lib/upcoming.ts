// Upcoming payments query (next 7 days, Dubai TZ).
// v2 (Taona: 2026-06-07): UNION payments + tasks whose due_on is within 7
// days AND title/description carries a payment hint. Tasks side is READ-ONLY;
// no schema or write touch to the tasks table (carve-out respected).

import { periodFor } from "./period";

export type UpcomingPayment = {
  id: string;
  payee: string;
  purpose: string | null;
  amount: number;
  currency: string;
  due_on: string;
  category: string | null;
  recurrence: string | null;
  status: string;
  urgency: "overdue" | "soon" | "scheduled";
  source: "payment" | "task"; // distinguishes a scheduled obligation from a payment-intent task
};

// Match a task title that implies a payment intent. Conservative: only fires
// when the title carries a clear money word. Operator can always add explicit
// "payment" to the title to force inclusion.
const PAYMENT_TASK_PATTERN = /\b(pay|payment|invoice|rent|salary|salaries|stipend|bill|due|owe|fee|subscription|renew|wire|transfer|m-pesa|mpesa)\b/i;

export async function loadUpcoming(db: any): Promise<UpcomingPayment[]> {
  const window = periodFor("next_7_days");
  const today = window.from;

  const { data } = await db
    .from("payments")
    .select("id,payee,purpose,amount,currency,due_on,category,recurrence,status,direction")
    .eq("direction", "out")
    .in("status", ["scheduled", "due", "overdue"])
    .or(`due_on.lte.${window.to},due_on.is.null`)
    .order("due_on", { ascending: true, nullsFirst: false })
    .limit(60);

  const rows = ((data || []) as any[]).filter((r) => r.due_on);

  const payments: UpcomingPayment[] = rows.map((r: any) => {
    const due = String(r.due_on).slice(0, 10);
    const overdue = due < today;
    const soon = !overdue && due <= window.to;
    return {
      id: `pay-${r.id}`,
      payee: String(r.payee || "—"),
      purpose: r.purpose || null,
      amount: Number(r.amount || 0),
      currency: String(r.currency || "KES").toUpperCase(),
      due_on: due,
      category: r.category || null,
      recurrence: r.recurrence || null,
      status: r.status,
      urgency: overdue ? "overdue" : soon ? "soon" : "scheduled",
      source: "payment",
    };
  });

  // Tasks pass: read-only. Pull non-done tasks with due_on inside the 7-day
  // window whose title or description carries a payment hint.
  const { data: taskData } = await db
    .from("tasks")
    .select("id,title,status,priority,due_on,description")
    .not("status", "in", "(done,cancelled,archived)")
    .gte("due_on", today)
    .lte("due_on", window.to)
    .limit(60);

  const tasks: UpcomingPayment[] = ((taskData || []) as any[])
    .filter((t) => t.due_on)
    .filter((t) => PAYMENT_TASK_PATTERN.test(`${t.title || ""} ${t.description || ""}`))
    .map((t: any) => {
      const due = String(t.due_on).slice(0, 10);
      const overdue = due < today;
      const soon = !overdue && due <= window.to;
      return {
        id: `task-${t.id}`,
        payee: String(t.title || "Payment task"),
        purpose: t.description || null,
        amount: 0, // tasks don't carry amounts; rendered as "amount TBD"
        currency: "KES",
        due_on: due,
        category: "task",
        recurrence: null,
        status: t.status,
        urgency: overdue ? "overdue" : soon ? "soon" : "scheduled",
        source: "task",
      };
    });

  // earliest due first; mix payments + tasks; cap (UpcomingPaymentsStrip
  // already caps display at 10 and surfaces the rest as a "view all" card).
  return [...payments, ...tasks].sort((a, b) => (a.due_on < b.due_on ? -1 : a.due_on > b.due_on ? 1 : 0));
}
