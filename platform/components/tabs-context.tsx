"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

export type Tab = { href: string; title: string; icon: string; brand?: string };

// A FOCUS TAB is content you OPEN in a big centered overlay (a grant package,
// a full reply, a profile, a document, a report preview). It is NOT a route —
// it lives in memory. Minimizing it drops a real tab into the strip; clicking
// that tab reopens the SAME tab; closing discards it. One simple model, no
// window manager. THIS is the single primitive every "open into a tab" routes
// through (FocusSheet.tsx renders it).
//
// `group` + `siblings` power the prev/next arrows: when a Focus Tab belongs to a
// set (the next "ready" grant, the next Needs-You reply), the header shows arrows
// that swap to the neighbouring sibling WITHOUT closing. A sibling lazily builds
// its own OpenSheet payload so bodies stay fresh.
export type Sibling = { id: string; build: () => OpenSheet };
export type Sheet = {
  id: string;
  title: string;
  icon: string;
  brand?: string;
  width?: number;
  // render the body fresh each time it opens (so it always reflects latest props)
  render: () => React.ReactNode;
  // optional header chips and footer actions
  titleExtra?: React.ReactNode;
  footer?: React.ReactNode;
  // sibling navigation (prev/next within the same set, e.g. ready grants)
  group?: string;
  siblings?: Sibling[];
  minimized: boolean;
};

export type OpenSheet = Omit<Sheet, "minimized">;

// The three SPACES are not tabbed — they are how you navigate. Everything else you
// open (a module, a record, a document) becomes a persistent Workspace tab, so the
// Workspace is a real browser-like surface that accumulates your open apps.
const NAV_SECTIONS = new Set(["/", "/launchpad", "/workspace", "/login"]);

// Top-level module roots → tab title + icon (so an opened app reads "Finance", not "finance").
const ROOT_SECTION: Record<string, { icon: string; label: string }> = {
  "/inbox": { icon: "inbox", label: "Inbox" },
  "/tasks": { icon: "check", label: "Tasks" },
  "/donors": { icon: "heart", label: "Donors" },
  "/donations": { icon: "dollar", label: "Donations" },
  "/campaigns": { icon: "target", label: "Campaigns" },
  "/grants": { icon: "award", label: "Grants" },
  "/finance": { icon: "dollar", label: "Finance" },
  "/reports": { icon: "file", label: "Reports" },
  "/legal": { icon: "shield", label: "Legal & Compliance" },
  "/studio": { icon: "spark", label: "Document Studio" },
  "/filing": { icon: "folder", label: "Filing" },
  "/content": { icon: "pen", label: "Content" },
  "/library": { icon: "folder", label: "Library" },
  "/newsletter": { icon: "send", label: "Newsletter" },
  "/inventory": { icon: "box", label: "Inventory" },
  "/outreach": { icon: "mega", label: "Outreach" },
  "/beneficiaries": { icon: "life", label: "Beneficiaries" },
  "/team": { icon: "users", label: "Team" },
  "/agents": { icon: "bot", label: "Agents" },
  "/settings": { icon: "file", label: "Settings" },
  "/smart": { icon: "spark", label: "Smart Mode" },
};

// detail route → icon + parent section label by prefix
const SECTION_BY_PREFIX: Record<string, { icon: string; label: string }> = {
  "/contacts": { icon: "life", label: "Contact" },
  "/donors": { icon: "heart", label: "Donor" },
  "/donations": { icon: "dollar", label: "Donation" },
  "/campaigns": { icon: "target", label: "Campaign" },
  "/grants": { icon: "award", label: "Grant" },
  "/inventory": { icon: "box", label: "Inventory item" },
  "/finance": { icon: "dollar", label: "Finance entry" },
  "/beneficiaries": { icon: "life", label: "Beneficiary" },
  "/team": { icon: "users", label: "Team member" },
};

// A raw id (UUID, long hex, or a numeric/slug id) must NEVER show as a tab title.
function looksLikeId(seg: string) {
  if (!seg) return true;
  // UUID v4-ish (with or without dashes), or a long hex blob
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(seg)) return true;
  if (/^[0-9a-f]{12,}$/i.test(seg)) return true;
  // bare number id, or a token with no vowels that is mostly hex (e.g. "fad65b6d")
  if (/^\d+$/.test(seg)) return true;
  if (seg.length >= 8 && /^[0-9a-f]+$/i.test(seg) && !/[ghijklmnpqrstuvwxyz]/i.test(seg)) return true;
  return false;
}

