// Screenshot capture for docs/screenshots via Playwright + the VITE_MOCK server.
// Run the mock server first:  npm run dev:mock   (serves on :5174)
// Then:  node scripts/capture-screenshots.mjs
//
// Visits each route as the right mock role, waits for content, and writes 2x
// PNGs. All data is the fictional demo seed in src/mock/data.ts.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = process.env.MOCK_BASE ?? "http://localhost:5174";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "screenshots");

// Student screens are mobile (iPhone-ish), club/admin are desktop.
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 860 };
const SCALE = 2;

/** name, role, path, viewport, optional prep run in the page before shooting. */
const shots = [
  ["login", "anon", "/login", DESKTOP],
  ["student-feed", "student", "/", MOBILE],
  ["student-map", "student", "/map", MOBILE],
  ["student-listing", "student", "/listing/l-kk", MOBILE],
  ["student-reviews", "student", "/listing/l-kk/reviews", MOBILE],
  ["student-qa", "student", "/listing/l-kk/qa", MOBILE],
  ["student-pickup", "student", "/listing/l-kk/pickup", MOBILE],
  ["student-order", "student", "/listing/l-kk/order-form", MOBILE],
  ["student-orders", "student", "/orders", MOBILE],
  ["student-qr", "student", "/orders/o-1001", MOBILE],
  ["student-invite", "anon", "/invite/demo-open-token", MOBILE],
  ["student-cravings", "student", "/cravings", MOBILE],
  ["student-account", "student", "/account/settings", MOBILE],
  ["club-dashboard", "club", "/dashboard", DESKTOP],
  ["club-orders", "club", "/club/u-club/orders-dashboard", DESKTOP],
  ["club-analytics", "club", "/club/u-club/analytics", DESKTOP],
  ["club-templates", "club", "/club/u-club/templates", DESKTOP],
  ["club-reservations", "club", "/club/u-club/reservations-manager", DESKTOP],
  ["admin", "admin", "/admin", DESKTOP],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
let ok = 0;
const failures = [];

for (const [name, role, path, viewport, prep] of shots) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: SCALE });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  try {
    // Seed the role before the app boots so auth resolves correctly.
    await page.addInitScript((r) => localStorage.setItem("craves-mock-role", r), role);
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 20000 });
    await sleep(900); // let framer-motion entrances settle
    if (prep) await prep(page);
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
    const bad = errors.filter((e) => !/favicon|manifest/i.test(e));
    console.log(`  ${bad.length ? "WARN" : "OK  "}  ${name.padEnd(20)} ${path}${bad.length ? "  [console: " + bad[0].slice(0, 80) + "]" : ""}`);
    ok += 1;
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.log(`  FAIL  ${name.padEnd(20)} ${path}  ${err.message}`);
  } finally {
    await context.close();
  }
}

await browser.close();
console.log(`\n${ok}/${shots.length} captured to docs/screenshots/`);
if (failures.length) {
  console.log("Failures:\n" + failures.map((f) => "  " + f).join("\n"));
  process.exit(1);
}
