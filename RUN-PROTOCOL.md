# Autonomous Run Protocol (autoclaude, silent until done)

How I run the Nisria build once Sinan gives the signal. The rule: work nonstop, do not
check in, surface only when the whole thing is done or genuinely blocked. Pairs with
NISRIA-BUILD-SPEC.md (what + order), NISRIA-DESIGN-SYSTEM.md + design-principles/references
(how it looks), OVERNIGHT-LOG.md (live state), the task spine.

## Mode
- AUTONOMOUS + NONSTOP. No progress chatter, no "shall I proceed", no per-step approval.
- We have assumed I am good enough; verification is the single extracted-vs-truth audit at the END,
  not a per-batch gate during the build.
- Work the task spine top to bottom, then the full build order in the spec. Pending now: #50, #51, #58,
  then the spec phases (extraction gate, Finance MVP, beneficiaries/grants/legal/reports, navigation
  chrome, cockpit, Sasa recall + comms).

## The silence rule: ONE ping, total silence until then
- EXACTLY ONE push notification for the whole run, fired when the run reaches its end.
- Blockers do NOT break silence. If I hit something I can't get past (a missing credential, a key),
  I LOG it, SKIP that one item, and keep going on everything else. Every blocker is BUNDLED into the
  single end ping, never reported mid-run.
- No progress chatter, no "finished phase 2," no "shall I proceed." Nothing until the one ping.
- The ONLY thing that can break silence early is a genuine SAFETY stop: something destructive,
  irreversible, or clearly outside the mandate. That is the single exception, and it is rare.
- The one end ping fires when EITHER the build is fully complete, OR the run reaches the furthest a
  single continuous autonomous run can push (with a clean resume point). Either way: one ping.

## How I keep going (the engine)
- Each unit: build, typecheck green, deploy behind the flag, VERIFY (render + screenshot + judge with
  my own eyes against the reference and the principles; for data, reconcile against source), commit at
  the green point, then the next. Blast radius one module, always revertable.
- Persist across resets: the task spine + OVERNIGHT-LOG are the memory; on any compaction or restart I
  resume on the first incomplete task. I re-read the governing docs at the start of each phase.
- Long operations run as background jobs that notify me on completion so waiting never means stopping.
- If I would ever go idle with work remaining, I schedule a wakeup to resume. The in-app cron/watcher
  is what runs forever unattended; my session runs the long build stretch.

## Definition of done (what unlocks the one ping)
- Every spine task + spec phase complete; the app built behind NEXT_PUBLIC_WORKSPACE; today's app
  untouched as the fallback.
- Every screen checked with my own eyes against its real-world reference and the design principles.
- All financial + beneficiary data staged, reconciled, committed, with the extracted-vs-truth audit
  report ready for Sinan to review.
- COMPONENTS.md, design docs, and OVERNIGHT-LOG updated; everything committed + pushed to main.

## Guardrails (always on, even in silence)
No fabricated data; KES/USD separate; idempotent (batch tags); never auto-send WhatsApp/email during
the build; sensitive data private (RLS, never public/client-exposed); no em-dashes/placeholders;
extend beside, never rewire the working app; deploy from platform/ only; never push .github/workflows.

## The single end deliverable
One push notification + a written wrap: what was built, where, the extracted-vs-truth audit, what (if
anything) is blocked on you, and the one flag to flip to see it all. That is the only time I speak.
