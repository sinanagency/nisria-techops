import { cookies } from "next/headers";
import Shell from "../../components/Shell";
import { Badge } from "../../components/ui";
import { admin } from "../../lib/supabase-admin";
import { VAULT_COOKIE, isVaultUnlocked, vaultConfigured } from "../../lib/vault";
import { addResource, deleteResource, lockVault } from "./actions";
import VaultGate from "./VaultGate";
import Reveal from "./Reveal";
import { Link2, KeyRound, Lock, Plus, ExternalLink, Trash2, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

const CATS: { key: string; label: string }[] = [
  { key: "platform", label: "Platforms" },
  { key: "account", label: "Accounts" },
  { key: "tool", label: "Tools" },
  { key: "supplier", label: "Suppliers" },
  { key: "funding", label: "Funding & grants" },
  { key: "research", label: "Research" },
  { key: "partner", label: "Partners" },
  { key: "social", label: "Social" },
  { key: "link", label: "Links" },
];

export default async function Resources({ searchParams }: { searchParams?: { [k: string]: string | string[] | undefined } }) {
  const configured = vaultConfigured();
  const open = isVaultUnlocked(cookies().get(VAULT_COOKIE)?.value);

  // GATE: the whole tab is locked behind the vault password (it grants account
  // access). Until unlocked, show only the password wall — no data is queried.
  if (!open) return <VaultGate configured={configured} />;

  const sp = searchParams || {};
  const one = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined)) || "";
  const tab = one("tab") === "logins" ? "logins" : "links";
  const q = one("q").trim().toLowerCase();
  const cat = one("cat");

  // fail soft if the table isn't migrated yet (DB step is deferred)
  let list: any[] = [];
  try {
    const { data } = await admin().from("resources").select("*").order("created_at", { ascending: false }).limit(500);
    list = (data || []) as any[];
  } catch { list = []; }

  const allCreds = list.filter((r) => r.is_credential);
  const allLinks = list.filter((r) => !r.is_credential);

  const matchQ = (r: any) => {
    if (!q) return true;
    return `${r.title || ""} ${r.url || ""} ${r.notes || ""} ${r.username || ""} ${(r.tags || []).join(" ")}`.toLowerCase().includes(q);
  };

  // tab bar (Resources is the hub; Logins and Links are separate, not mixed)
  const tabHref = (t: string) => `/resources?tab=${t}`;
  const tabBar = (
    <div className="flex" style={{ gap: 6, marginBottom: 16 }}>
      <a className={`pill ${tab === "links" ? "on" : ""}`} href={tabHref("links")}><Link2 size={13} /> Links &amp; platforms <span className="faint" style={{ marginLeft: 4 }}>{allLinks.length}</span></a>
      <a className={`pill ${tab === "logins" ? "on" : ""}`} href={tabHref("logins")}><KeyRound size={13} /> Logins &amp; passwords <span className="faint" style={{ marginLeft: 4 }}>{allCreds.length}</span></a>
    </div>
  );

  const lockAction = (
    <form action={lockVault}><button className="pill" type="submit"><Lock size={13} /> Lock vault</button></form>
  );

  // ============ LOGINS TAB ============
  if (tab === "logins") {
    const creds = allCreds.filter(matchQ);
    return (
      <Shell title="Resources" sub="Logins & passwords. Encrypted at rest, vault unlocked." action={lockAction}>
        {tabBar}
        <details className="card" style={{ marginBottom: 16 }}>
          <summary className="flex" style={{ gap: 8, alignItems: "center", cursor: "pointer", padding: "14px 18px", userSelect: "none", fontWeight: 600, fontSize: 14 }}>
            <Plus size={15} color="var(--teal-700)" /> Add a login
          </summary>
          <form action={addResource} className="stack" style={{ gap: 10, padding: "4px 18px 18px" }}>
            <input type="hidden" name="is_credential" value="on" />
            <input type="hidden" name="category" value="account" />
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <input name="title" placeholder="Platform (e.g. Mailchimp, FNB)" required />
              <input name="url" placeholder="Login URL (optional)" />
            </div>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <input name="username" placeholder="Username / email" autoComplete="off" />
              <input type="password" name="password" placeholder="Password (encrypted at rest)" autoComplete="new-password" />
            </div>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <select name="brand" defaultValue=""><option value="">Personal / no brand</option><option value="nisria">Nisria</option><option value="maisha">Maisha</option><option value="ahadi">AHADI</option></select>
              <input name="tags" placeholder="tags, comma, separated" />
            </div>
            <textarea name="notes" placeholder="Notes (optional)" rows={2} />
            <div><button className="btn teal" type="submit"><Plus size={15} /> Save login</button></div>
          </form>
        </details>

        {allCreds.length > 0 && (
          <form method="GET" action="/resources" className="flex" style={{ gap: 8, marginBottom: 16 }}>
            <input type="hidden" name="tab" value="logins" />
            <input name="q" defaultValue={one("q")} placeholder="Search logins…" style={{ maxWidth: 320 }} />
            <button className="btn ghost sm" type="submit">Search</button>
            {q && <a className="pill" href={tabHref("logins")}>Clear</a>}
          </form>
        )}

        {allCreds.length === 0 ? (
          <div className="card"><div className="empty"><KeyRound size={20} color="var(--faint)" /><div style={{ marginTop: 8 }}>No logins saved yet. Add one above, or just tell Sasa on WhatsApp (e.g. &ldquo;save my Mailchimp login, user nur@nisria.co password …&rdquo;) and she&rsquo;ll store it encrypted here.</div></div></div>
        ) : (
          <div className="card">
            <div className="card-h"><span className="flex" style={{ gap: 8, alignItems: "center" }}><KeyRound size={15} color="var(--teal-700)" /> Logins &amp; passwords</span><Badge tone="gold">{creds.length}</Badge></div>
            <div className="card-listscroll">
              <table>
                <thead><tr><th>Platform</th><th>Username</th><th>Password</th><th>Brand</th><th></th></tr></thead>
                <tbody>
                  {creds.map((r) => (
                    <tr key={r.id}>
                      <td>{r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="flex" style={{ gap: 5, alignItems: "center" }}>{r.title} <ExternalLink size={11} /></a> : r.title}</td>
                      <td><code style={{ fontSize: 12.5 }}>{r.username || "—"}</code></td>
                      <td>{r.secret_ciphertext ? <Reveal id={r.id} /> : <span className="faint">—</span>}</td>
                      <td>{r.brand ? <span className={`chip ${r.brand}`}><span className="bdot" /> {r.brand}</span> : <span className="faint">—</span>}</td>
                      <td style={{ textAlign: "right" }}>
                        <form action={deleteResource}><input type="hidden" name="id" value={r.id} /><button className="btn ghost sm" type="submit" title="Delete" style={{ padding: "3px 6px" }}><Trash2 size={13} /></button></form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="login-foot" style={{ marginTop: 12, display: "flex", gap: 6, alignItems: "center" }}><ShieldCheck size={12} /> Passwords are AES-256 encrypted at rest and only decrypted when you reveal them.</div>
      </Shell>
    );
  }

  // ============ LINKS TAB ============
  const links = allLinks.filter(matchQ).filter((r) => !cat || (r.category || "link") === cat);
  const grouped = CATS.map((c) => ({ ...c, items: links.filter((r) => (r.category || "link") === c.key) })).filter((g) => g.items.length);
  const catCount: Record<string, number> = {};
  for (const r of allLinks) catCount[r.category || "link"] = (catCount[r.category || "link"] || 0) + 1;
  const qs = (patch: Record<string, string | undefined>) => {
    const next: Record<string, string> = { tab: "links" };
    if (cat) next.cat = cat; if (q) next.q = q;
    for (const [k, v] of Object.entries(patch)) { if (!v) delete next[k]; else next[k] = v; }
    return `/resources?${new URLSearchParams(next).toString()}`;
  };

  return (
    <Shell title="Resources" sub="Every platform, tool and supplier link in one place." action={lockAction}>
      {tabBar}
      <details className="card" style={{ marginBottom: 16 }}>
        <summary className="flex" style={{ gap: 8, alignItems: "center", cursor: "pointer", padding: "14px 18px", userSelect: "none", fontWeight: 600, fontSize: 14 }}>
          <Plus size={15} color="var(--teal-700)" /> Add a link or platform
        </summary>
        <form action={addResource} className="stack" style={{ gap: 10, padding: "4px 18px 18px" }}>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input name="title" placeholder="Name (e.g. Canva, a supplier)" required />
            <input name="url" placeholder="https://…" />
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <select name="category" defaultValue="platform">{CATS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
            <select name="brand" defaultValue=""><option value="">Personal / no brand</option><option value="nisria">Nisria</option><option value="maisha">Maisha</option><option value="ahadi">AHADI</option></select>
            <input name="tags" placeholder="tags, comma, separated" />
          </div>
          <textarea name="notes" placeholder="Notes (optional)" rows={2} />
          <div><button className="btn teal" type="submit"><Plus size={15} /> Save link</button></div>
        </form>
      </details>

      {allLinks.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <div className="stack" style={{ gap: 12 }}>
            <form method="GET" action="/resources" className="flex" style={{ gap: 8 }}>
              <input type="hidden" name="tab" value="links" />
              {cat && <input type="hidden" name="cat" value={cat} />}
              <input name="q" defaultValue={one("q")} placeholder="Search by name, url, tag…" style={{ maxWidth: 380 }} />
              <button className="btn ghost sm" type="submit">Search</button>
              {q && <a className="pill" href={qs({ q: undefined })}>Clear</a>}
            </form>
            <div className="flex wrap" style={{ gap: 6 }}>
              <span className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", minWidth: 50 }}>Type</span>
              <a className={`pill ${!cat ? "on" : ""}`} href={qs({ cat: undefined })}>All</a>
              {CATS.filter((c) => catCount[c.key]).map((c) => (
                <a key={c.key} className={`pill ${cat === c.key ? "on" : ""}`} href={qs({ cat: c.key })}>{c.label} <span className="faint" style={{ marginLeft: 4 }}>{catCount[c.key]}</span></a>
              ))}
            </div>
          </div>
        </div>
      )}

      {allLinks.length === 0 && (
        <div className="card"><div className="empty"><Link2 size={20} color="var(--faint)" /><div style={{ marginTop: 8 }}>No links yet. Add a platform or supplier above, or drop links to Sasa on WhatsApp and she&rsquo;ll file them here.</div></div></div>
      )}

      {grouped.map((g) => (
        <details key={g.key} className="lib-folder" open style={{ marginBottom: 12 }}>
          <summary className="flex lib-folder-head" style={{ gap: 8, alignItems: "center", cursor: "pointer", padding: "9px 4px", userSelect: "none" }}>
            <Link2 size={15} color="var(--muted)" /><span style={{ fontWeight: 600, fontSize: 14 }}>{g.label}</span><Badge tone="gray">{g.items.length}</Badge>
          </summary>
          <div className="grid cols-3" style={{ marginTop: 4 }}>
            {g.items.map((r) => (
              <div key={r.id} className="card hover" style={{ padding: 14 }}>
                <div className="between">
                  <span style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
                  {r.brand && <span className={`chip ${r.brand}`}><span className="bdot" /> {r.brand}</span>}
                </div>
                {r.notes && <div className="faint" style={{ fontSize: 11.5, marginTop: 6, lineHeight: 1.4, maxHeight: 34, overflow: "hidden" }}>{r.notes}</div>}
                {(r.tags || []).length > 0 && <div className="flex wrap" style={{ gap: 4, marginTop: 8 }}>{r.tags.slice(0, 4).map((t: string) => <span key={t} className="badge gray" style={{ fontSize: 10 }}>{t}</span>)}</div>}
                <div className="flex" style={{ gap: 6, marginTop: 10, alignItems: "center" }}>
                  {r.url && <a className="pill" href={r.url} target="_blank" rel="noreferrer" style={{ flex: 1, justifyContent: "center" }}><ExternalLink size={12} /> Open</a>}
                  <form action={deleteResource}><input type="hidden" name="id" value={r.id} /><button className="btn ghost sm" type="submit" title="Delete" style={{ padding: "5px 7px" }}><Trash2 size={13} /></button></form>
                </div>
              </div>
            ))}
          </div>
        </details>
      ))}
    </Shell>
  );
}
