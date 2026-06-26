# Spec 005: Deterministic Rails (Sasa Phase 3)

Status: draft
Owner: Sinan (for Taona / Nur)
Date: 2026-06-26
Tier: 1 (user-facing, money flows, multi-surface). Pipeline: SPEC then ADR then SCHEMA then EVAL then CODE then SOAK.

## 1. Problem

Sasa routes correctly (the mesh picks the right domain specialist), but after routing it hands the entire turn back to the LLM: the model decides which tool to call AND writes the confirmation prose freely. That free judgment is where it fails on commands that are not ambiguous at all: it says "Logged" when a payment is only staged, it creates a task without reading back what it created, it asks a question the user already answered, it invents a task list, it leaks "I'm scoped to comms tools only this turn." The use case is bounded and fully visible in the transcript (425 inbound messages cluster into roughly a dozen intents), so a clear command should produce one correct, predictable result every time. Today it does not, and because the outcome is free LLM text, we cannot even grade it cleanly.

## 2. Outcome

A clear command produces a single deterministic action and a templated confirmation built from the tool result, not from model prose. The LLM is used only to understand (parse intent and fill slots) and to converse (greetings, genuinely ambiguous turns), never to decide or narrate an action outcome.

- Primary metric: on the clear-command golden set (drawn from the real transcript), action accuracy is at least 95 percent, where "correct" means the right tool ran with the right slots and the confirmation matches the tool result. Target near 100 percent.
- Secondary metric (regression catch): zero honesty-guard rewrites fire on the clear-command set in soak. A guard firing means the model spoke an action outcome it should never have spoken. Guards become a silent backstop with a near-zero hit rate, not the primary mechanism.
- Secondary metric 2: the conversational/ambiguous set (the "other" tail) does not regress. Measured by the same LLM-judge replay used today.

## 3. Scope

