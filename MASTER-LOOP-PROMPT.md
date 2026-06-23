# MASTER LOOP PROMPT — Nisria / Sasa: Class-Level Hardening & Control-Plane Build

> Paste this whole document as a `/loop` objective. It is written to be run by a fleet of agents, in phases, with gates. Do not skip phases. Do not declare done without the proof in Phase G. The enemy is the surface fix.

---

## 0. MISSION (one sentence)

Turn Sasa from a bot that *patches the bug in front of it* into a system whose **honesty, memory, and CRUD power are correct by construction** — so a real failure cannot recur in a different costume — and in doing so make WhatsApp a reliable control plane for an NGO run by Nur with a team writing and reading data through it.

---

## 1. THE FAILURE PATTERN WE ARE HERE TO KILL (read first, internalize)

We keep seeing this exact loop, and it is the only thing that matters:

> An agent runs for hours, fixes the reported instance, proves it with a wall + a curl, declares "fixed" — and the **very next real WhatsApp message** produces a failure of the *same underlying kind* in a slightly different shape.

That is not bad luck. It is a **diagnosis error**: we fixed an *instance* and called it a *class*. Three root causes produce it, and every agent in this loop must assume all three are present until proven absent:

1. **Instance-blindness.** The fix matched the symptom string, not the invariant. The guard/route was hardened for the exact words that failed, so the next paraphrase, the next name spelling, the next ordering walks around it.
2. **One-directional skepticism.** Our skeptics historically attack in ONE direction ("can this fix be incomplete?") and miss the opposite ("does this fix now suppress something true / break a sibling path / launder a different lie?"). A guard that stops false-positives by opening a false-negative is not fixed; it is moved.
3. **No reliable self-memory.** Sasa decides whether it "messaged X" from **this turn's tool calls only**. It has no trustworthy, queryable record of what it actually did across turns/surfaces. So its honesty is a *guess*, and guesses become lies. The lies are not a personality flaw; they are a **missing state layer**. This is the suspected fundamental gap. Treat the honesty bugs as a symptom of a memory/state-architecture bug.

**If your output does not name the class, the correlated siblings, and the invariant that makes the whole class impossible, you have not done the job — you have done the symptom.**

---

## 2. DOCTRINE — HOW TO THINK (non-negotiable)

- **Class over instance.** For every bug, the first question is never "how do I make this input pass?" It is: *"What is the general rule that was violated, what other inputs/paths violate the same rule, and what single invariant — enforced at one node — makes the entire class impossible?"*
- **Same-node enforcement.** A fix must live at the node where every path that can trigger the class converges (usually the primitive/tool/state-writer), never only at the one route that happened to fail. If two callers reach the same dangerous primitive, the guard belongs in the primitive.
- **Deterministic action, grounded understanding.** The model may *propose*; a deterministic, testable code path must *decide* any high-side-effect action (send, post, write, dispatch, accept). The model is never the source of truth for "did it happen."
- **State is the spine.** Honesty = reading reliable state, not recalling intent. Every "did I / should I / have I" decision reads a single source of truth, not the current turn's scratchpad.
- **Two-directional proof.** Every fix is proven to (a) STOP the bad thing AND (b) NOT break the true/legitimate sibling AND (c) NOT open the inverse hole. A fix that only proves (a) is rejected.
- **Reproduce before you repair, prove on prod after.** A class is not understood until you can reproduce a *fresh, unseen* member of it (not the logged string). A fix is not shipped until the live system is shown handling the class, not the example.
- **The codebase is a logic tree, not a pile of files.** You may not reason about a function without knowing its inputs, outputs, callers, callees, the state it reads, the state it writes, and its siblings that share a contract.

---

## 3. THE END-STATE WE ARE BUILDING TOWARD (so fixes point somewhere)

Sasa is the **write+read control plane for the NGO over WhatsApp**, used concurrently by Nur (owner of truth) and her team. That means:

- **CRUD on every domain object** (beneficiaries, cases, tasks, payments, donors, grants, inventory, contacts, team, events, documents) must be *creatable, readable, updatable, and reversible* from chat — by the right person, with the right authority, and **never silently**.
- **Multi-writer integrity.** Many people write through one bot. Identity, idempotency, and authority must be deterministic so two people, two phrasings, or two surfaces never corrupt or duplicate state.
- **Honest, durable feedback.** Every action returns a truthful, verifiable result; the bot can always answer "what did you actually do" from state.
- **Nur is the decision root.** Anything consequential a non-owner triggers routes to Nur; nothing auto-commits past her authority.

Every fix in this loop must be evaluated against: *does this move us toward a trustworthy NGO control plane, or just silence one error?*

