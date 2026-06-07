"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import CommandPalette from "./CommandPalette";
import SpaceSwipe from "./SpaceSwipe";
import MissionControl from "./MissionControl";
import ContextBar from "./ContextBar";
import VoiceDock from "./VoiceDock";
import ActivityChip from "./ActivityChip";
import FocusSheetHost from "./FocusSheet";
import SasaTour from "./SasaTour";
import { logout } from "../app/login/actions";
import { TabsProvider, useTabs } from "./tabs-context";
import ToastProvider from "./Toast";
import {
  Home, Inbox, PenLine, ListChecks, Users, Send, FolderOpen, Bot, Activity,
  HeartHandshake, DollarSign, Target, Heart, Package, Award, Megaphone, File,
  X, Plus, Sparkles, ChevronDown, ChevronLeft, Wand2, Settings, ShieldCheck, LayoutGrid, Layers, HelpCircle, Compass, User, CalendarDays, LifeBuoy, Gift,
} from "lucide-react";

export type NavUser = { name: string; org: string; initials: string; role: string } | null;

const ICONS: Record<string, any> = {
  home: Home, inbox: Inbox, pen: PenLine, check: ListChecks, users: Users, send: Send,
  folder: FolderOpen, bot: Bot, activity: Activity, heart: HeartHandshake, dollar: DollarSign,
  target: Target, life: Heart, box: Package, award: Award, mega: Megaphone, file: File, spark: Sparkles,
  shield: ShieldCheck, calendar: CalendarDays, lifebuoy: LifeBuoy, gift: Gift,
};
const Icon = ({ name, size = 16 }: { name: string; size?: number }) => { const C = ICONS[name] || File; return <C size={size} />; };
const BRAND_DOT: Record<string, string> = { nisria: "var(--nisria)", maisha: "var(--maisha)", ahadi: "var(--ahadi)" };

const PILLS = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/inbox", label: "Inbox", icon: "inbox" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
];
const MENU = [
  { group: "Money", short: "Money", items: [
    { href: "/donors", label: "Donors", icon: "heart" },
    { href: "/donations", label: "Donations", icon: "dollar" },
    { href: "/campaigns", label: "Campaigns", icon: "target" },
    { href: "/grants", label: "Grants", icon: "award" },
    { href: "/wishlist", label: "Wishlist", icon: "gift" },
    { href: "/finance", label: "Finance", icon: "dollar" },
    { href: "/reports", label: "Reports", icon: "file" },
    { href: "/legal", label: "Legal & Compliance", icon: "shield" },
  ]},
  { group: "Studio", short: "Studio", items: [
    { href: "/studio", label: "Document Studio", icon: "spark" },
    { href: "/filing", label: "Filing", icon: "file" },
    { href: "/content", label: "Content", icon: "pen" },
    { href: "/library", label: "Library", icon: "folder" },
    { href: "/outreach", label: "Outreach", icon: "send" },
    { href: "/inventory", label: "Inventory", icon: "box" },
  ]},
  { group: "People", short: "People", items: [
    { href: "/beneficiaries", label: "Beneficiaries", icon: "life" },
    { href: "/cases", label: "Cases", icon: "lifebuoy" },
    { href: "/team", label: "Team", icon: "users" },
    { href: "/groups", label: "Groups", icon: "bot" },
  ]},
];
const RECORDS = MENU.flatMap((g) => g.items);

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
          <Link href="/launchpad" className={`iconbtn ${path === "/launchpad" ? "active" : ""}`} title="Launchpad: all apps"><LayoutGrid size={17} /></Link>
          <Link href="/workspace" className={`iconbtn ${path === "/workspace" ? "active" : ""}`} title="Workspace: open work + live ops"><Layers size={17} /></Link>
          <Link href="/smart" className={`navpill smartbtn ${path === "/smart" ? "active" : ""}`} title="Smart Mode (ask anything)"><Wand2 size={16} /> Smart</Link>
          <button className="iconbtn" aria-label="Take the tour with Sasa" title="Tour with Sasa" onClick={() => window.dispatchEvent(new Event("start-sasa-tour"))}><HelpCircle size={17} /></button>
          <ActivityChip />
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
  if (path === "/login") return <ToastProvider>{children}</ToastProvider>;
  return (
    <ToastProvider>
      <TabsProvider>
        <Chrome user={user}>{children}</Chrome>
      </TabsProvider>
    </ToastProvider>
  );
}
