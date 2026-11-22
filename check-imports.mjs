import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  if (statSync(p).isDirectory()) return f === "node_modules" ? [] : walk(p);
  return p.endsWith(".js") ? [p] : [];
});
let missing = 0;
for (const file of walk("src")) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
    if (!existsSync(resolve(dirname(file), m[1]))) { console.log(`${file}\n    needs ${m[1]}`); missing++; }
  }
}
console.log(missing ? `\n${missing} missing import(s)` : "All relative imports resolve.");
