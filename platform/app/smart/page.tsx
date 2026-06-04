import SmartConsole from "../../components/SmartConsole";
import { Wand2, ListChecks, Boxes, PenLine } from "lucide-react";

export const dynamic = "force-dynamic";

const CAPS = [
  { icon: ListChecks, title: "Run tasks", meta: "Assign work, log a call, move a status." },
  { icon: Boxes, title: "Update records", meta: "Add inventory, file a doc, populate a card." },
  { icon: PenLine, title: "Draft & queue", meta: "Thank-yous and posts, held for your approval." },
];

export default function Smart() {
  return (
    <div className="pagewrap rise">
      <div className="hero">
        <div>
          <div className="eyebrow"><Wand2 size={14} style={{ verticalAlign: -2 }} /> Smart Mode</div>
          <h1 className="disp2">Tell me what to do.</h1>
          <div className="sub" style={{ marginTop: 8, maxWidth: 560 }}>
            Sasa acts inside the platform. Anything that goes out to a person or moves money is queued for your approval first.
          </div>
        </div>
        <div className="flex" style={{ flexWrap: "wrap", gap: 8 }}>
          {CAPS.map((c) => (
            <span key={c.title} className="badge teal">
              <c.icon size={13} /> {c.title}
            </span>
          ))}
        </div>
      </div>

      <SmartConsole />

      <div className="grid3" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginTop: 16 }}>
        {CAPS.map((c) => (
          <div key={c.title} className="feature teal">
            <div className="ficon"><c.icon size={20} /></div>
            <div className="ftitle">{c.title}</div>
            <div className="fmeta">{c.meta}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
