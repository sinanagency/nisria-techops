"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import CommandPalette from "./CommandPalette";
import VoiceDock from "./VoiceDock";
import NotifBell from "./NotifBell";
import { logout } from "../app/login/actions";
import { TabsProvider, useTabs } from "./tabs-context";
import {
  Home, Inbox, PenLine, ListChecks, Users, Send, FolderOpen, Bot, Activity,
  HeartHandshake, DollarSign, Target, Heart, Package, Award, Megaphone, File,
  X, Plus, Search, Bell, Sparkles, ChevronDown, ChevronLeft, Wand2, Settings,
} from "lucide-react";

const ICONS: Record<string, any> = {
  home: Home, inbox: Inbox, pen: PenLine, check: ListChecks, users: Users, send: Send,
  folder: FolderOpen, bot: Bot, activity: Activity, heart: HeartHandshake, dollar: DollarSign,
  target: Target, life: Heart, box: Package, award: Award, mega: Megaphone, file: File, spark: Sparkles,
};
const Icon = ({ name, size = 16 }: { name: string; size?: number }) => { const C = ICONS[name] || File; return <C size={size} />; };
const BRAND_DOT: Record<string, string> = { nisria: "var(--nisria)", maisha: "var(--maisha)", ahadi: "var(--ahadi)" };

const PILLS = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/inbox", label: "Inbox", icon: "inbox" },
];
const MENU = [
  { group: "Money", short: "Money", items: [
    { href: "/donors", label: "Donors", icon: "heart" },
    { href: "/donations", label: "Donations", icon: "dollar" },
    { href: "/campaigns", label: "Campaigns", icon: "target" },
    { href: "/grants", label: "Grants", icon: "award" },
    { href: "/finance", label: "Finance", icon: "dollar" },
    { href: "/reports", label: "Reports", icon: "file" },
  ]},
  { group: "Studio", short: "Studio", items: [
    { href: "/studio", label: "Document Studio", icon: "spark" },
    { href: "/content", label: "Content", icon: "pen" },
    { href: "/library", label: "Library", icon: "folder" },
    { href: "/newsletter", label: "Newsletter", icon: "send" },
    { href: "/inventory", label: "Inventory", icon: "box" },
    { href: "/outreach", label: "Outreach", icon: "mega" },
  ]},
  { group: "People", short: "People", items: [
    { href: "/beneficiaries", label: "Beneficiaries", icon: "life" },
    { href: "/team", label: "Team", icon: "users" },
  ]},
];
const RECORDS = MENU.flatMap((g) => g.items);

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
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [avOpen, setAvOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const avRef = useRef<HTMLDivElement>(null);
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const router = useRouter();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenCat(null);
      if (avRef.current && !avRef.current.contains(e.target as Node)) setAvOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <div className="topnav">
      <div className="topnav-inner">
        <button className="iconbtn backbtn" onClick={() => router.back()} title="Back"><ChevronLeft size={18} /></button>
        <Link href="/" className="brand"><img className="logo" src="/logo.png" alt="Nisria" /></Link>
        <div className="navpills" ref={ref}>
          {PILLS.map((p) => (
            <Link key={p.href} href={p.href} className={`navpill ${isActive(p.href) ? "active" : ""}`}>
              <span className="ico"><Icon name={p.icon} /></span> {p.label}
            </Link>
          ))}
          {MENU.map((g) => {
            const gActive = g.items.some((i) => isActive(i.href));
            const open = openCat === g.group;
            return (
              <div className="dropwrap" key={g.group}>
                <button className={`navpill ${gActive ? "active" : ""}`} onClick={() => setOpenCat(open ? null : g.group)}>
                  {g.short} <ChevronDown size={14} className="caret" />
                </button>
                {open && (
                  <div className="dropmenu">
                    {g.items.map((r) => (
                      <Link key={r.href} href={r.href} className={isActive(r.href) ? "active" : ""} onClick={() => setOpenCat(null)}>
                        <span className="ico"><Icon name={r.icon} /></span> {r.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="nav-right">
          <button className="omnibox" title="Search (⌘K)" onClick={() => window.dispatchEvent(new Event("open-cmdk"))}>
            <Search size={15} /> <span>Search anything…</span> <kbd>⌘K</kbd>
          </button>
          <Link href="/smart" className={`navpill smartbtn ${path === "/smart" ? "active" : ""}`} title="Smart Mode"><Wand2 size={16} /> Smart</Link>
          <NotifBell />
          <div className="dropwrap" ref={avRef}>
            <button className="avatar" title="Nur" onClick={() => setAvOpen((o) => !o)}>N</button>
            {avOpen && (
              <div className="dropmenu" style={{ right: 0, left: "auto" }}>
                <div style={{ padding: "6px 11px 8px", borderBottom: "1px solid var(--hairline)", marginBottom: 4 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Nur M'nasria</div>
                  <div className="faint" style={{ fontSize: 11.5 }}>By Nisria Inc</div>
                </div>
                <div className="droplbl">System</div>
                <Link href="/agents" className={isActive("/agents") ? "active" : ""} onClick={() => setAvOpen(false)}><span className="ico"><Bot size={15} /></span> Agents</Link>
                <Link href="/settings" className={isActive("/settings") ? "active" : ""} onClick={() => setAvOpen(false)}><span className="ico"><Settings size={15} /></span> Settings</Link>
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
