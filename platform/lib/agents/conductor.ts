// Conductor (Chief of Staff). Narrates the day for Nur and routes work to the
// right specialist. For now it writes the morning/standing brief from the live
// snapshot + what the mesh did + what's waiting on her.
import { claude } from "../anthropic";

export async function buildBrief(ctx: {
  raisedMtd: string;
  raisedAll: string;
  donors: number;
  newMessages: number;
  pendingApprovals: number;
  openTasks: number;
  recentAgentActions: string[];
  liveCampaigns: string[];
}): Promise<string> {
  const system = `You are Sasa, Nisria's Chief-of-Staff AI. Write a short, warm "here's where things stand" brief for Nur, the founder. 3-5 sentences max. Lead with what needs her, then what the agents handled, then one useful observation. Concrete, no fluff, no markdown headers. Address her as "you".`;
  const user = `Live state:
- Raised this month: ${ctx.raisedMtd} (all-time ${ctx.raisedAll})
- Donors: ${ctx.donors}
- New unread messages: ${ctx.newMessages}
- Items waiting on you (approvals): ${ctx.pendingApprovals}
- Open tasks: ${ctx.openTasks}
- Live campaigns: ${ctx.liveCampaigns.join("; ") || "none"}
- What the agents did recently: ${ctx.recentAgentActions.join("; ") || "nothing yet"}

Write the brief.`;
  try {
    return await claude(system, user, 320);
  } catch {
    // graceful fallback if Claude is unreachable
    const bits = [];
    if (ctx.pendingApprovals) bits.push(`${ctx.pendingApprovals} item${ctx.pendingApprovals > 1 ? "s" : ""} waiting on you`);
    if (ctx.newMessages) bits.push(`${ctx.newMessages} new message${ctx.newMessages > 1 ? "s" : ""}`);
    if (ctx.openTasks) bits.push(`${ctx.openTasks} open task${ctx.openTasks > 1 ? "s" : ""}`);
    return `Good day, Nur. ${bits.length ? bits.join(", ") + "." : "All quiet right now."} Raised ${ctx.raisedMtd} this month.`;
  }
}
