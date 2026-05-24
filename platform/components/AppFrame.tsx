"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { logout } from "../app/login/actions";
import CommandPalette from "./CommandPalette";
import VoiceDock from "./VoiceDock";
import { TabsProvider, useTabs } from "./tabs-context";
import {
  Home, Sparkles, Inbox, PenLine, ListChecks, Users, Send, FolderOpen, Bot, Activity,
  HeartHandshake, DollarSign, Target, Heart, Package, Award, Megaphone, File, X, Plus,
  Command as CmdIcon,
} from "lucide-react";

const ICONS: Record<string, any> = {
  home: Home, spark: Sparkles, inbox: Inbox, pen: PenLine, check: ListChecks, users: Users,
  send: Send, folder: FolderOpen, bot: Bot, activity: Activity, heart: HeartHandshake,
  dollar: DollarSign, target: Target, life: Heart, box: Package, award: Award, mega: Megaphone, file: File,
};
const Icon = ({ name, size = 17 }: { name: string; size?: number }) => {
  const C = ICONS[name] || File;
  return <C size={size} />;
};

const BRAND_DOT: Record<string, string> = { nisria: "var(--nisria)", maisha: "var(--maisha)", ahadi: "var(--ahadi)" };

const TOP = [{ href: "/", label: "Mission Control", icon: "home" }];
const RUN = [
  { href: "/inbox", label: "Inbox", icon: "inbox" },
  { href: "/content", label: "Content", icon: "pen" },
  { href: "/tasks", label: "Tasks", icon: "check" },
  { href: "/team", label: "Team", icon: "users" },
  { href: "/newsletter", label: "Newsletter", icon: "send" },
  { href: "/assistant", label: "Assistant", icon: "spark" },
];
const RECORDS = [
  { href: "/donors", label: "Donors", icon: "heart" },
  { href: "/donations", label: "Donations", icon: "dollar" },
  { href: "/campaigns", label: "Campaigns", icon: "target" },
  { href: "/beneficiaries", label: "Beneficiaries", icon: "life" },
  { href: "/inventory", label: "Inventory", icon: "box" },
  { href: "/grants", label: "Grants", icon: "award" },
  { href: "/outreach", label: "Outreach", icon: "mega" },
];

function NavLink({ href, label, icon, active }: { href: string; label: string; icon: string; active: boolean }) {
  return (
    <Link href={href} className={active ? "active" : ""}>
      <span className="ico"><Icon name={icon} /></span> {label}
    </Link>
  );
}

function TabBar() {
  const { tabs, active, closeTab } = useTabs();
  const router = useRouter();
  return (
    <div className="tabbar">
      {tabs.map((t) => (
        <div
          key={t.href}
          className={`tab ${active === t.href ? "active" : ""}`}
          onClick={() => router.push(t.href)}
          onAuxClick={(e) => { if (e.button === 1) closeTab(t.href); }}
        >
          {t.brand
            ? <span className="dot" style={{ background: BRAND_DOT[t.brand] || "var(--muted)" }} />
            : <span className="ico"><Icon name={t.icon} size={14} /></span>}
          <span className="label">{t.title}</span>
          {t.href !== "/" && (
            <span className="x" onClick={(e) => { e.stopPropagation(); closeTab(t.href); }}><X size={13} /></span>
          )}
        </div>
      ))}
      <div className="tab-add" title="Open (⌘K)" onClick={() => window.dispatchEvent(new Event("open-cmdk"))}>
        <Plus size={16} />
      </div>
    </div>
  );
}

function Chrome({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <div className="shell">
      <CommandPalette />
      <aside className="rail">
        <div className="brand"><span className="mark">N</span> Nisria</div>
        <button className="cmdk-hint" onClick={() => window.dispatchEvent(new Event("open-cmdk"))}>
          <CmdIcon size={14} /> Search… <kbd>⌘K</kbd>
        </button>
        <nav className="nav">
          {TOP.map((n) => <NavLink key={n.href} {...n} active={isActive(n.href)} />)}
        </nav>
        <div className="nav-section">
          <div className="lbl">Run the org</div>
          <nav className="nav">{RUN.map((n) => <NavLink key={n.href} {...n} active={isActive(n.href)} />)}</nav>
        </div>
        <div className="nav-section">
          <div className="lbl">Records</div>
          <nav className="nav">{RECORDS.map((n) => <NavLink key={n.href} {...n} active={isActive(n.href)} />)}</nav>
        </div>
        <div className="foot">
          <form action={logout}><button type="submit">Sign out</button></form>
          <div style={{ marginTop: 6 }}>Command Center</div>
        </div>
      </aside>

      <div className="workspace">
        <TabBar />
        <main className="main">{children}</main>
      </div>
      <VoiceDock />
    </div>
  );
}

export default function AppFrame({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  // login renders bare, no chrome / tabs / dock
  if (path === "/login") return <>{children}</>;
  return (
    <TabsProvider>
      <Chrome>{children}</Chrome>
    </TabsProvider>
  );
}
