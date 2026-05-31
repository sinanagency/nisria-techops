"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Home, Inbox, HeartHandshake, DollarSign, Target, Award, FileText, ShieldCheck,
  Sparkles, FolderOpen, PenLine, Send, Package, Heart, Users, ListChecks,
  Wand2, Bot, Settings, Search,
} from "lucide-react";

// Launchpad: one flat, alphabetical, searchable grid of every place in the command
// center (Mac-Launchpad style, in the platform's light editorial skin). Type to
// filter, Enter opens the top hit, Esc clears. Purely additive — a destination, not
// a change to how the existing nav behaves.
type App = { label: string; href: string; icon: any; tone: string };
const APPS: App[] = [
  { label: "Home", href: "/", icon: Home, tone: "teal" },
  { label: "Inbox", href: "/inbox", icon: Inbox, tone: "peri" },
  { label: "Donors", href: "/donors", icon: HeartHandshake, tone: "teal" },
  { label: "Donations", href: "/donations", icon: DollarSign, tone: "green" },
  { label: "Campaigns", href: "/campaigns", icon: Target, tone: "gold" },
  { label: "Grants", href: "/grants", icon: Award, tone: "peri" },
  { label: "Finance", href: "/finance", icon: DollarSign, tone: "green" },
  { label: "Reports", href: "/reports", icon: FileText, tone: "teal" },
  { label: "Legal & Compliance", href: "/legal", icon: ShieldCheck, tone: "gold" },
  { label: "Document Studio", href: "/studio", icon: Sparkles, tone: "peri" },
  { label: "Filing", href: "/filing", icon: FolderOpen, tone: "teal" },
  { label: "Content", href: "/content", icon: PenLine, tone: "gold" },
  { label: "Library", href: "/library", icon: FolderOpen, tone: "peri" },
  { label: "Outreach", href: "/outreach", icon: Send, tone: "teal" },
  { label: "Inventory", href: "/inventory", icon: Package, tone: "gold" },
  { label: "Beneficiaries", href: "/beneficiaries", icon: Heart, tone: "teal" },
  { label: "Team", href: "/team", icon: Users, tone: "peri" },
  { label: "Tasks", href: "/tasks", icon: ListChecks, tone: "gold" },
  { label: "Smart Mode", href: "/smart", icon: Wand2, tone: "teal" },
  { label: "Agents", href: "/agents", icon: Bot, tone: "peri" },
  { label: "Settings", href: "/settings", icon: Settings, tone: "gray" },
].sort((a, b) => a.label.localeCompare(b.label));

export default function Launchpad() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? APPS.filter((a) => a.label.toLowerCase().includes(n)) : APPS;
  }, [q]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && list[0]) router.push(list[0].href);
    if (e.key === "Escape") setQ("");
  };

  return (
    <div className="lp-wrap rise">
      <div className="lp-searchrow">
        <div className="lp-search">
          <Search size={17} style={{ color: "var(--faint)", flexShrink: 0 }} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search apps…" />
        </div>
      </div>
      <div className="lp-grid">
        {list.map((a) => {
          const Ico = a.icon;
          return (
            <button key={a.href} type="button" className="lp-tile" onClick={() => router.push(a.href)}>
              <span className={`lp-ico ${a.tone}`}><Ico size={26} /></span>
              <span className="lp-label">{a.label}</span>
            </button>
          );
        })}
        {list.length === 0 && <div className="faint" style={{ gridColumn: "1/-1", textAlign: "center", padding: 40 }}>No app matches “{q}”.</div>}
      </div>
    </div>
  );
}
