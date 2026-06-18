#!/bin/bash
# Tail Sasa chat in real-time via Vercel production logs.
# Filters for inbound messages, outbound replies, and errors.
# Usage: ./scripts/tail-sasa.sh [--lines N]

LINES="${2:-50}"
PROJECT="nisria-command-center"

echo "Tailing Sasa chat at https://command.nisria.co (last $LINES lines)..."
echo "---"

npx vercel logs "$PROJECT" --prod --follow --limit "$LINES" 2>/dev/null | grep -E \
  "whatsapp\.(message_in|message_out|reply|worker)|sendTextAndLog|mirror|inbound|from:|runSasa|Sasa →|\[Sasa mirror\]|\[Sasa.*→|error|Error|API credits"