function humanize(seg: string) {
  return seg.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Derive a SAFE tab from a route. Never emit a raw id as a title — fall back to
// the parent section name ("Donor", "Grant") until TabTitle resolves the real
// human name once the detail page renders.
function deriveTab(href: string): Tab {
  // a top-level module root opens as its named tab (Finance, Beneficiaries, …)
  if (ROOT_SECTION[href]) return { href, title: ROOT_SECTION[href].label, icon: ROOT_SECTION[href].icon };
  const prefixKey = Object.keys(SECTION_BY_PREFIX).find((p) => href.startsWith(p + "/"));
  const section = prefixKey ? SECTION_BY_PREFIX[prefixKey] : null;
  const seg = href.split("/").filter(Boolean).pop() || href;
  const title = looksLikeId(seg) ? (section?.label || "Record") : humanize(seg).slice(0, 28);
  return { href, title, icon: section?.icon || "file" };
}

type Ctx = {
  tabs: Tab[];
  active: string;
  closeTab: (href: string) => void;
  setTitle: (href: string, title: string, brand?: string) => void;
  // focus sheets
  sheets: Sheet[];
  openSheet: (s: OpenSheet) => void;
  minimizeSheet: (id: string) => void;
  restoreSheet: (id: string) => void;
  closeSheet: (id: string) => void;
};
const TabsCtx = createContext<Ctx>({
  tabs: [], active: "/", closeTab: () => {}, setTitle: () => {},
  sheets: [], openSheet: () => {}, minimizeSheet: () => {}, restoreSheet: () => {}, closeSheet: () => {},
});
export const useTabs = () => useContext(TabsCtx);

const KEY = "nisria.tabs.v2";

export function TabsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [sheets, setSheets] = useState<Sheet[]>([]);

  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(KEY) || "[]"); if (Array.isArray(s)) setTabs(s); } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(tabs)); } catch {} }, [tabs]);

  // only OPENED records become route tabs; nav sections never do
  useEffect(() => {
    if (!pathname || pathname === "/login" || NAV_SECTIONS.has(pathname)) return;
    setTabs((prev) => (prev.find((t) => t.href === pathname) ? prev : [...prev, deriveTab(pathname)]));
  }, [pathname]);

  // Focus sheets are in-memory overlays tied to the view you opened them from (a
  // reply, a grant, a donor). When the founder NAVIGATES to another section, drop
  // them — otherwise minimized "Reply to …" tabs trail across every page (feedback).
  // They reopen from their source list in one tap, and opening a sheet does not
  // change the pathname, so this only fires on real navigation. Route tabs above
  // are route-backed and intentionally persist; only the sheet overlays reset.
  useEffect(() => { setSheets([]); }, [pathname]);

  const closeTab = useCallback((href: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.href !== href);
      if (pathname === href) router.push("/");
      return next;
    });
  }, [pathname, router]);

  const setTitle = useCallback((href: string, title: string, brand?: string) => {
    setTabs((prev) => prev.map((t) => (t.href === href ? { ...t, title, ...(brand ? { brand } : {}) } : t)));
  }, []);

  // ---- focus sheets ----------------------------------------------------
  const openSheet = useCallback((s: OpenSheet) => {
    setSheets((prev) => {
      // re-opening an existing sheet just un-minimizes + refreshes its render
      const existing = prev.find((x) => x.id === s.id);
      if (existing) return prev.map((x) => (x.id === s.id ? { ...x, ...s, minimized: false } : x));
      // only one sheet open at a time on screen: minimize the others
      const minimizedOthers = prev.map((x) => ({ ...x, minimized: true }));
      return [...minimizedOthers, { ...s, minimized: false }];
    });
  }, []);

  const minimizeSheet = useCallback((id: string) => {
    setSheets((prev) => prev.map((x) => (x.id === id ? { ...x, minimized: true } : x)));
  }, []);

  const restoreSheet = useCallback((id: string) => {
    // restoring one minimizes any other open sheet (single focused sheet)
    setSheets((prev) => prev.map((x) => (x.id === id ? { ...x, minimized: false } : { ...x, minimized: true })));
  }, []);

  const closeSheet = useCallback((id: string) => {
    setSheets((prev) => prev.filter((x) => x.id !== id));
  }, []);

  return (
    <TabsCtx.Provider value={{
      tabs, active: pathname || "/", closeTab, setTitle,
      sheets, openSheet, minimizeSheet, restoreSheet, closeSheet,
    }}>
      {children}
    </TabsCtx.Provider>
  );
}

// Mounted on detail pages — resolves the real human name onto the route tab,
// replacing the safe fallback (section name) deriveTab put there.
export function TabTitle({ title, brand }: { title: string; brand?: string }) {
  const pathname = usePathname();
  const { setTitle } = useTabs();
  const last = useRef<string>("");
  useEffect(() => {
    if (!pathname) return;
    const t = (title || "").trim();
    if (!t || t === last.current) return;
    last.current = t;
    setTitle(pathname, t.slice(0, 28), brand);
  }, [pathname, title, brand, setTitle]);
  return null;
}
