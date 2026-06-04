import { redirect } from "next/navigation";
import { Send, Users, Heart, Gauge } from "lucide-react";
import Shell from "../../components/Shell";
import { getCurrentUser } from "../../lib/auth";
import { getRecipientCounts } from "./actions";
import { SEND_CAP } from "./config";
import Composer from "./Composer";

export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  const ctx = getCurrentUser();
  if (!ctx) redirect("/login");

  const counts = await getRecipientCounts();
  const reachable = counts.donors + counts.contacts;
  // Honest about the per-blast cap (Law 11): the most a single send can reach.
  const perBlast = Math.min(reachable, SEND_CAP);
  const capped = reachable > SEND_CAP;

  return (
    <Shell
      title="Outreach"
      sub="Write once, reach everyone. Each greeting personalizes to the recipient's first name."
    >
      {/* DRILL-TO-CORE (Law 5): lead with the number that matters, the reach.
          The breakdown and the per-send cap sit beside it, no new query. */}
      <div className="metric-hero">
        <div className="mh-row">
          <div style={{ minWidth: 0 }}>
            <div className="mh-label">Reachable audience · donors + contacts with an email</div>
            <div className="mh-num disp2">{reachable.toLocaleString()}</div>
            <div className="mh-sub">
              {capped ? (
                <>up to {perBlast.toLocaleString()} per send, the rest follow in later blasts</>
              ) : (
                <>all of them in a single send</>
              )}
            </div>
          </div>
          <div
            className="stack"
            style={{ gap: 6, minWidth: 200, flex: "1 1 200px", maxWidth: 320, textAlign: "right" }}
          >
            <div className="mh-label">Per-send cap</div>
            <div
              className="disp2"
              style={{ fontSize: 40, fontWeight: 700, lineHeight: 0.95, letterSpacing: "-0.03em" }}
            >
              {SEND_CAP.toLocaleString()}
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#7df3f1" }}>
              {capped ? "this audience needs more than one blast" : "one blast covers everyone"}
            </div>
          </div>
        </div>
      </div>

      {/* Breakdown: who makes up the reach. Derived from counts already fetched. */}
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="card card-pad stat">
          <div className="label flex" style={{ gap: 6, alignItems: "center" }}>
            <Heart size={13} /> Donors
          </div>
          <div className="value disp2">{counts.donors.toLocaleString()}</div>
          <div className="delta">supporters with an email on file</div>
        </div>
        <div className="card card-pad stat">
          <div className="label flex" style={{ gap: 6, alignItems: "center" }}>
            <Users size={13} /> Contacts
          </div>
          <div className="value disp2">{counts.contacts.toLocaleString()}</div>
          <div className="delta">network with an email on file</div>
        </div>
        <div className="card card-pad stat">
          <div className="label flex" style={{ gap: 6, alignItems: "center" }}>
            <Gauge size={13} /> This send reaches
          </div>
          <div className="value disp2">{perBlast.toLocaleString()}</div>
          <div className="delta">{capped ? `first ${SEND_CAP.toLocaleString()}, duplicates removed` : "duplicates removed"}</div>
        </div>
      </div>

      {/* The compose surface: a deliberate card, not bare. */}
      <div className="card">
        <div className="card-h">
          <span className="flex" style={{ gap: 8, alignItems: "center" }}>
            <Send size={15} /> Compose a blast
          </span>
        </div>
        <div className="card-pad">
          <Composer
            orgName={ctx.org}
            userEmail={ctx.teamEmail || ""}
            counts={counts}
            cap={SEND_CAP}
          />
        </div>
      </div>
    </Shell>
  );
}
