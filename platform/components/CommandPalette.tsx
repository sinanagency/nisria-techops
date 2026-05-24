"use client";

import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard, Sparkles, Inbox, PenLine, ListChecks, Users, Send,
  HeartHandshake, DollarSign, Target, Heart, Package, Award, Megaphone,
} from "lucide-react";

const DESTS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/assistant", label: "AI Assistant", icon: Sparkles },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/content", label: "Content", icon: PenLine },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/team", label: "Team", icon: Users },
  { href: "/newsletter", label: "Newsletter", icon: Send },
  { href: "/donors", label: "Donors", icon: HeartHandshake },
  { href: "/donations", label: "Donations", icon: DollarSign },
  { href: "/campaigns", label: "Campaigns", icon: Target },
  { href: "/beneficiaries", label: "Beneficiaries", icon: Heart },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/grants", label: "Grants", icon: Award },
  { href: "/outreach", label: "Outreach", icon: Megaphone },
];

const ACTIONS = [
  { href: "/assistant", label: "Ask the AI assistant", icon: Sparkles },
  { href: "/content", label: "Create a post", icon: PenLine },
  { href: "/tasks", label: "Dispatch a task", icon: ListChecks },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    // allow other components to open it
    const openEvt = () => setOpen(true);
    window.addEventListener("open-cmdk", openEvt);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("open-cmdk", openEvt);
    };
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <Command.Dialog open={open} onOpenChange={setOpen} label="Command palette" overlayClassName="cmdk-overlay" contentClassName="cmdk-panel">
      <Command.Input placeholder="Search or run a command…" />
      <Command.List>
        <Command.Empty>No results.</Command.Empty>
        <Command.Group heading="Actions">
          {ACTIONS.map((a) => (
            <Command.Item key={a.label} value={a.label} onSelect={() => go(a.href)}>
              <a.icon size={16} /> {a.label}
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="Go to">
          {DESTS.map((d) => (
            <Command.Item key={d.href} value={d.label} onSelect={() => go(d.href)}>
              <d.icon size={16} /> {d.label}
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
