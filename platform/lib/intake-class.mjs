// Pure intake classifier (2026-06-22, Bug 3 / KT #367). Decides whether a DM intake
// becomes a CASE (intake_stage 'under_review', never auto-accepted) or an ACCEPTED
// beneficiary. Imported by BOTH the worker route and the gym guardcheck endpoint so the
// rule proven live is the exact rule the worker runs (zero drift).
//
// Rule: DEFAULT TO A CASE. A record is an ACCEPTED beneficiary ONLY when an ADMIN
// (owner/founder) explicitly says "beneficiary" and does NOT say "case". So:
//   - "new case, not a beneficiary"  -> case   (the old `case && !beneficiar` bug)
//   - bare "child"/"family"          -> case   (safe default, never auto-accept)
//   - "beneficiary case"             -> case   (case wins; intake is the safe side)
//   - admin "new beneficiary"        -> accepted
//   - ANY team intake                -> case   (a non-founder can never auto-accept)
export function intakeIsCase(command, isAdmin) {
  const cmd = String(command || "");
  const saysCase = /\bcase\b/i.test(cmd);
  const saysBeneficiaryOnly = /\bbeneficiar(?:y|ies)\b/i.test(cmd) && !saysCase;
  return isAdmin ? !saysBeneficiaryOnly : true;
}
