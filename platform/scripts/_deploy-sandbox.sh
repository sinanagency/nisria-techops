#!/usr/bin/env bash
# SAFE SANDBOX PREVIEW DEPLOY (never prod, sends DEAD). Deploys the current code as a
# Vercel PREVIEW deployment wired to the THROWAWAY sandbox Supabase, with EVERY WhatsApp
# / Meta send credential forced empty so a send tool can physically never deliver a
# message, and REPLAY_LIVE_OK=1 so /api/eval/replay live mode runs. NEVER passes --prod,
# so command.nisria.co is never touched. Used to re-verify the bot under maintenance.
#
# Inputs (must already exist): /tmp/.sbxenv (SBX_URL, SBX_SVC), /tmp/.akey (working
# Anthropic key), /tmp/.sbxsecret (GROUP_BOT_SECRET for the eval gate).
# Output: writes the new preview URL to /tmp/.sbxurl and prints it.
set -euo pipefail
cd "$(dirname "$0")/.."

SBX_URL=$(grep '^SBX_URL=' /tmp/.sbxenv | cut -d= -f2-)
SBX_SVC=$(grep '^SBX_SVC=' /tmp/.sbxenv | cut -d= -f2-)
AKEY=$(cat /tmp/.akey)
SECRET=$(cat /tmp/.sbxsecret)
[ -n "$SBX_URL" ] && [ -n "$SBX_SVC" ] && [ -n "$AKEY" ] && [ -n "$SECRET" ] || { echo "missing sandbox inputs"; exit 1; }
# guard: sandbox URL must NOT be prod
case "$SBX_URL" in *ptvhqudonvvszupzhcfl*) echo "REFUSING: SBX_URL points at PROD supabase"; exit 1;; esac

echo "deploying SANDBOX PREVIEW (SUPABASE->sbx, ALL WhatsApp/Meta sends DEAD, REPLAY_LIVE_OK=1, never --prod)..."
URL=$(npx vercel deploy --yes \
  -e SUPABASE_URL="$SBX_URL" \
  -e SUPABASE_SERVICE_KEY="$SBX_SVC" \
  -e NEXT_PUBLIC_SUPABASE_URL="$SBX_URL" \
  -e REPLAY_LIVE_OK=1 \
  -e ANTHROPIC_API_KEY="$AKEY" \
  -e GROUP_BOT_SECRET="$SECRET" \
  -e SASA_MESH=on \
  -e SASA_GROUP_MESH=on \
  -e WHATSAPP_TOKEN="" \
  -e WHATSAPP_PHONE_NUMBER_ID="" \
  -e WHATSAPP_APP_SECRET="" \
  -e WHATSAPP_WABA_ID="" \
  -e WHATSAPP_VERIFY_TOKEN="" \
  -e WHATSAPP_OPERATORS="" \
  -e META_SOCIAL_TOKEN="" \
  2>&1 | tee /tmp/.sbxdeploy.log | grep -oE 'https://[a-z0-9-]+\.vercel\.app' | tail -1)

[ -n "$URL" ] || { echo "deploy produced no URL — see /tmp/.sbxdeploy.log"; tail -20 /tmp/.sbxdeploy.log; exit 1; }
echo "$URL" > /tmp/.sbxurl
echo "sandbox preview deployed: $URL"
