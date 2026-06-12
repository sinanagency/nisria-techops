import type { BotGuardsConfig, PreSendCatch } from "./config.js";
export interface GraphPayload {
    [k: string]: unknown;
    to: string;
    type: string;
}
export interface GraphResult {
    id: string | null;
    error?: string;
}
export interface OutboundDeps {
    /** The bot's existing raw Graph POST. Keep maintenance gates / 24h gates inside it. */
    graphSend: (payload: GraphPayload) => Promise<GraphResult>;
    /** Fired whenever the wall catches something. Bot emits its P0 event here. */
    onCatch?: (info: {
        to: string;
        caught: PreSendCatch[];
        dropped: boolean;
        sent: string;
    }) => void | Promise<void>;
    /** Optional message log hook. Runs AFTER send with the sanitized body. */
    log?: (row: {
        to: string;
        body: string;
        kind: string;
        result: GraphResult;
    }) => void | Promise<void>;
}
export interface Outbound {
    sendText: (to: string, body: string) => Promise<GraphResult>;
    sendImage: (to: string, link: string, caption?: string) => Promise<GraphResult>;
    sendDocument: (to: string, link: string, filename: string, caption?: string) => Promise<GraphResult>;
    sendTemplate: (to: string, name: string, params?: string[], lang?: string) => Promise<GraphResult>;
}
export declare function createOutbound(config: BotGuardsConfig, deps: OutboundDeps): Outbound;
//# sourceMappingURL=outbound.d.ts.map