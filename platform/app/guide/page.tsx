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

  return (
    <Shell title="Guide" sub="Start the tour again, or read the quick reference">
      <div className="card guide-hero">
        <div className="sasatour-orb big" style={{ flex: "none" }}>S</div>
        <div>
          <h2 style={{ margin: 0 }}>The fastest way around is to let me show you, {firstName}.</h2>
          <p className="muted" style={{ marginTop: 6, maxWidth: 620 }}>
            I will walk you across the whole platform, explain what each part does, and then ask you
            a few things so I can work the way you would. You can start it any time.
          </p>
          <div style={{ marginTop: 14 }}><TourLaunchButton /></div>
        </div>
      </div>

      <div className="guide-section-head" style={{ marginTop: 34 }}>
        <h3>Quick reference</h3>
      </div>
      <div className="grid cols-2">
        {PILLARS.map((p) => (
          <div className="card card-pad" key={p.key}>
            <div style={{ marginBottom: 4 }}>
              <strong style={{ fontSize: 15 }}>{p.title}</strong>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{p.blurb}</div>
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
