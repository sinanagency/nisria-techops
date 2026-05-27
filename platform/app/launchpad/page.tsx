import Launchpad from "../../components/Launchpad";

export const dynamic = "force-dynamic";

// The Launchpad space: a flat searchable grid of every section. Reachable from the
// grid button in the top bar (and, later, by swiping left from the Command Center
// once the workspace slider lands behind NEXT_PUBLIC_WORKSPACE).
export default function LaunchpadPage() {
  return <Launchpad />;
}
