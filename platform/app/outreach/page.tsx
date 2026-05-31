import { redirect } from "next/navigation";
import { getOrgContext } from "../../lib/auth";
import { getRecipientCounts, SEND_CAP } from "./actions";
import Composer from "./Composer";

export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  const counts = await getRecipientCounts();

  return (
    <Composer
      orgName={ctx.orgName}
      userEmail={ctx.email || ""}
      counts={counts}
      cap={SEND_CAP}
    />
  );
}
