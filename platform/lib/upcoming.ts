// Upcoming payments query (next 7 days, Dubai TZ).
// v1 source: payments only (tasks NOT joined per spec/002 Q5).

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
};

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

  const result: UpcomingPayment[] = rows.map((r: any) => {
    const due = String(r.due_on).slice(0, 10);
    const overdue = due < today;
    const soon = !overdue && due <= window.to;
    return {
      id: String(r.id),
      payee: String(r.payee || "—"),
      purpose: r.purpose || null,
      amount: Number(r.amount || 0),
      currency: String(r.currency || "KES").toUpperCase(),
      due_on: due,
      category: r.category || null,
      recurrence: r.recurrence || null,
      status: r.status,
      urgency: overdue ? "overdue" : soon ? "soon" : "scheduled",
    };
  });

  return result;
}
