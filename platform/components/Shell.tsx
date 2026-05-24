"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { logout } from "../app/login/actions";

const GROUPS: { label?: string; items: { href: string; label: string; ico: string }[] }[] = [
  { items: [{ href: "/", label: "Dashboard", ico: "◫" }] },
  {
    label: "Run the org",
    items: [
      { href: "/assistant", label: "AI Assistant", ico: "✦" },
      { href: "/inbox", label: "Inbox", ico: "✉" },
      { href: "/content", label: "Content", ico: "✎" },
      { href: "/tasks", label: "Tasks", ico: "✓" },
      { href: "/team", label: "Team", ico: "◑" },
      { href: "/newsletter", label: "Newsletter", ico: "❋" },
    ],
  },
  {
    label: "Records",
    items: [
      { href: "/donors", label: "Donors", ico: "○" },
      { href: "/donations", label: "Donations", ico: "$" },
      { href: "/campaigns", label: "Campaigns", ico: "◎" },
      { href: "/beneficiaries", label: "Beneficiaries", ico: "♥" },
      { href: "/inventory", label: "Inventory", ico: "▦" },
      { href: "/grants", label: "Grants", ico: "✧" },
      { href: "/outreach", label: "Outreach", ico: "→" },
    ],
  },
];

export default function Shell({ title, sub, action, children }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="dot">N</span> Nisria</div>
        {GROUPS.map((g, i) => (
          <div className="nav-group" key={i}>
            {g.label && <div className="lbl">{g.label}</div>}
            <nav className="nav">
              {g.items.map((n) => {
                const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
                return (
                  <Link key={n.href} href={n.href} className={active ? "active" : ""}>
                    <span className="ico">{n.ico}</span> {n.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        ))}
        <div className="foot">
          <form action={logout}><button type="submit">Sign out</button></form>
          <div style={{ marginTop: 6 }}>Command Center · v2</div>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <div>
            <h1>{title}</h1>
            {sub && <div className="sub">{sub}</div>}
          </div>
          {action}
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