---

## 4. THE AGENT FLEET (roles — spawn these, do not collapse them into one)

Run these as distinct agents/groups. They must disagree with each other; consensus is earned, not assumed.

1. **Forensic Historians (×N).** Reconstruct, minute-by-minute, every Sasa failure and fix on 22 June from the transcripts, the events table, the git log, and the knowledge/failure-mode trees. Output: a timeline of *what the user asked → what the bot did → what state changed → what the bot claimed → the gap.*
2. **Class Cartographers (×1 per bug).** For each fixed bug, answer the Phase-B questionnaire (§6). Their job is to refuse the instance and name the class + siblings + invariant.
3. **Capability-Tree Mappers (×N).** Map the platform as a **capability tree**: every tool/route/primitive, what it can do, every input it accepts, every output/affordance it returns, every state it touches. (See §7.)
4. **Data-Flow / State Cartographers (×N).** Map the platform as a **data-flow + state tree**: for every domain object, every writer, every reader, every event emitted, every place "truth" lives, and every place a consumer computes its own truth instead of reading the source. (See §7.)
5. **Memory/State Architects (×1 group).** Own the suspected root: design the reliable, queryable record of *what Sasa actually did* that every honesty/idempotency/recall decision must read. (See §8.)
6. **Red Team (attack: incomplete).** Prove each fix does NOT cover its class — fresh inputs, paraphrases, orderings, surfaces, tiers, identities.
7. **Blue Team (attack: collateral).** Prove each fix BREAKS or SUPPRESSES something true — the legitimate sibling, the inverse case, a neighboring path, a different person/topic laundered through the same code. (This is the direction we historically miss.)
8. **Synthesis & Integration (×1).** Merge the trees + the class findings into a single ranked plan where each item fixes a *whole class at its node*, with explicit blast radius and rollback.
9. **Proof Warden (×1).** Refuses to mark anything done without the §G triad: wall (code), live curl (prod behavior), and a fresh-member reproduction that now passes.

---

## 5. PHASE A — FORENSIC RECONSTRUCTION (what actually happened)

Study **everything from 22 June, 10:00 Dubai to now**, then trace outward. For each incident produce a row:

`time | actor (Nur/owner/team member) | their intent in plain words | the tool(s)/route(s) that ran | the state that changed (or didn't) | what Sasa told them | the precise gap | the surface that masked it`

Mandatory sources: the WhatsApp transcripts (owner 727 + team + groups), the `events` table (sasa.*, whatsapp.*, group.*), `messages`, `tasks`, `beneficiaries`, `pending_actions`, the git log of the session branch, and the per-project failure-mode + capability trees. Do not rely on memory or summaries — open the real artifacts and verify each claim (a Brain-saved "fixed" is a hypothesis, not a fact).

Deliverable A: the incident ledger + a list of *every fix shipped today* with the file:line it touched and the exact input that triggered it.

---

## 6. PHASE B — CLASS EXTRACTION (from instance to class) — run per fixed bug

For **each** fix from 22 June, the Class Cartographer must answer ALL of these in writing. A fix with unanswered questions is reopened.

1. **What was the literal instance?** The exact input + the exact wrong output.
2. **What invariant was violated?** State it as a rule ("a delivered send must never be reported as un-sent"; "a non-owner intake must never auto-accept"; "a person-send must never become a group post").
3. **What is the CLASS?** Every input/state/path that can violate the same invariant — not just the one we saw. Enumerate the dimensions it varies on: phrasing, name spelling/nickname, ordering, recipient kind (person/group/operator), tier (owner/founder/team), surface (727/team/group/portal/cron), timing (same-turn/cross-turn/after-restart), multiplicity (one/many/partial), identity (duplicate/variant/missing contact).
4. **Where do siblings live?** Which OTHER tools/routes/guards share this contract and therefore have the same latent bug? (Use the trees from §7.) Name them with file:line.
5. **What is the ONE node** where enforcing the invariant kills the whole class? Is the current fix at that node, or at a downstream route? If downstream, it is incomplete by definition.
6. **What is the INVERSE risk?** If we enforce this invariant, what true/legitimate case could we now wrongly block or suppress? How is that prevented?
7. **What state does the correct decision depend on**, and is that state reliable, single-sourced, and queryable? (If the decision needs cross-turn/cross-surface truth and reads only this turn — flag it for §8.)
8. **What is the permanent fix** that makes a *fresh, unseen* member of this class impossible, and what is the fresh member you will use to prove it?

Deliverable B: a class card per bug, ranked by blast radius and by how many siblings it unifies.

