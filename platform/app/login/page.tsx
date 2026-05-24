"use client";

import { useFormState } from "react-dom";
import { login } from "./actions";

const initial: { error?: string } = {};

export default function LoginPage() {
  const [state, action] = useFormState(login, initial);
  return (
    <div className="login-wrap">
      <form className="login-card" action={action}>
        <div className="brand">
          <span className="mark">N</span> Nisria
        </div>
        <label style={{ fontSize: 13, color: "var(--muted)", fontWeight: 500 }}>Password</label>
        <input type="password" name="password" autoFocus placeholder="••••••••" style={{ marginTop: 6 }} />
        <button className="btn" type="submit">Sign in</button>
        {state?.error && <div className="err">{state.error}</div>}
        <div style={{ marginTop: 16, fontSize: 12, color: "var(--faint)" }}>
          Internal platform. Holds donor &amp; beneficiary data, do not share access.
        </div>
      </form>
    </div>
  );
}
