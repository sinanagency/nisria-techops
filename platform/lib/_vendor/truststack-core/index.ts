// Vendored from zanii-truststack/ts/packages/truststack-core @ a0c0373 (2026-06-15).
// DO NOT EDIT in place. To update: re-copy from the upstream package and bump the sha above.
// Why vendored: each bot is its own Vercel project, file:../sibling deps break Vercel build.

export {
  HealthState,
  type HealthStatus,
  type ComponentMetrics,
  MetricRegistry,
  BaseTrustComponent,
} from "./core.js";

export { type TrustEvent, EventBus, type EventHandler } from "./events.js";

export {
  type TelemetrySink,
  type LogLevel,
  type LogEvent,
  type SpanRecord,
  ConsoleTelemetrySink,
  NullTelemetrySink,
  setGlobalTelemetry,
  getGlobalTelemetry,
  traced,
} from "./telemetry.js";
