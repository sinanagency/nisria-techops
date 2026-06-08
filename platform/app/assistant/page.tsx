import { redirect } from "next/navigation";

// /assistant collapsed into /smart per doctrine Law 7 (one-brain). The standalone
// "Ask me anything" surface duplicated /smart with a softer copy register; the
// floating dock orb already handles Ask everywhere. Keep the route as a permanent
// redirect so any bookmark or legacy link lands on the canonical brain entry.
export const dynamic = "force-dynamic";

export default function AssistantRedirect() {
  redirect("/smart");
}
