#!/usr/bin/env bash
# predeploy.sh — run before any production deploy.
set -euo pipefail

echo "→ predeploy.sh: starting"

# 1. FULL regression wall suite (includes the seam-10 brain-core drift canary +
#    the ingress fail-closed canary + every shipped-fix wall). A single red wall
#    aborts the deploy (set -e + non-zero exit from run-walls.mjs). This is the
#    "what works never breaks" gate — never deploy past a red.
echo "→ regression walls (all eval/integration)..."
node eval/run-walls.mjs

# 2. typecheck — the source-seam walls are string assertions and do NOT type-check,
#    so tsc catches the compile-level breakage the walls cannot see.
echo "→ typecheck (tsc --noEmit)..."
npx tsc --noEmit

echo "✓ predeploy.sh: all checks passed — safe to vercel --prod"
