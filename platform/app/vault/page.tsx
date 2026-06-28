import Shell from "../../components/Shell";
import { Badge } from "../../components/ui";
import { admin } from "../../lib/supabase-admin";
import { getCurrentUser } from "../../lib/auth";
import { addCredential, deleteCredential } from "./actions";
import Reveal from "./Reveal";
import { KeyRound, Plus, ExternalLink, Trash2, ShieldCheck, ShieldX } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Vault() {
  const user = getCurrentUser();
  // FOUNDER-ONLY GATE, identical mechanism to app/inventory/page.tsx:62
  // (getCurrentUser().role). Logins are MASTER-tier: only Nur (founder) sees
  // them. A non-founder gets a hard access-denied state and NO secrets are
  // queried below.
  const isFounder = user?.role === "founder";

  if (!isFounder) {
    return (
      <Shell title="Vault" sub="Encrypted logins. Founder access only.">
        <div className="card">
          <div className="empty">
            <ShieldX size={22} color="var(--faint)" />
            <div style={{ marginTop: 10, fontWeight: 600 }}>Access restricted</div>
            <div className="faint" style={{ marginTop: 6, fontSize: 13, maxWidth: 420, marginInline: "auto", lineHeight: 1.5 }}>
              The credential vault is available only to the founder. Saved logins
              are never shown to anyone else, and nothing is decrypted here.
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  // Founder confirmed. List credentials — title, username, url only. The
  // password (secret_ciphertext/iv/tag) is intentionally NOT selected, so it
  // never reaches the page payload. Decryption happens only via the
  // server-side revealCredential action, on demand.
  let creds: any[] = [];
  try {
    const { data } = await admin()
      .from("resources")
      .select("id,title,url,username,brand,secret_ciphertext")
      .eq("is_credential", true)
      .order("created_at", { ascending: false })
      .limit(500);
    // map secret_ciphertext to a boolean flag only — we keep whether a password
    // EXISTS, but never carry the ciphertext itself into the client tree.
    creds = (data || []).map((r: any) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      username: r.username,
      brand: r.brand,
      hasSecret: !!r.secret_ciphertext,
    }));
  } catch {
    creds = []; // table may be pre-migration; fail soft, no crash
  }

  return (
    <Shell title="Vault" sub="Encrypted logins. Founder access only, decrypted on demand.">
      <details className="card" style={{ marginBottom: 16 }}>
        <summary className="flex" style={{ gap: 8, alignItems: "center", cursor: "pointer", padding: "14px 18px", userSelect: "none", fontWeight: 600, fontSize: 14 }}>
          <Plus size={15} color="var(--teal-700)" /> Add a login
        </summary>
        <form action={addCredential} className="stack" style={{ gap: 10, padding: "4px 18px 18px" }}>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input name="title" placeholder="Service (e.g. Mailchimp, FNB)" required />
            <input name="url" placeholder="Login URL (optional)" />
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input name="username" placeholder="Username / email" autoComplete="off" />
            <input type="password" name="password" placeholder="Password (encrypted at rest)" autoComplete="new-password" />
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <select name="brand" defaultValue=""><option value="">Personal / no brand</option><option value="nisria">Nisria</option><option value="maisha">Maisha</option><option value="ahadi">AHADI</option></select>
            <input name="notes" placeholder="Notes (optional)" />
          </div>
          <div><button className="btn teal" type="submit"><Plus size={15} /> Save login</button></div>
        </form>
      </details>

      {creds.length === 0 ? (
        <div className="card">
          <div className="empty">
            <KeyRound size={20} color="var(--faint)" />
            <div style={{ marginTop: 8 }}>No logins saved yet. Add one above.</div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-h">
            <span className="flex" style={{ gap: 8, alignItems: "center" }}><KeyRound size={15} color="var(--teal-700)" /> Logins &amp; passwords</span>
            <Badge tone="gold">{creds.length}</Badge>
          </div>
          <div className="card-listscroll">
            <table>
              <thead><tr><th>Service</th><th>Username</th><th>Password</th><th>Brand</th><th></th></tr></thead>
              <tbody>
                {creds.map((r) => (
                  <tr key={r.id}>
                    <td>{r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="flex" style={{ gap: 5, alignItems: "center" }}>{r.title} <ExternalLink size={11} /></a> : r.title}</td>
                    <td><code style={{ fontSize: 12.5 }}>{r.username || "—"}</code></td>
                    <td>{r.hasSecret ? <Reveal id={r.id} /> : <span className="faint">—</span>}</td>
                    <td>{r.brand ? <span className={`chip ${r.brand}`}><span className="bdot" /> {r.brand}</span> : <span className="faint">—</span>}</td>
                    <td style={{ textAlign: "right" }}>
                      <form action={deleteCredential}><input type="hidden" name="id" value={r.id} /><button className="btn ghost sm" type="submit" title="Delete" style={{ padding: "3px 6px" }}><Trash2 size={13} /></button></form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="login-foot" style={{ marginTop: 12, display: "flex", gap: 6, alignItems: "center" }}>
        <ShieldCheck size={12} /> Passwords are AES-256-GCM encrypted at rest and decrypted server-side only when you reveal them.
      </div>
    </Shell>
  );
}
