// The send cap lives in lib/outreach (the engine) so the portal action and the
// gated Sasa newsletter tool share one source of truth. Re-exported here for the
// page/composer imports that already reference "./config".
export { SEND_CAP } from "../../lib/outreach";
