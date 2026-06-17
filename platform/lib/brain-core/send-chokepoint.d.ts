export type SendChokepointAction = {
    ok: true;
    id?: string | null;
} | {
    ok: false;
    error: string;
};
export type SendChokepointAdapters = {
    persistOutbound: (to: string, body: string, opts?: {
        party?: string;
        trace_id?: string | null;
    }) => Promise<{
        id: string | null;
        error?: string;
    }>;
    devPhone: () => string | null;
    sendFn: (to: string, body: string, opts?: {
        force?: boolean;
    }) => Promise<{
        id?: string;
        error?: string;
    }>;
};
export type SendChokepointOpts = {
    party?: string;
    dev?: boolean;
    trace_id?: string | null;
    force?: boolean;
};
export declare function sendWithAudit(to: string, body: string, adapters: SendChokepointAdapters, opts?: SendChokepointOpts): Promise<SendChokepointAction>;
//# sourceMappingURL=send-chokepoint.d.ts.map