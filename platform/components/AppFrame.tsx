"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import CommandPalette from "./CommandPalette";
import VoiceDock from "./VoiceDock";
import { logout } from "../app/login/actions";
import { TabsProvider, useTabs } from "./tabs-context";
import {
  Home, Inbox, PenLine, ListChecks, Users, Send, FolderOpen, Bot, Activity,
  HeartHandshake, DollarSign, Target, Heart, Package, Award, Megaphone, File,
  X, Plus, Search, Bell, Sparkles, ChevronDown, Wand2,
} from "lucide-react";

const ICONS: Record<string, any> = {
  home: Home, inbox: Inbox, pen: PenLine, check: ListChecks, users: Users, send: Send,
  folder: FolderOpen, bot: Bot, activity: Activity, heart: HeartHandshake, dollar: DollarSign,
  target: Target, life: Heart, box: Package, award: Award, mega: Megaphone, file: File, spark: Sparkles,
};
const Icon = ({ name, size = 16 }: { name: string; size?: number }) => { const C = ICONS[name] || File; return <C size={size} />; };
const BRAND_DOT: Record<string, string> = { nisria: "var(--nisria)", maisha: "var(--maisha)", ahadi: "var(--ahadi)" };

const PILLS = [
  { href: "/", label: "Mission Control", icon: "home" },
  { href: "/inbox", label: "Inbox", icon: "inbox" },
  { href: "/content", label: "Content", icon: "pen" },
  { href: "/library", label: "Library", icon: "folder" },
  { href: "/tasks", label: "Tasks", icon: "check" },
  { href: "/agents", label: "Agents", icon: "bot" },
];
const RECORDS = [
  { href: "/donors", label: "Donors", icon: "heart" },
  { href: "/donations", label: "Donations", icon: "dollar" },
  { href: "/campaigns", label: "Campaigns", icon: "target" },
  { href: "/beneficiaries", label: "Beneficiaries", icon: "life" },
  { href: "/inventory", label: "Inventory", icon: "box" },
  { href: "/grants", label: "Grants", icon: "award" },
  { href: "/finance", label: "Finance", icon: "dollar" },
  { href: "/outreach", label: "Outreach", icon: "mega" },
  { href: "/team", label: "Team", icon: "users" },
  { href: "/newsletter", label: "Newsletter", icon: "send" },
];

function TabBar() {
  const { tabs, active, closeTab } = useTabs();
  const router = useRouter();
  if (!tabs.length) return null; // bar only exists when records are open
  return (
    <div className="tabbar">
      {tabs.map((t) => (
        <div key={t.href} className={`tab ${active === t.href ? "active" : ""}`} onClick={() => router.push(t.href)}
          onAuxClick={(e) => { if (e.button === 1) closeTab(t.href); }}>
          {t.brand ? <span className="dot" style={{ background: BRAND_DOT[t.brand] || "var(--muted)" }} /> : <span className="ico"><Icon name={t.icon} size={13} /></span>}
          <span className="label">{t.title}</span>
          <span className="x" onClick={(e) => { e.stopPropagation(); closeTab(t.href); }}><X size={12} /></span>
        </div>
      ))}
    </div>
  );
}

function TopNav() {
  const path = usePathname();
  const [recOpen, setRecOpen] = useState(false);
  const [avOpen, setAvOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const avRef = useRef<HTMLDivElement>(null);
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const recActive = RECORDS.some((r) => isActive(r.href));

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setRecOpen(false);
      if (avRef.current && !avRef.current.contains(e.target as Node)) setAvOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <div className="topnav">
      <div className="topnav-inner">
        <Link href="/" className="brand"><img className="logo" src="/logo.png" alt="Nisria" /></Link>
        <div className="navpills">
          {PILLS.map((p) => (
            <Link key={p.href} href={p.href} className={`navpill ${isActive(p.href) ? "active" : ""}`}>
              <span className="ico"><Icon name={p.icon} /></span> {p.label}
            </Link>
          ))}
          <div className="dropwrap" ref={ref}>
            <button className={`navpill ${recActive ? "active" : ""}`} onClick={() => setRecOpen((o) => !o)}>
              More <ChevronDown size={14} className="caret" />
            </button>
            {recOpen && (
              <div className="dropmenu">
                {RECORDS.map((r) => (
                  <Link key={r.href} href={r.href} className={isActive(r.href) ? "active" : ""} onClick={() => setRecOpen(false)}>
                    <span className="ico"><Icon name={r.icon} /></span> {r.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="nav-right">
          <Link href="/smart" className={`navpill smartbtn ${path === "/smart" ? "active" : ""}`} title="Smart Mode"><Wand2 size={16} /> Smart</Link>
          <button className="iconbtn" title="Search (⌘K)" onClick={() => window.dispatchEvent(new Event("open-cmdk"))}><Search size={17} /></button>
          <Link href="/" className="iconbtn" title="What needs you"><Bell size={17} /></Link>
          <button className="iconbtn dark" title="Ask Sasa" onClick={() => window.dispatchEvent(new Event("open-sasa"))}><Sparkles size={17} /></button>
          <div className="dropwrap" ref={avRef}>
            <button className="avatar" title="Nur" onClick={() => setAvOpen((o) => !o)}>N</button>
            {avOpen && (
              <div className="dropmenu" style={{ right: 0, left: "auto" }}>
                <div style={{ padding: "6px 11px 8px", borderBottom: "1px solid var(--line)", marginBottom: 4 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Nur M'nasria</div>
                  <div className="faint" style={{ fontSize: 11.5 }}>By Nisria Inc</div>
                </div>
                <form action={logout}><button type="submit" style={{ width: "100%", textAlign: "left", background: "none", border: 0, padding: "9px 11px", borderRadius: 11, color: "var(--ink-2)", cursor: "pointer", fontSize: 13.5, fontFamily: "inherit" }}>Sign out</button></form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Chrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="appshell">
      <CommandPalette />
      <TopNav />
      <TabBar />
      <main className="main">{children}</main>
      <VoiceDock />
    </div>
  );
}

export default function AppFrame({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === "/login") return <>{children}</>;
  return (
    <TabsProvider>
      <Chrome>{children}</Chrome>
    </TabsProvider>
  );
}
