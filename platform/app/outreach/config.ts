// Plain module for outreach constants. A "use server" file (actions.ts) may only
// export async functions, so the send cap lives here where both the server action
// and the page (client/server) can import it.
//
// Cap per blast. Gmail SMTP sends sequentially and a serverless function has a
// wall-clock limit, so we send to at most this many per click (mirrors the prior
// newsletter cap). The UI surfaces this honestly when the audience is larger.
export const SEND_CAP = 50;
