# TRICKY-LOGIC PROTOCOL

> How we keep *intent bugs* out of the bots. Applies to Sasa (nisria-techops) and
> Dorje (jensen-pa). Add a copy to each repo root. Born 2026-06-20 after a string
> of "the code was right but the meaning was wrong" misses (reminder worded as a
> new task, "same time" resolved to the wrong hour, a self-set task that pinged
> the setter, timezone "due today" drift, "this/that" hitting the wrong record).

## The root cause these all share

A green test proves the code does **what you wrote**, not **what the user meant**.
Tricky-logic bugs live in the gap between *mechanism* and *intent*. A wall that
checks "was `pushTaskAlert` called?" is green while the user reads the wrong words.
You cannot close that gap by testing the seam. You close it by testing the
**human-visible output** against the **human's stated intent**.

## The trigger — when is a change "tricky logic"?

If the change touches ANY of these *intent-loaded* surfaces, run the protocol:

- **Time** — relative expressions ("same time", "tonight", "tomorrow", "in an
  hour"), timezones, before/after, due vs lead/reminder time.
- **Reference / deixis** — "this", "that", "the same one", "it", a swipe-reply.
- **Identity** — self vs other, who assigned whom, which of two people/records.
- **Claim words** — done / paid / sent / reminded / handled (the load-bearing words).
- **Money or any irreversible action.**
- **The actual words a human reads** — any template, reminder, or proactive push.

If none of those are touched (a pure refactor, a styling tweak, a log line), skip it.

## The 4 steps (when triggered)

**1. Write the intent first, as concrete examples, in the user's words.**
Input → the EXACT human-visible result. Not prose, examples:
- `"same time tomorrow"` on a 21:00 task → remind at **21:00 tomorrow** (anchor to
  the referenced task's time, NOT now+1day).
- A timed reminder → reads **"Reminder: <title> ..."**, never "a new task for you".
- Nur sets a task for herself → **no** "new task" alert (she just typed it); the
  timed reminder still fires.
These examples ARE your test cases (this is the /spec golden set).

**2. Test the OUTPUT a human sees, not the internal call.**
Assert on the rendered message text / the final stored value. Examples of teeth:
- reminder body **contains** `"Reminder:"` and **does NOT contain** `"new task"`.
- the resolved reminder time **equals** the referenced task's time.
- a self-assigned task produces **zero** `task_alert` sends at create time.
"The function was invoked" is not a passing test for intent.

**3. Adversarial read-back by a separate perspective.**
A second agent (or a deliberate second pass) whose ONLY question is:
*"How would the real user read this, and what did they actually mean?"* — not
"does it run." This is the skeptic loop pointed at INTENT, not correctness.

**4. Verify the first real fire before calling it done.**
Watch the actual message go out via the **owner-mirror** (that is what surfaced
every one of these). A green wall is not "done" for an intent change — seeing the
real human-visible output is. For a TIME-BOUND event (a reminder at 21:00), the
fix must land **before** the event, or you proactively send a correction after.
Never let a wrong-wording message ride just because "the fix is deployed now."

## The product rule that makes the bot self-correcting

For any ambiguous or relative input, the bot **echoes its interpretation back**:
"I'll remind you at 21:00 tomorrow." That single line lets the human catch a
misread in the moment (it is the only reason the 9:03-vs-9:00 slip was caught).
When the interpretation is genuinely uncertain (two matching records, an
unresolvable "same time", an unknown person), the bot **asks** (flag_for_clarity)
instead of guessing. Echo when confident, ask when not — never silently guess on
an intent-loaded input.

## The smell test (paste into your head before shipping an intent change)

- Did I write the expected message/value in the USER's words before coding? 
- Does a test assert the human-visible OUTPUT, not just that a function ran?
- Did a second perspective read it as the user would?
- Will I SEE the first real one (mirror), and does it land before the event?
- Does the bot echo its interpretation of any relative/ambiguous input?

If any answer is "no", it is not done.

## Worked example (tonight, 2026-06-20)

Change: re-wire the timed-reminder cron + 5-min lead (KT #328).
What I tested: "is the cron scheduled, does the gate hold a 21:00 task till 20:55."
All green, deployed, verified the cron fired. **But I never tested the WORDING.**
The reminder went out as "Heads up, a new task for you ... Reply DONE" because the
N=1 path borrowed the create-time `task_alert` template. A step-2 test
(`body contains "Reminder:" and not "new task"`) would have failed red and caught
it before Nur ever saw it. Fix + the right test landed in KT #331 — but the
discipline above is what stops the NEXT one.
