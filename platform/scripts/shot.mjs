// The "eyes": headless screenshot of a live (authed) page so I can see and critique
// my own UI before Nur ever does. Uses the local Chrome in headless mode (no window
// opens on the laptop). Usage: node scripts/shot.mjs <path> <out.png> [width] [height]
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const path = process.argv[2] || "/";
const out = process.argv[3] || "/tmp/shot.png";
const width = Number(process.argv[4] || 1440);
const height = Number(process.argv[5] || 1200);

const env = fs.readFileSync(new URL("../.env.shot", import.meta.url), "utf8");
const token = (env.match(/^SESSION_TOKEN=(.*)$/m) || [])[1]?.trim().replace(/^"|"$/g, "") || "";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox", `--window-size=${width},${height}`],
});
const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: 1 });
if (token) {
  await page.setCookie({ name: "nisria_session", value: token, domain: "command.nisria.co", path: "/" });
}
await page.goto(`https://command.nisria.co${path}`, { waitUntil: "networkidle2", timeout: 45000 });
await new Promise((r) => setTimeout(r, 1200)); // let glass/animations settle
await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log(`shot -> ${out} (${path})`);
