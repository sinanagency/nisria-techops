import { redirect } from "next/navigation";
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
    <Composer
      orgName={ctx.org}
      userEmail={ctx.teamEmail || ""}
      counts={counts}
      cap={SEND_CAP}
    />
  );
}
