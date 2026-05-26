"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, statusTone } from "./ui";
import Modal from "./Modal";
import { Money } from "./Money";
import { ExternalLink, Mail, Phone, MapPin, Calendar, Tag, Briefcase, ListChecks } from "lucide-react";

// Tenure in human terms from an engagement_start date.
function tenure(start: any): string | null {
  if (!start) return null;
  const d = new Date(start);
  if (isNaN(d.getTime())) return null;
  const months = Math.max(0, Math.floor((Date.now() - d.getTime()) / (30.44 * 86400e3)));
  if (months < 1) return "new";
  if (months < 12) return `${months} mo`;
  const yrs = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${yrs}y ${rem}mo` : `${yrs}y`;
}
function fmtDate(v: any): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const TYPE_LABEL: Record<string, string> = {
  staff: "Staff",
  tailor: "Tailor",
  volunteer: "Volunteer",
  contractor: "Contractor",
};
const TYPE_TONE: Record<string, "teal" | "peri" | "gold" | "blue"> = {
  staff: "teal",
  tailor: "peri",
  volunteer: "gold",
  contractor: "blue",
};
const PAY_SUFFIX: Record<string, string> = {
  monthly: "/mo",
  piece: "/piece",
  hourly: "/hr",
  stipend: " stipend",
  none: "",
};

// A clickable team card. Clicking anywhere on the card opens a centered peek
// (shared Modal primitive) with the member's record at a glance; from there you
// open the full 360 profile. `openTasks` is the count of not-done tasks assigned
// to this member (computed server-side and passed in).
export default function TeamPeek({ m, openTasks }: { m: any; openTasks: number }) {
  const [open, setOpen] = useState(false);
  const name: string = m.name || "Unnamed";
  const tags: string[] = Array.isArray(m.tags) ? m.tags : [];
  const t = tenure(m.engagement_start);
  const type = (m.member_type || "staff") as string;
  const paySuffix = m.pay_type ? PAY_SUFFIX[m.pay_type] ?? "" : "";

  const Row = ({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) => (
    <div className="between" style={{ fontSize: 13, padding: "8px 0", borderTop: "1px solid var(--line)" }}>
      <span className="muted flex" style={{ gap: 7 }}><Icon size={13} /> {label}</span>
      <span style={{ textAlign: "right" }}>{children || "—"}</span>
    </div>
  );

  return (
    <>
      <button type="button" className="card card-pad hover" onClick={() => setOpen(true)}
        style={{ textAlign: "left", cursor: "pointer", display: "block", width: "100%", border: "1px solid var(--hairline)", font: "inherit", color: "inherit" }}
        title="Quick look">
        <div className="between" style={{ alignItems: "flex-start" }}>
          <div className="flex" style={{ gap: 11, minWidth: 0 }}>
            <div className="avatar" style={{ width: 42, height: 42, fontSize: 16, flexShrink: 0 }}>{name.charAt(0).toUpperCase()}</div>
            <div style={{ minWidth: 0 }}>
              <div className="strong" style={{ fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
              <div className="muted" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.role || TYPE_LABEL[type]}</div>
            </div>
          </div>
          <Badge tone={TYPE_TONE[type] || "gray"}>{TYPE_LABEL[type] || type}</Badge>
        </div>

        <div className="flex wrap" style={{ gap: 6, marginTop: 13 }}>
          <Badge tone={statusTone(m.status === "active" ? "active" : m.status === "exited" ? "lost" : "")}>{m.status || "active"}</Badge>
          {t && <span className="chip"><Calendar size={11} /> {t}</span>}
          {m.location && <span className="chip"><MapPin size={11} /> {m.location}</span>}
        </div>

        <div className="between" style={{ marginTop: 13, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
          <span className="flex" style={{ gap: 6, fontSize: 12.5 }} title="Open tasks">
            <ListChecks size={13} color="var(--muted)" />
            <span className="muted">{openTasks} open task{openTasks === 1 ? "" : "s"}</span>
          </span>
          {m.pay_amount != null ? (
            <span style={{ fontSize: 13 }} className="strong">
              <Money amount={m.pay_amount} currency={m.pay_currency} />{paySuffix}
            </span>
          ) : (
            <span className="faint" style={{ fontSize: 12 }}>no pay set</span>
          )}
        </div>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width={480}
        title={
          <div className="flex" style={{ gap: 12 }}>
            <div className="avatar" style={{ width: 44, height: 44, fontSize: 17 }}>{name.charAt(0).toUpperCase()}</div>
            <div>
              <h3 style={{ fontSize: 17, lineHeight: 1.1 }}>{name}</h3>
              <div className="muted" style={{ fontSize: 12.5 }}>{m.role || TYPE_LABEL[type]}</div>
            </div>
          </div>
        }
        footer={
          <Link className="btn sm teal" href={`/team/${m.id}`} onClick={() => setOpen(false)}>
            <ExternalLink size={13} /> Open full profile
          </Link>
        }
      >
        <div className={`feature ${TYPE_TONE[type] === "peri" ? "peri" : "teal"}`} style={{ marginBottom: 14 }}>
          <div className="ftitle" style={{ fontSize: 19 }}>
            {m.pay_amount != null ? <><Money amount={m.pay_amount} currency={m.pay_currency} />{paySuffix}</> : TYPE_LABEL[type] || "Team member"}
          </div>
          <div className="fmeta">
            <Badge tone={TYPE_TONE[type] || "gray"}>{TYPE_LABEL[type] || type}</Badge>
            {" · "}
            <Badge tone={statusTone(m.status === "active" ? "active" : m.status === "exited" ? "lost" : "")}>{m.status || "active"}</Badge>
            {openTasks > 0 && <> · {openTasks} open task{openTasks === 1 ? "" : "s"}</>}
          </div>
        </div>

        {m.responsibilities && (
          <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.55, marginBottom: 12 }}>
            {String(m.responsibilities).slice(0, 240)}{String(m.responsibilities).length > 240 ? "…" : ""}
          </div>
        )}

        <div>
          <Row icon={Briefcase} label="Engagement">{m.engagement_type || (t ? `${t} in` : null)}</Row>
          <Row icon={Calendar} label="Started">{fmtDate(m.engagement_start)}</Row>
          {m.email && <Row icon={Mail} label="Email">{m.email}</Row>}
          {m.phone && <Row icon={Phone} label="Phone">{m.phone}</Row>}
          {m.location && <Row icon={MapPin} label="Location">{m.location}</Row>}
          {tags.length > 0 && (
            <div className="flex" style={{ flexWrap: "wrap", gap: 6, paddingTop: 10 }}>
              {tags.map((tag, i) => <span key={i} className="chip"><Tag size={11} /> {tag}</span>)}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
