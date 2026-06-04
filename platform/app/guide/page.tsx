import Shell from "../../components/Shell";
import { getCurrentUser } from "../../lib/auth";
import { PILLARS } from "../../lib/guide";
import TourLaunchButton from "../../components/TourLaunchButton";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

// Sasa's onboarding lives in the tour (components/SasaTour.tsx). This page is the
// quiet written reference and the place to start the tour again.
export default async function GuidePage() {
  const user = getCurrentUser();
  const firstName = user?.name?.split(" ")[0] || "there";
  const placeCount = PILLARS.reduce((n, p) => n + p.items.length, 0);

  return (
    <Shell title="Guide" sub="Start the tour again, or read the quick reference">
      {/* Hero: lead with the offer to be shown around. The tour is the primary
          path; the reference below is the quiet fallback. */}
      <div className="feature dark guide-hero">
        <div className="sasatour-orb big" style={{ flex: "none" }}>S</div>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>The fastest way around is to let me show you, {firstName}.</h2>
          <p className="fmeta" style={{ marginTop: 8, maxWidth: 620, fontSize: 13.5, lineHeight: 1.55 }}>
            I will walk you across the whole platform, explain what each part does, and then ask you
            a few things so I can work the way you would. You can start it any time.
          </p>
          <div style={{ marginTop: 16 }}><TourLaunchButton /></div>
        </div>
      </div>

      <div className="guide-section-head" style={{ marginTop: 34 }}>
        <h3>Quick reference</h3>
        <span className="guide-progress">{placeCount} places across {PILLARS.length} areas</span>
      </div>
      <div className="grid cols-2">
        {PILLARS.map((p) => (
          <div className="card card-pad" key={p.key}>
            <div className="between" style={{ alignItems: "flex-start", marginBottom: 2 }}>
              <div style={{ minWidth: 0 }}>
                <strong className="disp2" style={{ fontSize: 16 }}>{p.title}</strong>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.45 }}>{p.blurb}</div>
              </div>
              <span className="badge gray" style={{ flex: "none" }}>{p.items.length}</span>
            </div>
            <div className="guide-maplist">
              {p.items.map((it) => (
                <Link href={it.href} key={it.href} className="guide-mapitem">
                  <div className="guide-mapitem-head">
                    <span className="guide-mapitem-label">{it.label}</span>
                    <ArrowRight size={13} className="muted" />
                  </div>
                  <div className="guide-mapitem-what">{it.what}</div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}
