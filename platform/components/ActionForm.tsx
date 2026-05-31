"use client";

import { useEffect, useRef } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { useToast } from "./Toast";

// The reusable "loading -> done -> confirmation" form (Law 6, Real-action).
// Wrap any server action that returns an ActionResult and drop a <SubmitButton>
// inside: the button shows the spinner while pending (useFormStatus), and when
// the action resolves this fires the toast with the REAL outcome, then refreshes
// the route so the resolved item (e.g. an approved card) clears.
//
// We deliberately do NOT call revalidatePath inside the action: returning the
// result first, then toast()-ing, then router.refresh() guarantees the
// confirmation is queued (it lives in the AppFrame-level provider) before this
// form unmounts with the refreshed list. Honesty law: a failed action toasts
// the failure, never a fake success.

export type ActionResult = { ok: boolean; message: string; ts: number };

export default function ActionForm({
  action,
  children,
  className,
  style,
  onResult,
}: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onResult?: (r: ActionResult) => void;
}) {
  const [state, formAction] = useFormState(action, null);
  const { toast } = useToast();
  const router = useRouter();
  const seen = useRef(0);

  useEffect(() => {
    // ts changes on every resolved submit, so identical messages still toast.
    if (!state || state.ts === seen.current) return;
    seen.current = state.ts;
    toast(state.message, { tone: state.ok ? "success" : "error" });
    onResult?.(state);
    // Only refresh on success: on failure we keep the form (and its draft) in
    // place so the operator can retry or edit, rather than wiping the card.
    if (state.ok) router.refresh();
  }, [state, toast, router, onResult]);

  return (
    <form action={formAction} className={className} style={style}>
      {children}
    </form>
  );
}
