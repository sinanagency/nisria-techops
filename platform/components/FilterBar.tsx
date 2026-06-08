"use client";

// The modern filter omnibar (Filtering v2). Renders active filters as
// field-operator-value chips, with an "+ Add filter" popover to build new ones
// and saved-view segments. It is URL-driven: every change serializes to the
// querystring and navigates, so the page's existing server-side filtering keeps
// working with zero new data logic. Reusable across every list surface.

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, X, ChevronDown, SlidersHorizontal } from "lucide-react";

export type FilterField = {
  key: string;            // querystring param
  label: string;          // human label
  type: "select" | "text" | "bool";
  op?: string;            // operator word shown in the chip (default: is / contains)
  options?: { v: string; label: string }[]; // for select / bool
};

export type Segment = { label: string; patch: Record<string, string | undefined>; on: boolean };

export default function FilterBar({
  basePath,
  fields,
  values,
  segments = [],
  sort,
  sortOptions = [],
  count,
  searchKey = "q",
  searchPlaceholder = "Search…",
}: {
  basePath: string;
  fields: FilterField[];
  values: Record<string, string>;
  segments?: Segment[];
  sort?: string;
  sortOptions?: { v: string; label: string }[];
  count: number;
  searchKey?: string;
  searchPlaceholder?: string;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [pick, setPick] = useState<FilterField | null>(null);
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState(values[searchKey] || "");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) { setAddOpen(false); setPick(null); }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function nav(next: Record<string, string | undefined>) {
    const merged: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...values, ...next })) {
      if (v !== undefined && v !== "") merged[k] = v as string;
    }
    const s = new URLSearchParams(merged).toString();
    router.push(s ? `${basePath}?${s}` : basePath);
  }
  const setVal = (k: string, v: string | undefined) => nav({ [k]: v });
  const opFor = (f: FilterField) => f.op || (f.type === "text" ? "contains" : "is");
  const valLabel = (f: FilterField, v: string) =>
    f.options?.find((o) => o.v === v)?.label || v;

  const active = fields.filter((f) => values[f.key]);
  const available = fields.filter((f) => !values[f.key]);

  // ---- styles (component-owned, uses existing CSS vars) ----
  const chip: React.CSSProperties = { display: "inline-flex", alignItems: "center", height: 30, borderRadius: 9, overflow: "hidden", border: "1px solid var(--line-2)", background: "#fff", boxShadow: "var(--shadow-sm)", fontSize: 12, fontWeight: 700 };
  const seg = (part: "f" | "o" | "v") => ({ padding: "0 9px", lineHeight: "28px", display: "inline-flex", alignItems: "center", gap: 4,
    background: part === "f" ? "var(--teal-50)" : "transparent",
    color: part === "f" ? "var(--ink)" : part === "v" ? "var(--teal-700)" : "var(--muted)",
    borderLeft: part === "f" ? "none" : "1px solid var(--line)", cursor: part === "v" ? "pointer" : "default" } as React.CSSProperties);

  return (
    // Wrapper carries its own stacking context above sibling cards so the
    // "Add filter" popover (zIndex: var(--z-dropdown) below) escapes UP from
    // inside the omnibar instead of getting clipped by the data card right
    // beneath it. Fixes the "dropdown hides underneath" bug across every list.
    <div ref={wrapRef} style={{ marginBottom: 16, position: "relative", zIndex: addOpen ? 250 : 1 }}>
      {/* saved-view segments */}
      {segments.length > 0 && (
        <div className="flex wrap" style={{ gap: 7, marginBottom: 11 }}>
          {segments.map((s) => (
            <button key={s.label} className={`pill ${s.on ? "on" : ""}`} style={{ fontWeight: 700 }} onClick={() => nav(s.patch)}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* omnibar — isolation removed so the popover can escape this stacking context */}
      <div className="card" style={{ position: "relative", padding: "9px 11px", borderRadius: 14, border: "1.5px solid var(--teal)", boxShadow: "0 0 0 4px rgba(0,196,194,.10), var(--shadow-sm)", display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", isolation: "auto" }}>
        <Search size={15} style={{ color: "var(--teal)", flexShrink: 0 }} />

        {/* search as the first operator */}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") setVal(searchKey, q.trim() || undefined); }}
          placeholder={searchPlaceholder}
          style={{ border: 0, background: "transparent", boxShadow: "none", padding: "4px 0", fontSize: 13.5, minWidth: 150, flex: "0 1 200px" }}
        />

        {/* active filter chips */}
        {active.map((f) => (
          <span key={f.key} style={chip}>
            <i style={seg("f")}>{f.label}</i>
            <i style={seg("o")}>{opFor(f)}</i>
            <i style={seg("v")} onClick={() => { setPick(f); setDraft(values[f.key]); setAddOpen(true); }}>{valLabel(f, values[f.key])}</i>
            <i style={{ ...seg("o"), cursor: "pointer", color: "var(--faint)" }} onClick={() => setVal(f.key, undefined)}><X size={12} /></i>
          </span>
        ))}

        {/* add filter */}
        {available.length > 0 && (
          <button className="btn ghost sm" style={{ borderStyle: "dashed", gap: 5 }} onClick={() => { setAddOpen((o) => !o); setPick(null); }}>
            <Plus size={13} /> Add filter
          </button>
        )}

        {/* sort + count on the right */}
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 10 }}>
          {sortOptions.length > 0 && (
            <span className="flex" style={{ alignItems: "center", gap: 5, color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>
              <SlidersHorizontal size={13} />
              <select
                value={sort || ""}
                onChange={(e) => setVal("sort", e.target.value || undefined)}
                style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "5px 8px", fontSize: 12, fontWeight: 700, background: "#fff", color: "var(--ink)" }}
              >
                {sortOptions.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </span>
          )}
          <span className="disp2" style={{ fontSize: 13, fontWeight: 700, color: "var(--teal-700)", whiteSpace: "nowrap" }}>{count} {count === 1 ? "result" : "results"}</span>
        </span>

        {/* add-filter / edit popover */}
        {addOpen && (
          <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 12, zIndex: 250, width: 264, background: "var(--surface-elevated)", border: "1px solid var(--edge)", borderRadius: 13, boxShadow: "var(--shadow-lg)", overflow: "hidden" }}>
            {!pick ? (
              <>
                <div style={{ fontSize: 9.5, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--faint)", fontWeight: 800, padding: "11px 14px 5px" }}>Filter by</div>
                {available.map((f) => (
                  <button key={f.key} className="dropitem" style={dropItem} onClick={() => { setPick(f); setDraft(""); }}>
                    {f.label}
                    <ChevronDown size={13} style={{ marginLeft: "auto", transform: "rotate(-90deg)", color: "var(--faint)" }} />
                  </button>
                ))}
              </>
            ) : (
              <>
                <div style={{ fontSize: 9.5, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--faint)", fontWeight: 800, padding: "11px 14px 5px" }}>
                  {pick.label} {opFor(pick)}
                </div>
                {pick.type === "text" ? (
                  <div style={{ padding: "6px 12px 12px" }}>
                    <input
                      autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { setVal(pick.key, draft.trim() || undefined); setAddOpen(false); setPick(null); } }}
                      placeholder={`${pick.label}…`}
                      style={{ width: "100%", border: "1px solid var(--line-2)", borderRadius: 9, padding: "8px 10px", fontSize: 13 }}
                    />
                    <button className="btn teal sm" style={{ width: "100%", marginTop: 8, justifyContent: "center" }} onClick={() => { setVal(pick.key, draft.trim() || undefined); setAddOpen(false); setPick(null); }}>Apply</button>
                  </div>
                ) : (
                  (pick.options || []).map((o) => (
                    <button key={o.v} className="dropitem" style={dropItem} onClick={() => { setVal(pick.key, o.v); setAddOpen(false); setPick(null); }}>
                      {o.label}
                      {values[pick.key] === o.v && <span style={{ marginLeft: "auto", color: "var(--teal-700)" }}>✓</span>}
                    </button>
                  ))
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const dropItem: React.CSSProperties = { display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "9px 14px", fontSize: 13, fontWeight: 600, color: "var(--ink-2)", background: "transparent", border: 0, cursor: "pointer", textAlign: "left" };
