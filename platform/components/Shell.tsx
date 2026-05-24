"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { logout } from "../app/login/actions";
import CommandPalette from "./CommandPalette";
import {
  LayoutDashboard, Sparkles, Inbox, PenLine, ListChecks, Users, Send,
  HeartHandshake, DollarSign, Target, Heart, Package, Award, Megaphone, Command as CmdIcon,
} from "lucide-react";

const TOP = [{ href: "/", label: "Dashboard", icon: LayoutDashboard }];
const RUN = [
  { href: "/assistant", label: "AI Assistant", icon: Sparkles },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/content", label: "Content", icon: PenLine },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/team", label: "Team", icon: Users },
  { href: "/newsletter", label: "Newsletter", icon: Send },
];
const RECORDS = [
  { href: "/donors", label: "Donors", icon: HeartHandshake },
  { href: "/donations", label: "Donations", icon: DollarSign },
  { href: "/campaigns", label: "Campaigns", icon: Target },
  { href: "/beneficiaries", label: "Beneficiaries", icon: Heart },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/grants", label: "Grants", icon: Award },
  { href: "/outreach", label: "Outreach", icon: Megaphone },
];

function NavLink({ href, label, icon: Icon, active }: any) {
  return (
    <Link href={href} className={active ? "active" : ""}>
      <span className="ico"><Icon size={17} /></span> {label}
    </Link>
  );
}

export default function Shell({ title, sub, action, children }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode }) {
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

      <main className="main">
        <div className="pagehead rise">
          <div>
            <h1>{title}</h1>
            {sub && <div className="sub">{sub}</div>}
          </div>
          {action}
        </div>
        <div className="content rise">{children}</div>
      </main>
    </div>
  );
}
