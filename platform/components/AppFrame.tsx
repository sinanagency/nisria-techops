"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import CommandPalette from "./CommandPalette";
import SpaceSwipe from "./SpaceSwipe";
import MissionControl from "./MissionControl";
import ContextBar from "./ContextBar";
import VoiceDock from "./VoiceDock";
import FocusSheetHost from "./FocusSheet";
import SasaTour from "./SasaTour";
import { logout } from "../app/login/actions";
import { TabsProvider, useTabs } from "./tabs-context";
import ToastProvider from "./Toast";
import {
  Home, Inbox, PenLine, ListChecks, Users, Send, FolderOpen, Bot, Activity,
  HeartHandshake, DollarSign, Target, Heart, Package, Award, Megaphone, File,
  X, Plus, Sparkles, ChevronLeft, Settings, ShieldCheck, LayoutGrid, Layers, Compass, User, CalendarDays, LifeBuoy, Gift, Search,
} from "lucide-react";

export type NavUser = { name: string; org: string; initials: string; role: string } | null;

const ICONS: Record<string, any> = {
  home: Home, inbox: Inbox, pen: PenLine, check: ListChecks, users: Users, send: Send,
  folder: FolderOpen, bot: Bot, activity: Activity, heart: HeartHandshake, dollar: DollarSign,
  target: Target, life: Heart, box: Package, award: Award, mega: Megaphone, file: File, spark: Sparkles,
  shield: ShieldCheck, calendar: CalendarDays, lifebuoy: LifeBuoy, gift: Gift,
  workspace: Layers, tasks: ListChecks,
};
const Icon = ({ name, size = 16 }: { name: string; size?: number }) => { const C = ICONS[name] || File; return <C size={size} />; };
const BRAND_DOT: Record<string, string> = { nisria: "var(--nisria)", maisha: "var(--maisha)", ahadi: "var(--ahadi)" };

// 4 daily-touched surfaces, always visible. Everything else lives in the
// Launchpad (⊞ All apps) per the IA reorg: a pill must be DAILY, not just
// important. Inbox retires here — Workspace IS the one-brain inbox by Law 7,
// and /inbox redirects to /workspace at the page level.
const PILLS = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/workspace", label: "Workspace", icon: "workspace" },
  { href: "/tasks", label: "Tasks", icon: "tasks" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
];
// Folder dropdowns retired in the A-lean IA reorg (commit df02916). The
// categorical map now lives inside Launchpad.tsx (`SECTIONS`). Kept here as a
// fossil in git history; revive by reading the predecessor commit if folders
// ever come back to the topbar.

function TabBar() {
  const { tabs, active, closeTab, sheets, restoreSheet, closeSheet } = useTabs();
  const router = useRouter();
  // minimized focus sheets show as real tabs alongside route tabs
  const minimized = sheets.filter((s) => s.minimized);
  const activeSheet = sheets.find((s) => !s.minimized);
  if (!tabs.length && !sheets.length) return null; // bar only exists when something is open
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
      {minimized.map((s) => (
        <div key={s.id} className="tab" onClick={() => restoreSheet(s.id)}
          onAuxClick={(e) => { if (e.button === 1) closeSheet(s.id); }}>
          {s.brand ? <span className="dot" style={{ background: BRAND_DOT[s.brand] || "var(--muted)" }} /> : <span className="ico"><Icon name={s.icon} size={13} /></span>}
          <span className="label">{s.title}</span>
          <span className="x" onClick={(e) => { e.stopPropagation(); closeSheet(s.id); }}><X size={12} /></span>
        </div>
      ))}
      {/* the currently open sheet also reads as the active tab while focused */}
      {activeSheet && (
        <div key={activeSheet.id} className="tab active" onClick={() => restoreSheet(activeSheet.id)}
          onAuxClick={(e) => { if (e.button === 1) closeSheet(activeSheet.id); }}>
          {activeSheet.brand ? <span className="dot" style={{ background: BRAND_DOT[activeSheet.brand] || "var(--muted)" }} /> : <span className="ico"><Icon name={activeSheet.icon} size={13} /></span>}
          <span className="label">{activeSheet.title}</span>
          <span className="x" onClick={(e) => { e.stopPropagation(); closeSheet(activeSheet.id); }}><X size={12} /></span>
        </div>
      )}
    </div>
  );
}

