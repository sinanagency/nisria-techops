"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

export type Tab = { href: string; title: string; icon: string; brand?: string };

// Top-level sections live in the nav. They are NOT tabbed (no duplication).
// Tabs only hold things you OPEN: a donor, a contact, a finance entry, etc.
const NAV_SECTIONS = new Set([
  "/", "/inbox", "/content", "/library", "/tasks", "/agents", "/smart",
  "/donors", "/donations", "/campaigns", "/beneficiaries", "/inventory",
  "/grants", "/outreach", "/team", "/newsletter", "/finance",
]);

// detail route → icon by parent
const ICON_BY_PREFIX: Record<string, string> = {
  "/contacts": "life", "/donors": "heart", "/donations": "dollar",
  "/campaigns": "target", "/grants": "award", "/inventory": "box", "/finance": "dollar",
};

function humanize(seg: string) {
  return seg.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function deriveTab(href: string): Tab {
  const prefix = Object.keys(ICON_BY_PREFIX).find((p) => href.startsWith(p + "/"));
  const seg = href.split("/").filter(Boolean).pop() || href;
  return { href, title: humanize(seg).slice(0, 24), icon: prefix ? ICON_BY_PREFIX[prefix] : "file" };
}

type Ctx = {
  tabs: Tab[];
  active: string;
  closeTab: (href: string) => void;
  setTitle: (href: string, title: string, brand?: string) => void;
};
const TabsCtx = createContext<Ctx>({ tabs: [], active: "/", closeTab: () => {}, setTitle: () => {} });
export const useTabs = () => useContext(TabsCtx);

const KEY = "nisria.tabs.v2";

export function TabsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [tabs, setTabs] = useState<Tab[]>([]);

  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(KEY) || "[]"); if (Array.isArray(s)) setTabs(s); } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(tabs)); } catch {} }, [tabs]);

  // only OPENED records become tabs; nav sections never do
  useEffect(() => {
    if (!pathname || pathname === "/login" || NAV_SECTIONS.has(pathname)) return;
    setTabs((prev) => (prev.find((t) => t.href === pathname) ? prev : [...prev, deriveTab(pathname)]));
  }, [pathname]);

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

  return <TabsCtx.Provider value={{ tabs, active: pathname || "/", closeTab, setTitle }}>{children}</TabsCtx.Provider>;
}

export function TabTitle({ title, brand }: { title: string; brand?: string }) {
  const pathname = usePathname();
  const { setTitle } = useTabs();
  useEffect(() => { if (pathname) setTitle(pathname, title, brand); }, [pathname, title, brand, setTitle]);
  return null;
}
