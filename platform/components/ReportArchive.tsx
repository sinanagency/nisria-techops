import { admin } from "../lib/supabase-admin";
import { Card, Badge } from "./ui";
import DocReader from "./DocReader";
import { FileText, ChevronRight, TrendingUp, ClipboardCheck, CalendarDays, Wallet, FileBarChart } from "lucide-react";

// Report archive: the org's actual filed reports as a NATIVE, classified, browsable
// register (not a file dump). Period is parsed from the title since these PDFs/docs
// carry no extracted date. Self-populating from documents where doc_type='report';
// the original file is demoted to a small source link. Audit-grade history at a glance.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function periodOf(title: string): { label: string; sort: string } {
  const t = title || "";
  // YYYYMM prefix (e.g. 202206)
  const ym = /\b(20\d{2})(0[1-9]|1[0-2])\b/.exec(t);
  if (ym) return { label: `${MONTHS[Number(ym[2]) - 1]} ${ym[1]}`, sort: `${ym[1]}-${ym[2]}` };
  // "Report - 20 Jan" / "16 Nov" — day + month, year unknown
  const dm = /\b(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.exec(t);
  if (dm) { const mi = MONTHS.findIndex((m) => m.toLowerCase() === dm[2].toLowerCase()); return { label: `${dm[1]} ${MONTHS[mi]}`, sort: `0000-${String(mi + 1).padStart(2, "0")}` }; }
  // plain year (Impact Report 2023, CBO Financial Audit 2024)
  const yr = /\b(20\d{2})\b/.exec(t);
  if (yr) return { label: yr[1], sort: `${yr[1]}-00` };
  return { label: "Undated", sort: "0000-00" };
}

type Kind = { key: string; label: string; icon: any; tone: string; test: (t: string) => boolean };
const KINDS: Kind[] = [
  { key: "impact", label: "Impact reports", icon: TrendingUp, tone: "teal", test: (t) => /impact/i.test(t) },
  { key: "audit", label: "Financial audits", icon: ClipboardCheck, tone: "peri", test: (t) => /audit/i.test(t) },
  { key: "lovinghands", label: "Loving Hands financial reports", icon: Wallet, tone: "gold", test: (t) => /loving\s*hands/i.test(t) },
  { key: "monthly", label: "Monthly field reports", icon: CalendarDays, tone: "green", test: (t) => /^report\s*-\s*\d/i.test(t.replace(/^\[NS\]\s*/, "")) },
  { key: "exec", label: "Executive summaries", icon: FileBarChart, tone: "blue", test: (t) => /executive summary/i.test(t) },
  { key: "other", label: "Other reports", icon: FileText, tone: "gray", test: () => true },
];

function clean(t: string) {
  return (t || "").replace(/^\[NS\]\s*/, "").replace(/^Copy of\s*/i, "").replace(/\.(pdf|docx?|doc)$/i, "").trim();
}

export default async function ReportArchive() {
  const db = admin();
  const { data } = await db
    .from("documents")
    .select("id,title,brand,doc_date,drive_url")
    .eq("doc_type", "report")
    .limit(500);
  let rows = (data || []) as any[];
  if (!rows.length) return null;

  // collapse duplicate/redundant copies (same normalized title), keep one
  const ntitle = (t: string) => (t || "").toLowerCase().replace(/\[ns\]/g, "").replace(/\bcopy of\b/g, "").replace(/\.(pdf|docx?|doc|xlsx?)$/i, "").replace(/[\s_]*\(?\d+\)?\s*$/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const seen = new Set<string>();
  rows = rows.filter((d) => { const k = ntitle(d.title); if (seen.has(k)) return false; seen.add(k); return true; });

  const grouped: Record<string, any[]> = {};
  for (const d of rows) {
    const k = KINDS.find((x) => x.test(d.title || ""))!.key;
    (grouped[k] ||= []).push({ ...d, _p: periodOf(d.title || "") });
  }
  for (const k of Object.keys(grouped)) grouped[k].sort((a, b) => (a._p.sort < b._p.sort ? 1 : a._p.sort > b._p.sort ? -1 : 0));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
        Every report ever filed, classified and dated. Click any one to read its full text right here, searchable, without leaving the platform. New reports added to Drive appear here automatically.
      </div>
      {KINDS.filter((k) => (grouped[k.key] || []).length > 0).map((k) => {
        const list = grouped[k.key];
        const Icon = k.icon;
        return (
          <Card key={k.key} title={<span className="flex"><Icon size={15} /> {k.label}</span> as any} action={<Badge tone={k.tone as any}>{list.length}</Badge>}>
            <div className="stack" style={{ gap: 0 }}>
              {list.map((d: any) => (
                <DocReader key={d.id} doc={{ id: d.id, title: clean(d.title), drive_url: d.drive_url, icon: "file" }} className="docrow">
                  <span className="between" style={{ padding: "11px 22px", borderTop: "1px solid var(--line)", gap: 12 }}>
                    <span className="flex" style={{ gap: 10, minWidth: 0 }}>
                      {d.brand && <span className="dot" style={{ width: 7, height: 7, borderRadius: 999, flexShrink: 0, background: d.brand === "maisha" ? "var(--maisha)" : d.brand === "ahadi" ? "var(--ahadi)" : "var(--nisria)" }} />}
                      <span style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{clean(d.title)}</span>
                    </span>
                    <span className="flex" style={{ gap: 8, flexShrink: 0 }}>
                      <Badge tone="gray">{d._p.label}</Badge>
                      <ChevronRight size={14} style={{ color: "var(--faint)" }} />
                    </span>
                  </span>
                </DocReader>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