function TopNav({ user }: { user: NavUser }) {
  const path = usePathname();
  const [avOpen, setAvOpen] = useState(false);
  const avRef = useRef<HTMLDivElement>(null);
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const router = useRouter();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
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
        <div className="navpills">
          {PILLS.map((p) => (
            <Link key={p.href} href={p.href} className={`navpill ${isActive(p.href) ? "active" : ""}`}>
              <span className="ico"><Icon name={p.icon} /></span> {p.label}
            </Link>
          ))}
        </div>
        <div className="nav-right">
          {/* All apps: the categorical hub. Everything outside the 4 daily
              pills lives inside Launchpad, grouped by section. Kept on the
              .smartbtn class because the gradient teal IS the brand prominence
              and the launcher is now the most-used non-pill chip. */}
          <Link href="/launchpad" className={`navpill smartbtn ${path === "/launchpad" ? "active" : ""}`} title="All apps · Launchpad">
            <LayoutGrid size={16} /> All apps
          </Link>
          {/* Search: the read verb. Triggers CommandPalette (also bound to ⌘K
              globally). Smart Mode (the write/do verb) lives inside the
              Launchpad sheet, not here — KT #142. */}
          <button
            className="navpill searchbtn"
            title="Search the platform (⌘K)"
            aria-label="Search"
            onClick={() => window.dispatchEvent(new Event("open-cmdk"))}
          >
            <Search size={15} /> Search
            <span className="kbd">⌘K</span>
          </button>
          <div className="dropwrap" ref={avRef}>
            <button className="avatar" title={user?.name || "Account"} aria-label="Account menu" onClick={() => setAvOpen((o) => !o)}>{user?.initials || "?"}</button>
            {avOpen && (
              <div className="dropmenu" style={{ right: 0, left: "auto" }}>
                <div style={{ padding: "6px 11px 8px", borderBottom: "1px solid var(--hairline)", marginBottom: 4 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{user?.name || "Signed in"}</div>
                  <div className="faint" style={{ fontSize: 11.5 }}>{user?.org || "By Nisria Inc"}{user?.role ? ` · ${user.role[0].toUpperCase()}${user.role.slice(1)}` : ""}</div>
                </div>
                <Link href="/profile" className={isActive("/profile") ? "active" : ""} onClick={() => setAvOpen(false)}><span className="ico"><User size={15} /></span> Profile</Link>
                <button className="dropbtn" onClick={() => { setAvOpen(false); window.dispatchEvent(new Event("start-sasa-tour")); }}><span className="ico"><Compass size={15} /></span> Tour with Sasa</button>
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

function Chrome({ children, user }: { children: React.ReactNode; user: NavUser }) {
  return (
    <div className="appshell">
      <CommandPalette />
      <TopNav user={user} />
      <ContextBar />
      <TabBar />
      <main className="main">{children}</main>
      <FocusSheetHost />
      <SpaceSwipe />
      <MissionControl />
      <VoiceDock />
      {/* Sasa meets the founder on first login, walks the platform, then asks for what she needs. */}
      <SasaTour autoStart={user?.role === "founder"} />
    </div>
  );
}

export default function AppFrame({ children, user = null }: { children: React.ReactNode; user?: NavUser }) {
  const path = usePathname();
  // ToastProvider wraps everything (including /login) so any action anywhere can
  // confirm itself (Law 6). It lives above the routed content, so it survives
  // the route refresh that clears a resolved card.
  if (path === "/login" || path === "/maintenance") return <ToastProvider>{children}</ToastProvider>;
  return (
    <ToastProvider>
      <TabsProvider>
        <Chrome user={user}>{children}</Chrome>
      </TabsProvider>
    </ToastProvider>
  );
}
