// Stage the app's compiled Tailwind CSS for design-sync.
// Strips @font-face rules whose url()s are absolute app-server paths
// (/assets/…, /fonts/…) — unresolvable inside a design bundle. The brand faces
// are re-declared against copyable sources in .design-sync/fonts.css.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const file = readdirSync("dist/assets").find((f) => /^index-.*\.css$/.test(f));
if (!file) throw new Error("no dist/assets/index-*.css — run the app build first");
const css = readFileSync(`dist/assets/${file}`, "utf8");
const stripped = css.replace(/@font-face\s*\{[^}]*\}/g, "");
writeFileSync(".design-sync/compiled.css", stripped);
const dropped = (css.match(/@font-face\s*\{[^}]*\}/g) ?? []).length;
console.log(`prep-css: ${file} → .design-sync/compiled.css (${dropped} unresolvable @font-face rules stripped)`);
