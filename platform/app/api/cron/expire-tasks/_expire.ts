// Pure classifier for date-passed task expiry (KT #316). No DB, no network, so
// it is unit-testable and the route stays a thin shell around it.
//
// Rule: a task whose due date has PASSED and is still OPEN (todo/in_progress) is
// "expirable" — assume closed, take it off the active board, but archive it (the
// route does that) and NEVER mark it done. High-priority or important ones are
// split out so Nur gets a heads-up before they leave the list.

export type ExpiryTask = {
  id: string;
  title?: string | null;
  due_on?: string | null;
  status?: string | null;
  priority?: string | null;
  important?: boolean | null;
  assignee_id?: string | null;
};

export function classifyExpiry(
  tasks: ExpiryTask[],
  today: string,
): { expirable: ExpiryTask[]; important: ExpiryTask[]; normal: ExpiryTask[] } {
  // Slice due_on to its date portion (first 10 chars) before comparing: this is
  // correct whether due_on is a plain "YYYY-MM-DD" date OR a full timestamptz
  // ("2026-06-20T00:00:00+00:00"). Without the slice the longer timestamptz
  // string sorts AFTER the bare date and the compare breaks silently.
  const open = (tasks || []).filter(
    (t) => !!t.due_on && String(t.due_on).slice(0, 10) < today && (t.status === "todo" || t.status === "in_progress"),
  );
  const isImportant = (t: ExpiryTask) => t.priority === "high" || t.important === true;
  return { expirable: open, important: open.filter(isImportant), normal: open.filter((t) => !isImportant(t)) };
}
