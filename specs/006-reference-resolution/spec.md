# Spec 006: Reference Resolution

Status: DRAFT
Author: Sasa (Claude Code) for Nur
Date: 2026-06-26
Tier: 1 (touches the money-correction path indirectly, can target deletes of real records)

## 1. Problem

When Nur or a team member sends Sasa a typed follow-up that refers back with a pronoun, the bot has no reliable way to know which record "it" is. Transcript clustering (KT #409, the largest tail bucket at roughly 52 messages) shows the real shapes: "it's still showing as a task", "move it to Friday", "delete it", "that's wrong, change the date". Today the bot only gets a concrete record pointer when the human SWIPE-replies to a specific message (the swipeAnchor path). A plain typed follow-up carries no anchor, so the model resolves the pronoun freely from the last 12 messages of history. For a read that is fine. For an edit or a delete it can resolve "it" to the wrong record and mutate or remove the wrong thing.

## 2. Outcome

The bot resolves a pronoun follow-up to the record it actually acted on in the immediately prior turn, deterministically, and refuses to guess across ambiguity.

- Primary metric: in a golden set of pronoun-follow-up edit/delete scenarios, the bot targets the correct record in 100 percent of the single-referent cases and asks (flag_for_clarity) rather than guessing in 100 percent of the stale or no-referent cases. Zero wrong-record mutations.
- Secondary metric (regression catch): swipe-reply anchoring and normal named-record edits keep working unchanged. The existing 82 walls plus the new wall stay green; the swipe-anchor wall is untouched.

## 3. Scope

In scope:
- Capture a per-thread "last referent" {ref_type, ref_id, ref_label} at the moment a single concrete record is acted on, for record types: task and calendar event.
- Persist it append-only as a `sasa.referent_set` event keyed by contact (subject_id = contactId), no schema migration.
- On a typed follow-up (no swipeAnchor) that is pronoun-led and would change/delete a record, hydrate the freshest last referent for that contact and feed it into the EXISTING swipeAnchor hard-wall path, labelled as inferred.
- A staleness gate: only use a referent set within the last 30 minutes.
- Ambiguity and staleness route to flag_for_clarity rather than a guess.

Out of scope (explicitly excluded):
- Payments before confirmation. "That was 1500 not 1250" on a freshly staged payment is ALREADY handled by the staged-confirm correction path ("reply yes or tell me the correction"); this feature does not touch it.
- Multi-record turns. If a single turn acted on two or more concrete records, no last referent is captured for that turn (no safe single answer).
- Beneficiary, donor, contact, payroll, and grant edits by pronoun. Higher-sensitivity record types are deferred to a later slice once tasks/events prove safe.
- Cross-thread or group-surface referents. Group chat pronoun resolution is out; DM threads only.
- Changing how swipe-reply anchoring works. That path is reused verbatim, not modified.

## 4. User flow

Happy path:
1. Nur: "remind me to call the auditor Friday." Bot creates the task, replies "Created."
2. The turn captures a `sasa.referent_set` event: {ref_type: task, ref_id: <id>, ref_label: "call the auditor"} keyed by Nur's contact.
3. Nur (next turn, no swipe): "actually move it to Monday."
4. Worker sees no swipeAnchor, detects a pronoun-led change, loads the fresh referent, sets swipeAnchor = the inferred task pointer.
5. The hard-wall block tells the model: this continues the thread about task <id> "call the auditor"; resolve "it" against THAT task. Bot calls update_task on the right id. "Moved to Monday."

Failure path A (stale):
1. Nur acted on a task 45 minutes ago, then chatted about other things.
2. Nur: "delete it."
3. The referent is older than 30 minutes, so it is not used. No inferred anchor. The model, lacking a confident target, asks via flag_for_clarity: "Which one do you mean?" rather than deleting a guess.

Failure path B (ambiguous within the turn):
1. Nur: "create two tasks, one for Mark and one for Grace."
2. The turn acted on two records, so NO referent is captured.
3. Nur: "push it to next week." No inferred anchor exists; the model asks which task.

## 5. Non-goals

- Not trying to give the bot general anaphora resolution across long conversations. It resolves to the LAST single record only, with a recency gate.
- Not trying to replace the swipe-reply gesture. Swipe stays the strongest, most explicit anchor; this is the fallback when the human just types.
- Not trying to make the model smarter at guessing. The intent is the opposite: make it ask when it is not certain.

## 6. Open questions

- Q: Is 30 minutes the right staleness window? A: Start at 30, observe the first week of real follow-ups in /admin/transcripts, tune. Logged as a follow-up, not blocking.
- Q: Should "complete it" / "mark done" count as a change that triggers inferred anchoring? A: Yes, completion is a state change on a real record; include complete_task and reopen_task.
- Q: Does an inferred anchor need softer wall wording than a swipe anchor (since the human did not explicitly point)? A: Yes. The inferred block instructs: if this does not match what they mean, use flag_for_clarity rather than acting. Swipe stays a hard "must resolve to this".

## 7. Test cases (golden set)

| # | Input / scenario | Expected outcome |
|---|------------------|------------------|
| 1 | Create task, next turn "move it to Friday" within 30 min | update_task fires on the just-created task id; no other task touched |
| 2 | Create task, next turn "delete it" within 30 min | delete_task targets the just-created task id only |
| 3 | Create event, next turn "push it an hour" | the event referent is used, not a task |
| 4 | Acted on a task 45 min ago, then "delete it" | referent stale, not used; bot asks flag_for_clarity, deletes nothing |
| 5 | Turn created two tasks, next turn "move it to Monday" | no referent captured (multi-record); bot asks which one |
| 6 | No prior action this thread, "complete it" | no referent; bot asks what "it" refers to, completes nothing |
| 7 | Swipe-reply to a task reminder "done" | existing swipeAnchor path fires unchanged; inferred path does not override it |
| 8 | "move the auditor task to Friday" (named, not pronoun) | normal named-record resolution; inferred anchor not needed and does not interfere |
| 9 | Create task, next turn "thanks!" (no change verb) | no inferred anchor injected (not an edit/delete intent); no write |
| 10 | Create task, next turn "actually 3pm not 2pm" | inferred anchor used, update_task adjusts the time on the right task |
| 11 | Pronoun follow-up references a payment staged last turn | NOT handled here; existing staged-confirm correction path owns it |
| 12 | Group-surface pronoun follow-up | inferred anchoring does not fire on group surface (DM only) |
| 13 | Referent captured, then a NEWER single-record action; "rename it" | the NEWER referent wins (latest within window) |
| 14 | Inferred anchor present but the model is unsure it matches | model uses flag_for_clarity per the softer wall wording, no silent write |
