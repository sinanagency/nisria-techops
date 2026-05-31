"use client";

import { useEffect, useRef, useState } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useTabs } from "./tabs-context";
import { DocReaderBody } from "./DocReader";
import {
  LayoutDashboard, Sparkles, Inbox, PenLine, ListChecks, Users, Send,
  HeartHandshake, DollarSign, Target, Heart, Package, Award,
  FileText, ShieldCheck, FolderOpen,
} from "lucide-react";

const DESTS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/assistant", label: "AI Assistant", icon: Sparkles },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/content", label: "Content", icon: PenLine },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/team", label: "Team", icon: Users },
  { href: "/outreach", label: "Outreach", icon: Send },
  { href: "/donors", label: "Donors", icon: HeartHandshake },
  { href: "/donations", label: "Donations", icon: DollarSign },
  { href: "/campaigns", label: "Campaigns", icon: Target },
  { href: "/beneficiaries", label: "Beneficiaries", icon: Heart },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/grants", label: "Grants", icon: Award },
];

const ACTIONS = [
  { href: "/assistant", label: "Ask the AI assistant", icon: Sparkles },
  { href: "/content", label: "Create a post", icon: PenLine },
  { href: "/tasks", label: "Dispatch a task", icon: ListChecks },
];

// THE ⌘K PALETTE (R-recur-2 fix). It previously used `Command.Dialog`, whose
// Radix portal renders the panel as a SIBLING of the overlay, so the overlay's
// `grid place-items` never positioned the panel: it fell into document flow and
// rendered bottom-left, uncentered (the recurring bug). This now renders its
// OWN overlay with the EXACT structure of the Modal / FocusTab primitives:
// a fixed inset:0 + grid place-items:center scrim with the OPAQUE panel as a
// CHILD, so it is truly centered and crisp every time, with no dependence on a
// portal we do not control. The `Command` engine (filter + keyboard list) is
// kept; only the broken Dialog wrapper is dropped.
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [docs, setDocs] = useState<any[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { openSheet } = useTabs();

  // live document search (title + extracted text) as you type — debounced
  useEffect(() => {
    if (q.trim().length < 2) { setDocs([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/documents/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => r.json())
        .then((d) => setDocs(d.results || []))
        .catch(() => setDocs([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const openDoc = (d: any) => {
    setOpen(false);
    openSheet({ id: `doc:${d.id}`, title: d.title, icon: "file", width: 760, render: () => <DocReaderBody id={d.id} /> });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener("keydown", onKey);
    // allow other components (the top-nav search button) to open it
    const openEvt = () => setOpen(true);
    window.addEventListener("open-cmdk", openEvt);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("open-cmdk", openEvt);
    };
  }, [open]);

  // lock background scroll + focus the input while open, mirroring the Modal.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => {
      panelRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    }, 0);
    return () => { document.body.style.overflow = prev; clearTimeout(t); };
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  if (!open) return null;

  const n = q.trim().toLowerCase();
  const dests = n ? DESTS.filter((d) => d.label.toLowerCase().includes(n)) : DESTS;
  const actions = n ? ACTIONS.filter((a) => a.label.toLowerCase().includes(n)) : ACTIONS;

  return (
    // overlay: fixed, full-screen, grid-centered (same as Modal/FocusTab). Click
    // the scrim to dismiss; the panel stops propagation so inner clicks stay.
    <div className="cmdk-overlay" onClick={() => { setOpen(false); setQ(""); }}>
      <Command
        ref={panelRef}
        label="Command palette"
        className="cmdk-panel"
        role="dialog"
        aria-modal="true"
        shouldFilter={false}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <Command.Input value={q} onValueChange={setQ} placeholder="Search documents, pages and actions…" />
        <Command.List>
          <Command.Empty>No results.</Command.Empty>
          {docs.length > 0 && (
            <Command.Group heading="Documents">
              {docs.map((d) => (
                <Command.Item key={d.id} value={`doc-${d.id}`} onSelect={() => openDoc(d)}>
                  {d.folder === "Admin & Compliance" ? <ShieldCheck size={16} /> : <FileText size={16} />}
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span>
                    {d.snippet && <span className="faint" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.snippet}</span>}
                  </span>
                  {d.inBody && <span className="badge teal" style={{ marginLeft: "auto", fontSize: 9.5 }}>in text</span>}
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {actions.length > 0 && (
            <Command.Group heading="Actions">
              {actions.map((a) => (
                <Command.Item key={a.label} value={`act-${a.label}`} onSelect={() => go(a.href)}>
                  <a.icon size={16} /> {a.label}
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {dests.length > 0 && (
            <Command.Group heading="Go to">
              {dests.map((d) => (
                <Command.Item key={d.href} value={`nav-${d.label}`} onSelect={() => go(d.href)}>
                  <d.icon size={16} /> {d.label}
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
