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
const scrollY = Number(process.argv[6] || 0); // optional: scroll down N px before the shot
const clickText = process.argv[7] || ""; // optional: click a button/tab whose text matches, before the shot
const typeText = process.argv[8] || ""; // optional: type into the focused input after clicks

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
// domcontentloaded (not networkidle2): the app holds a persistent activity/voice
// connection so the network never goes fully idle. Settle with a fixed wait.
await page.goto(`https://command.nisria.co${path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await new Promise((r) => setTimeout(r, 1800)); // let data fetch + glass/animations settle
if (clickText) {
  // sequential clicks separated by && (e.g. "Archive&&Report - 20 Jan")
  for (const txt of clickText.split("&&")) {
    await page.evaluate((t) => {
      const el = [...document.querySelectorAll("button, a, [role=button]")].find(
        (e) => e.textContent && e.textContent.trim().toLowerCase().includes(t.toLowerCase()),
      );
      if (el) (el).click();
    }, txt.trim());
    await new Promise((r) => setTimeout(r, 900));
  }
}
if (typeText) {
  await page.keyboard.type(typeText, { delay: 30 });
  await new Promise((r) => setTimeout(r, 700));
}
if (scrollY) {
  await page.evaluate((y) => window.scrollTo(0, y), scrollY);
  await new Promise((r) => setTimeout(r, 400));
}
await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log(`shot -> ${out} (${path})`);
