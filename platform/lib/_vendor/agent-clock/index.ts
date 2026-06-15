// Vendored from zanii-truststack/ts/packages/truststack-agent-clock @ a0c0373 (2026-06-15).
// DO NOT EDIT in place. To update: re-copy from the upstream package and bump the sha above.
// Why vendored: each bot is its own Vercel project, file:../sibling deps break Vercel build.
// Local normalization: em-dashes in vendor comments stripped to commas per Nisria doctrine.

/**
 * @zanii/agent-clock. Inject trusted temporal context into every LLM call.
 *
 * LLMs answer with the wrong date because the current date/time is never
 * injected into prompts. `ClockInjector` renders a trusted "now" and prepends
 * it to prompts so agents stop guessing.
 *
 * @example
 *   import { ClockInjector } from "@zanii/agent-clock";
 *   const clock = new ClockInjector({ timezone: "Asia/Dubai" });
 *   console.log(clock.inject("What day is it tomorrow?"));
 */

export {
  TimeFormat,
  Weekday,
  type TimeFormatOptions,
  type TrustedTime,
} from "./models.js";

export {
  SystemTimeSource,
  FrozenTimeSource,
  CallableTimeSource,
  resolveTimezone,
  type TimeSource,
} from "./sources.js";

export { ClockInjector, type ClockInjectorOptions } from "./injector.js";

export const VERSION = "0.1.0";
