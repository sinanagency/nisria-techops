import nodemailer from "nodemailer";

// Sends from sasa@nisria.co via Gmail SMTP (app password). Server-only env.
export async function sendEmail(to: string, subject: string, text: string) {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) throw new Error("SMTP not configured");
  const t = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  await t.sendMail({ from: `Nisria <${user}>`, to, subject, text });
}
