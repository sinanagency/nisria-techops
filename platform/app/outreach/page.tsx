import { redirect } from "next/navigation";
import { Send } from "lucide-react";
import { getCurrentUser } from "../../lib/auth";
import { getRecipientCounts } from "./actions";
import { SEND_CAP } from "./config";
import Composer from "./Composer";

export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  const ctx = getCurrentUser();
  if (!ctx) redirect("/login");

  const counts = await getRecipientCounts();

  return (
    <div className="pagewrap rise">
      <div className="hero">
        <div>
          <div className="eyebrow">
            <Send size={14} style={{ verticalAlign: -2 }} /> Outreach
          </div>
          <h1>Write once, reach everyone.</h1>
        </div>
      </div>

      <Composer
        orgName={ctx.org}
        userEmail={ctx.teamEmail || ""}
        counts={counts}
        cap={SEND_CAP}
      />
    </div>
  );
}
