"use client";
import { useFormState } from "react-dom";
import { Lock, ShieldCheck } from "lucide-react";
import { unlockVault } from "./actions";

const initial: { error?: string } = {};

// The extra password wall in front of /resources. The tab holds live account
// credentials, so a portal session alone isn't enough — Nur re-enters the vault
// password to open it, and the unlock lasts 30 minutes.
export default function VaultGate({ configured }: { configured: boolean }) {
  const [state, action] = useFormState(unlockVault, initial);
  return (
    <div className="pagewrap rise">
      <div style={{ maxWidth: 420, margin: "8vh auto 0" }}>
        <form className="card card-pad" action={action} style={{ textAlign: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--teal-50)", color: "var(--teal-700)", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
            <Lock size={26} />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Resources vault</h1>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>
            This tab holds the logins and passwords for the platforms you&rsquo;re registered on. Enter the vault password to open it.
          </p>
          {configured ? (
            <>
              <input type="password" name="password" autoFocus autoComplete="off" placeholder="Vault password" style={{ width: "100%", marginTop: 18 }} />
              <button className="btn teal full" type="submit" style={{ marginTop: 12, justifyContent: "center" }}>
                <ShieldCheck size={15} /> Unlock
              </button>
              {state?.error && <div className="err" style={{ marginTop: 10 }}>{state.error}</div>}
            </>
          ) : (
            <div className="err" style={{ marginTop: 16, textAlign: "left" }}>
              Vault isn&rsquo;t configured yet. Set <code>RESOURCES_VAULT_PASSWORD</code> and <code>RESOURCES_VAULT_KEY</code> in the environment, then reload.
            </div>
          )}
          <div className="login-foot" style={{ marginTop: 18 }}>Secrets are encrypted at rest. Unlock expires after 30 minutes.</div>
        </form>
      </div>
    </div>
  );
}