In scope:
- An intent-parse layer per domain: the specialist's LLM call returns a STRUCTURED intent (`{intent, slots, confidence}`) via a forced tool/JSON schema, not free prose.
- A deterministic executor: validate slots, call the matching real tool, capture the result.
- Templated confirmations: one confirmation template per action, rendered from the tool result. "Ready to log KES X to Y, reply yes" for a staged payment; "Logged on Mark's board" for a created task; etc.
- A slot-gap path: when a required slot is missing, ask exactly one targeted question (deterministic prompt), do not guess and do not act.
- An intent catalog derived from the transcript: pay, stage-batch-payment, assign-task, complete-task, edit-task, set-reminder, calendar-add/move/cancel, finance-query, case-merge/move/edit, beneficiary-intake, contact-lookup, document-file, send-message/relay/flag, greeting, capability-question.
- Keep the existing mesh router (deterministic regex plus Haiku fallback), the shared runSasa engine, and the honesty guards as a backstop.
- A conversational fallback: when the parsed intent is `conversation` or confidence is below threshold, run the existing free-form engine turn (today's behavior) for that message only.

Out of scope:
- Rewriting the router. The router already works (85.9 percent on the hard set, higher on clear). Phase 3 changes what happens AFTER routing, not the routing itself.
- Adding new bot capabilities or new tools. This is a structural change to existing intents only.
- The portal/web UI. WhatsApp surface only.
- Multi-turn planning or autonomous task decomposition beyond the existing 3-step cap.
- Voice-note and image understanding changes. Media handling stays as-is this phase.
- Group-bot behavior changes beyond inheriting the same execute-then-template path.

## 4. User flow

Happy path (clear command):
1. Nur sends "Assign this task to Mark: follow up on NGO registration."
2. Router picks `work` (deterministic).
3. The work specialist's LLM call returns `{intent: "assign_task", slots: {assignee: "Mark", title: "follow up on NGO registration"}, confidence: 0.96}`.
4. The executor validates the slots, calls `create_task`, gets `{ok: true, task_id, board: "Mark"}`.
5. The confirmation is rendered from the template: "Logged on Mark's board, he sees it in his brief. Want me to message him now?" The model never wrote that sentence.

Failure path A (missing slot):
1. Nur sends "Pay Lucy."
2. Router picks `money`; parser returns `{intent: "stage_payment", slots: {payee: "Lucy", amount: null}, confidence: 0.9}`.
3. The executor sees `amount` is required and missing, so it asks exactly one question: "How much to Lucy, and KES or USD?" No tool runs, nothing is claimed.

Failure path B (ambiguous / conversational):
1. Nur sends "you should have the logic to deduce that."
2. Parser returns `{intent: "conversation", confidence: 0.4}`.
3. The turn falls back to the existing free-form engine (today's behavior), which can ask what she means, with the honesty guards active. No invented action.

## 5. Non-goals

- Not trying to make the LLM "smarter." The point is to ask the LLM for less: understanding only.
- Not trying to handle every possible phrasing on day one. Unrecognized intents fall back to conversation, never to a wrong action.
- Not trying to remove the honesty guards. They stay as a backstop; success is measured by them going quiet, not by deleting them.
- Not trying to constrain Nur's input with menus or buttons. She keeps typing free-form; the determinism is on the output side, after parse.

## 6. Open questions

- Q: One parser call per turn, or parse-then-execute in the same agent loop? A: Default to a single forced-schema parser call, then deterministic execute. Decide in the ADR; the loop stays only for the conversational fallback.
- Q: Confidence threshold for falling back to conversation. A: Start at 0.6, tune against the golden set during EVAL.
- Q: Multi-intent messages ("assign these 3 tasks and pay Lucy"). A: Parser returns an array of intents capped at 3 (reuse the existing decompose cap); execute each on its own rail. Confirm-batch as one readback.
- Q: Where do templates live so they are the single source of confirmation text? A: A `lib/agents/confirmations.ts` map keyed by intent, rendered from tool result. Confirm in ADR.
- Q: Do we keep evalSasaMulti (stubbed) or only live replay for grading? A: Grading needs the real executor, so prefer live replay against the sandbox. Confirm in EVAL.

## 7. Test cases (golden set)

Drawn from the real transcript. "Correct" = right tool, right slots, confirmation matches the tool result, no false completion claim.

| # | Input / scenario | Expected outcome |
|---|------------------|------------------|
| 1 | "This is Mark's salary (KSH 15,000) + KSH 5,000 reimbursement" | Two `record_payment` calls staged; reply lists both as "Ready to log ... reply yes". Never "Logged". |
| 2 | "Mention the details that it's 15 sheep" (after staging a sheep payment) | Payment re-staged with the note; reply stays "Ready to log ... reply yes", never "Logged. KES 180,000". |
| 3 | "Pay Lucy" (no amount) | One targeted question for amount + currency; no tool runs; nothing claimed. |
| 4 | "Assign this task to Mark: follow up on NGO registration" | One `create_task` for Mark; reply "Logged on Mark's board"; offers to message him. No duplicate. |
| 5 | "Assign these tasks to me: reset Cecilia's email, get back to Jenni, ..." | One `create_task` per line (cap 3 then note remainder); single batch readback confirmation. |
| 6 | "Add this to the calendar: Call with Edith, today at 9 PM" | One `create_event` at 9 PM today; confirmation reflects the event the tool created; no extra task/reminder invented. |
| 7 | "Edit that previous log: mention it controls his Claude terminal" | `update_task` on the referenced task; reply quotes the NEW text from the tool result. If the referent is unresolved, ask which task, do not create. |
| 8 | "Remind me to send the Anthropic grant follow-up at 2pm tomorrow" | Routes to `work`; one reminder/task created for 2pm tomorrow; confirmation reflects it. Never "I'm scoped to comms tools only". |
| 9 | "Fold Princess and Tony into Mercy's case" | Two `merge_case` calls (or the real case tool); reply reflects the tool result. If merge is not a real capability, say so plainly. No money-shaped staging text. |
| 10 | "How much have we raised this month?" (owner) | `finance_summary`/`query_donations` runs; the real figure is reported. Never "confidential" to the owner. |
| 11 | "I can't find this task on the portal" | `list_tasks` lookup; if absent, say so once and offer to create; do not both claim absent and guess a different task. |
| 12 | "u think you are good now?" | Parsed as `conversation`; brief in-character reply; no meta-narrative about its own rules or training. |
| 13 | "Asante sana" / greeting in Swahili | Parsed as `greeting`; warm one-line reply; no tool, no action. |
| 14 | "Tell Mark the visit moved to Thursday" | `relay_to_colleague`/`message_person` to Mark; reply claims sent ONLY if the tool returned ok=true. |
| 15 | Beneficiary intake: "New child, Amani, 7, intake today" | `add_beneficiary` with parsed slots; confirmation reflects the created row; no PII echoed to team tier. |
| 16 | Multi-intent: "assign Cynthia the report task and pay her 3000 transport" | Parser returns 2 intents; `create_task` (work rail) + `record_payment` staged (money rail); one combined readback. |
