"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Home, Inbox, HeartHandshake, DollarSign, Target, Award, FileText, ShieldCheck,
  Sparkles, FolderOpen, PenLine, Send, Package, Heart, Users, ListChecks,
  Wand2, Bot, Settings, Search, LifeBuoy, MessageSquare, CalendarDays, Layers,
  Database, Gift, BookOpen, ScrollText, Newspaper, KeyRound,
} from "lucide-react";

// Launchpad: the categorical hub. Replaces the 3 folder dropdowns that used
// to live in the topbar. Structure is enforced by the IA reorg shipped 2026-06-08:
//   1. Search input at top — filters apps by label
//   2. Smart Mode banner — the "ask Sasa to do anything" entry, prominent gradient
//   3. Sections: Open work · Money · People · Records · Studio · Sasa internals
// The Smart Mode banner is the verb home for write-intent actions. The search
// input is the verb home for read-intent. KT #142 governs the split.

type App = { label: string; href: string; icon: any; tone: string };
type Section = { key: string; title: string; apps: App[] };

const SECTIONS: Section[] = [
  {
    key: "open",
    title: "Open work",
    apps: [
      { label: "Home", href: "/", icon: Home, tone: "teal" },
      { label: "Workspace", href: "/workspace", icon: Layers, tone: "peri" },
      { label: "Tasks", href: "/tasks", icon: ListChecks, tone: "gold" },
      { label: "Calendar", href: "/calendar", icon: CalendarDays, tone: "teal" },
    ],
  },
  {
    key: "money",
    title: "Money",
    apps: [
      { label: "Donors", href: "/donors", icon: HeartHandshake, tone: "teal" },
      { label: "Donations", href: "/donations", icon: DollarSign, tone: "green" },
      { label: "Campaigns", href: "/campaigns", icon: Target, tone: "gold" },
      { label: "Grants", href: "/grants", icon: Award, tone: "peri" },
      { label: "Wishlist", href: "/wishlist", icon: Gift, tone: "gold" },
      { label: "Finance", href: "/finance", icon: DollarSign, tone: "green" },
    ],
  },
  {
    key: "people",
    title: "People",
    apps: [
      { label: "Beneficiaries", href: "/beneficiaries", icon: Heart, tone: "teal" },
      { label: "Cases", href: "/cases", icon: LifeBuoy, tone: "teal" },
      { label: "Team", href: "/team", icon: Users, tone: "peri" },
      { label: "Groups", href: "/groups", icon: MessageSquare, tone: "ink" },
    ],
  },
  {
    key: "records",
    title: "Records",
    apps: [
      { label: "Reports", href: "/reports", icon: FileText, tone: "teal" },
      { label: "Legal & Compliance", href: "/legal", icon: ShieldCheck, tone: "gold" },
      { label: "Filing", href: "/filing", icon: FolderOpen, tone: "teal" },
      { label: "Library", href: "/library", icon: BookOpen, tone: "peri" },
      { label: "Press & Media", href: "/press", icon: Newspaper, tone: "peri" },
      { label: "Resources", href: "/resources", icon: KeyRound, tone: "gold" },
    ],
  },
  {
    key: "studio",
    title: "Studio",
    apps: [
      { label: "Document Studio", href: "/studio", icon: Sparkles, tone: "peri" },
      { label: "Content", href: "/content", icon: PenLine, tone: "gold" },
      { label: "Outreach", href: "/outreach", icon: Send, tone: "teal" },
      { label: "Inventory", href: "/inventory", icon: Package, tone: "gold" },
    ],
  },
  {
    key: "sasa",
    title: "Sasa internals",
    apps: [
      { label: "Sasa audit", href: "/admin/transcripts", icon: ScrollText, tone: "teal" },
      { label: "Memory", href: "/memory", icon: Database, tone: "ink" },
      { label: "Agents", href: "/agents", icon: Bot, tone: "ink" },
      { label: "Inbox (legacy)", href: "/inbox", icon: Inbox, tone: "ink" },
      { label: "Smart Mode", href: "/smart", icon: Wand2, tone: "ink" },
    ],
  },
];

// Flat list for search.
const ALL_APPS: App[] = SECTIONS.flatMap((s) => s.apps);

export default function Launchpad() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return null;
    return ALL_APPS.filter((a) => a.label.toLowerCase().includes(n));
  }, [q]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && filtered && filtered[0]) router.push(filtered[0].href);
    if (e.key === "Escape") setQ("");
  };

  // 2026-06-09: Per Taona, category headings and the inline Smart Mode banner
  // are removed from /launchpad. Apps render in their category-grouped ORDER
  // (so the visual flow stays semantic) but as ONE continuous grid — no
  // section labels, no inter-section gaps. Smart Mode entry now lives on the
  // top bar (AppFrame), replacing the Search button. Search input here still
  // filters the app list because the launchpad IS a search surface for "open
  // the right thing for me."
  return (
    <div className="lp-wrap rise">
      {/* Search — read verb. Filters the app list, Enter opens the top hit. */}
      <div className="lp-searchrow">
        <div className="lp-search">
          <Search size={17} style={{ color: "var(--faint)", flexShrink: 0 }} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search apps…" />
        </div>
      </div>

      {(() => {
        const apps = filtered || ALL_APPS;
        if (filtered && filtered.length === 0) {
          return <div className="faint" style={{ textAlign: "center", padding: 40 }}>No app matches “{q}”.</div>;
        }
        return (
          <div className="lp-grid">
            {apps.map((a) => {
              const Ico = a.icon;
              return (
                <button key={a.href} type="button" className="lp-tile" onClick={() => router.push(a.href)}>
                  <span className={`lp-ico ${a.tone}`}><Ico size={22} /></span>
                  <span className="lp-label">{a.label}</span>
                </button>
              );
            })}
          </div>
        );
      })()}

      <style jsx>{`
        .lp-section { margin-top: 28px; }
        .lp-section:first-of-type { margin-top: 4px; }
        .lp-secrow { display: flex; align-items: center; gap: 9px; margin: 0 2px 12px; }
        .lp-sectitle { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
        .lp-smart {
          display: block;
          margin: 18px 0 6px;
          padding: 18px 22px;
          border-radius: 16px;
          background: linear-gradient(135deg, rgba(0,196,194,0.10), rgba(91,107,240,0.10));
          border: 1px solid rgba(0,196,194,0.25);
          text-decoration: none;
          color: inherit;
          transition: transform .16s var(--ease), box-shadow .16s var(--ease);
        }
        .lp-smart:hover { transform: translateY(-1px); box-shadow: 0 12px 28px rgba(0,196,194,0.16); }
        .lp-smart-head { display: flex; align-items: center; gap: 8px; color: var(--teal); font-weight: 700; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 10px; }
        .lp-smart-icon { display: inline-flex; }
        .lp-smart-prompt {
          background: rgba(255,255,255,0.7);
          border: 1px solid rgba(0,196,194,0.18);
          border-radius: 12px;
          padding: 13px 16px;
          display: flex; align-items: center; gap: 12px;
        }
        .lp-smart-ph { color: var(--muted); font-size: 15px; flex: 1; }
        .lp-smart-dispatch {
          display: inline-flex; align-items: center; gap: 6px;
          background: var(--ink); color: #fff;
          padding: 7px 12px; border-radius: 10px;
          font-weight: 600; font-size: 12.5px;
        }
        @media (max-width: 820px) { .lp-grid { grid-template-columns: repeat(3, 1fr); } }
        @media (max-width: 540px) { .lp-grid { grid-template-columns: repeat(2, 1fr); } }
      `}</style>
    </div>
  );
}