---

## 7. PHASE C — THE CODEBASE AS TWO LOGIC TREES (no fix without the map)

Build (or update, if they exist) two machine-checkable trees of the **actual platform**, not an idealized one.

### 7a. Capability Tree (what the system CAN do)
For every tool, route, primitive, and cron:
- **Node:** name, file:line, surface(s) it's reachable from, tier(s) allowed.
- **Inputs:** every parameter + every natural-language trigger that routes to it; what's required vs optional; what's validated vs trusted.
- **Outputs:** every return shape (ok/err), every `detail.*` field, every affordance, every event emitted, every side effect (DB write, WhatsApp send, external call).
- **Authority:** who may invoke it; what it does for owner vs founder vs team; what it refuses.
- **Honesty contract:** what it is allowed to CLAIM, and the proof it must hold to claim it.
- **Siblings:** other nodes that share its contract (all send-class tools, all write-class tools, all intake paths, etc.).

### 7b. Data-Flow / State Tree (where TRUTH lives and how it moves)
For every domain object (beneficiary, case, task, payment, donor, grant, inventory, contact, team_member, event, document, message, pending_action, intent):
- **Writers:** every code path that creates/updates/deletes it, on every surface.
- **Readers:** every code path + every UI that reads it.
- **Source of truth vs derived:** where the canonical value lives, and **every consumer that computes its own version instead of reading the source** (this is the bug factory — flag every one).
- **Events:** what is emitted on each mutation, and whether the honesty/recall/idempotency layer can reconstruct "what happened" from those events alone.
- **Identity & idempotency:** how the object is keyed; how duplicates (variant names, duplicate phones, re-delivered webhooks, cross-surface) are prevented; where they are NOT.

### 7c. Possibility Exploration
A dedicated group enumerates, per function, **every possibility its inputs/outputs can take** and the relationships between them — the legitimate, the malformed, the adversarial, the concurrent, the cross-surface. The goal is to surface the input/output combinations no one designed for. Map these onto the capability tree as untested edges.

Deliverable C: both trees, with every "consumer computes its own truth" and every "claim without proof" and every "guard at the wrong node" marked as a defect with a class label from Phase B.

---

## 8. PHASE D — THE STATE / MEMORY SPINE (the suspected root cause)

Taona's hypothesis, adopted as the working theory: **the lies are a memory-architecture failure.** Sasa cannot reliably answer "what did I actually do?" because it reasons from the current turn, not from a durable record. Every honesty guard is therefore a heuristic over incomplete state.

The Memory/State Architects must:
1. **Define the single source of truth for "Sasa's actions"** — a durable, queryable, append-only record of every consequential action (send, post, write, dispatch, accept/decline, relay) with: actor, surface, recipient/subject (canonicalized identity), the exact payload, the verified outcome (delivered/queued/failed), timestamp, and idempotency key.
2. **Mandate that EVERY honesty / recall / idempotency / "did I already" decision reads this record** — never the current turn alone, never a consumer's private query. Replace per-turn guessing with state reads.
3. **Make identity canonical** so the record is reliable across name variants, nicknames, first/last, duplicate phones, and surfaces — "Malek" and "Malieng" resolve to ONE entity, and the record is keyed on the entity, not the spelling.
4. **Close the read/write loop:** when the bot says "I messaged X," it is *reading the record*, not asserting from intent; when it says "already done," it is *reading the record*. Lies become structurally impossible because claims are projections of state.
5. **Real-time + multi-writer safe:** the record must reflect concurrent writes from Nur + team across surfaces without races, double-acts, or stale reads.

Deliverable D: a design for the action-record + canonical-identity layer, the list of every honesty/idempotency call-site that must be re-pointed to it, and the migration/rollout plan. This is the highest-leverage item; rank classes by how many of them this spine dissolves.

---

## 9. PHASE E — MULTI-DIRECTIONAL ADVERSARIAL VERIFICATION (fix our one-sided skepticism)

For every proposed fix, run THREE independent adversaries, and require all three to fail to break it:

1. **Red (incomplete):** find a *fresh* class member the fix misses — new phrasing, name, order, surface, tier, timing, multiplicity, identity.
2. **Blue (collateral / inverse):** prove the fix now SUPPRESSES a true case, BREAKS a sibling, or opens the *inverse* hole (a false-negative where there was a false-positive, or it launders a *different* lie). This is the direction we have been blind to — give it equal weight and equal agent count.
3. **State auditor (provenance):** prove the fix's decision reads RELIABLE state. If it depends on this-turn-only data, on a polluted log, on a consumer's private query, or on the model's word — it is refuted regardless of whether Red/Blue found an input.

