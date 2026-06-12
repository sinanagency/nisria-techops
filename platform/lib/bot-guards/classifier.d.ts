import type { BotGuardsConfig, ClassifyResult } from "./config.js";
export interface Msg {
    role: "user" | "assistant";
    content: string;
}
export interface ClassifyOpts {
    /** Override fail open intent (defaults to the LAST entry in config.intentEnum). */
    fallbackIntent?: string;
    /** Timeout in ms (default 4000). */
    timeoutMs?: number;
}
export declare function classifyIntent<I extends string = string>(command: string, history: Msg[], config: BotGuardsConfig, opts?: ClassifyOpts): Promise<ClassifyResult<I>>;
//# sourceMappingURL=classifier.d.ts.map