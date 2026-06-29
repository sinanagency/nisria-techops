"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

// Shared form-submit button. Reads the enclosing <form action={...}> pending
// state via useFormStatus, so it disables + shows a spinner while the server
// action runs. Closes the Real-action law's "loading -> done" requirement and
// kills the double-submit risk (e.g. marking a recurring payment paid twice).
export function SubmitButton({
  className = "btn",
  pendingLabel,
  children,
  style,
  name,
  value,
  formNoValidate,
  id,
}: {
  className?: string;
  pendingLabel?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  // id lets a quick-action / deeplink target this button (e.g. ContextBar's
  // "Draft thank-yous" targets #donations-thank-all).
  id?: string;
  // name/value let several SubmitButtons share one form (e.g. Approve vs
  // Decline, distinguished by decision=approve|reject). formNoValidate skips
  // HTML validation for destructive/secondary actions (Decline shouldn't be
  // blocked by an empty subject field).
  name?: string;
  value?: string;
  formNoValidate?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      id={id}
      name={name}
      value={value}
      formNoValidate={formNoValidate}
      className={className}
      disabled={pending}
      aria-busy={pending}
      style={style}
    >
      {pending ? (
        <>
          <Loader2 size={14} className="spin" /> {pendingLabel || "Working…"}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export default SubmitButton;
