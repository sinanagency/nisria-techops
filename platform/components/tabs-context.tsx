"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

export type Tab = { href: string; title: string; icon: string; brand?: string };

// Known top-level routes → tab metadata. Dynamic/detail routes inherit the
// closest parent's icon and get their real title from <TabTitle> on the page.
const ROUTES: Record<string, { title: string; icon: string; pinned?: boolean }> = {
  "/":              { title: "Mission Control", icon: "home", pinned: true },
  "/inbox":         { title: "Inbox", icon: "inbox" },
  "/content":       { title: "Content", icon: "pen" },
  "/library":       { title: "Library", icon: "folder" },
  "/tasks":         { title: "Tasks", icon: "check" },
  "/team":          { title: "Team", icon: "users" },
  "/newsletter":    { title: "Newsletter", icon: "send" },
  "/assistant":     { title: "Assistant", icon: "spark" },
  "/agents":        { title: "Agents", icon: "bot" },
  "/activity":      { title: "Activity", icon: "activity" },
  "/donors":        { title: "Donors", icon: "heart" },
  "/donations":     { title: "Donations", icon: "dollar" },
  "/campaigns":     { title: "Campaigns", icon: "target" },
  "/beneficiaries": { title: "Beneficiaries", icon: "life" },
  "/inventory":     { title: "Inventory", icon: "box" },
  "/grants":        { title: "Grants", icon: "award" },
  "/outreach":      { title: "Outreach", icon: "mega" },
};

function humanize(seg: string) {
  return seg.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function deriveTab(href: string): Tab {
  if (ROUTES[href]) return { href, title: ROUTES[href].title, icon: ROUTES[href].icon };
  // longest parent prefix match for detail routes (e.g. /donors/abc)
  const parent = Object.keys(ROUTES)
    .filter((r) => r !== "/" && href.startsWith(r + "/"))
    .sort((a, b) => b.length - a.length)[0];
  const seg = href.split("/").filter(Boolean).pop() || href;
  return { href, title: humanize(seg), icon: parent ? ROUTES[parent].icon : "file" };
}

type Ctx = {
  tabs: Tab[];
  active: string;
  closeTab: (href: string) => void;
  setTitle: (href: string, title: string, brand?: string) => void;
};
const TabsCtx = createContext<Ctx>({ tabs: [], active: "/", closeTab: () => {}, setTitle: () => {} });
export const useTabs = () => useContext(TabsCtx);

const HOME: Tab = { href: "/", title: "Mission Control", icon: "home" };
const KEY = "nisria.tabs.v1";

export function TabsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [tabs, setTabs] = useState<Tab[]>([HOME]);

  // hydrate from localStorage once
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (Array.isArray(saved) && saved.length) {
        if (!saved.find((t: Tab) => t.href === "/")) saved.unshift(HOME);
        setTabs(saved);
      }
    } catch {}
  }, []);

  // persist
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(tabs)); } catch {} }, [tabs]);

  // ensure the current route has a tab (auto-open on navigation)
  useEffect(() => {
    if (!pathname || pathname === "/login") return;
    setTabs((prev) => (prev.find((t) => t.href === pathname) ? prev : [...prev, deriveTab(pathname)]));
  }, [pathname]);

  const closeTab = useCallback((href: string) => {
    if (href === "/") return; // home is pinned
    setTabs((prev) => {
      const next = prev.filter((t) => t.href !== href);
      if (pathname === href) {
        const idx = prev.findIndex((t) => t.href === href);
        const fallback = next[Math.max(0, idx - 1)] || HOME;
        router.push(fallback.href);
      }
      return next;
    });
  }, [pathname, router]);

  const setTitle = useCallback((href: string, title: string, brand?: string) => {
    setTabs((prev) => prev.map((t) => (t.href === href ? { ...t, title, ...(brand ? { brand } : {}) } : t)));
  }, []);

  return (
    <TabsCtx.Provider value={{ tabs, active: pathname || "/", closeTab, setTitle }}>
      {children}
    </TabsCtx.Provider>
  );
}

// Pages drop this to set their tab's real title (esp. dynamic record pages).
export function TabTitle({ title, brand }: { title: string; brand?: string }) {
  const pathname = usePathname();
  const { setTitle } = useTabs();
  useEffect(() => { if (pathname) setTitle(pathname, title, brand); }, [pathname, title, brand, setTitle]);
  return null;
}
