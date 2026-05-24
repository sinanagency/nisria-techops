"use client";

import { useFormState, useFormStatus } from "react-dom";
import { dispatchTasks } from "../app/tasks/actions";

const initial: { ok?: string; error?: string } = {};

function Submit() {
  const { pending } = useFormStatus();
  return <button className="btn yellow" type="submit" disabled={pending}>{pending ? "Thinking…" : "Dispatch ✦"}</button>;
}

export default function DispatchBox() {
  const [state, action] = useFormState(dispatchTasks, initial);
  return (
    <div className="card card-pad">
      <div className="between" style={{ marginBottom: 10 }}>
        <strong>Tell the system what you want done</strong>
        <span className="badge purple">AI dispatch</span>
      </div>
      <form action={action} className="flex" style={{ alignItems: "stretch" }}>
        <input name="instruction" placeholder="e.g. 'Get this week's blog drafted, schedule 3 IG posts about the school campaign, and have someone follow up the Mastercard CSR lead'" />
        <Submit />
      </form>
      {state?.ok && <div style={{ color: "var(--green)", fontSize: 12.5, marginTop: 8 }}>✓ {state.ok}</div>}
      {state?.error && <div className="err">{state.error}</div>}
    </div>
  );
}