Rules: skeptics attack the REAL deployed code (or a faithful pure mirror), with concrete inputs and file:line, and a stated user-visible consequence. "Looks fine" is not a verdict. A fix survives only when Red, Blue, and the State Auditor all fail, on fresh inputs, with the legitimate siblings still passing.

---

## 10. PHASE F — UNIFIED SOLUTION PER CLASS (fix the whole, not the symptom)

For each class (not each bug), Synthesis produces ONE solution that:
- Enforces the invariant at the **single convergence node** (Phase B Q5).
- Re-points every sibling path (Phase B Q4) to that node.
- Reads from the state spine (Phase D) wherever the decision needs cross-turn/cross-surface truth.
- Carries an explicit **inverse-safety** argument (Phase B Q6 / Blue team).
- States blast radius, the surfaces it touches, and a rollback.
- Names the **fresh class member** that will be the live proof.

Forbidden: a per-route patch when a primitive guard would cover the class; a string-match guard when a structural/state guard is possible; a fix that trades a false-positive for a false-negative without proving the trade is safe.

---

## 11. PHASE G — PROOF GATES (nothing is "done" without all three)

The Proof Warden requires, per class:
1. **Proof in code (wall):** a test that encodes the INVARIANT and a fresh, previously-unseen class member — plus the legitimate sibling as a negative control — running against the real function or a zero-drift pure mirror. The existing wall suite stays green (no regression).
2. **Proof in production (live):** a curl / signed webhook / gym-mode call against the deployed system showing the class handled correctly on the REAL bundle, with zero unsafe side effects. Reproduce the failure shape and show it now resolves; show the legitimate case still works.
3. **Proof against recurrence (soak/trace):** the action-record/events show the class no longer firing on live traffic for the soak window, and a fresh paraphrase (not the logged one) is handled. State explicitly what was NOT covered.

Claim words are load-bearing: "fixed/live" only with the curl→200 and the wall; otherwise "built/attempted." Never declare the class closed because the one logged instance passes.

---

## 12. OUTPUT ARTIFACTS (what the loop must leave behind)

1. The 22-June incident ledger (Phase A).
2. A class card per bug (Phase B) with invariant, siblings, convergence node, inverse risk, fresh-member proof.
3. The two updated logic trees — capability + data-flow/state — with every defect labeled by class (Phase C).
4. The state/memory spine design + the re-point list (Phase D).
5. The unified per-class solutions with blast radius + rollback (Phase F).
6. The proof bundle per class: wall + live curl + soak/trace (Phase G).
7. An updated failure-mode tree: each class marked ✅ only with the §G triad attached; everything else 🟠/🔴 honestly.
8. A short "what is still unverified" list — the honest tail, never hidden.

---

## 13. DEFINITION OF DONE / STOP CONDITIONS

Stop only when, for every class derived from 22 June:
- The invariant is enforced at the convergence node, every sibling re-pointed.
- Red + Blue + State-Auditor all failed to break it on FRESH inputs, with legitimate siblings green.
- The §G triad is attached (wall + live + soak).
- The decision reads reliable state, not this-turn guessing.
- The trees reflect reality and the honest "unverified" tail is written down.

If any class fails any gate, the loop continues on that class. Do NOT declare global success because the reported instances pass — that is the exact failure in §1.

---

## 14. ANTI-PATTERNS (explicitly forbidden — these are how we got here)

- Fixing the logged string instead of the invariant.
- A guard at the route when the primitive is the convergence node.
- Skepticism in one direction only (incomplete) without the other (collateral/inverse).
- An honesty decision that reads this-turn tools instead of the action record.
- Trading a false-positive for a false-negative without an inverse-safety proof.
- "62 walls green" used as proof that a *class* is solved, when the walls only encode logged instances.
- Declaring done after hours of work without a fresh-member live reproduction.
- Name/identity matching by string when an entity-keyed record exists.
- Silent truncation / silent success / a claim the bot cannot back from state.

---

## 15. HOW TO RUN IT AS A LOOP

Each loop iteration: pick the highest-blast-radius UNCLOSED class. Run A→B for it (if not done), consult/extend the C trees, check it against the D spine, design F, then E (red+blue+state) must all fail, then G must all pass, then update the trees + the unverified tail. Re-point siblings in the same iteration. Then pick the next class. Never close a class on its instance. Stop per §13.

> The point is not to fix today's bugs. It is to make today's *kinds* of bug impossible, by enforcing invariants at convergence nodes, backed by a reliable record of what the bot actually did — so the next message can't be a fresh failure of an old class.
