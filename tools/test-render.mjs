#!/usr/bin/env node
// The served HTML carries the whole map, and is what tools/render.mjs writes.
//
//   node tools/test-render.mjs     exit 0 when every arm holds, 1 otherwise
//
// Must-HOLD: for every family at every DRAM size, js/content.js's HTML names
// every region of the map (segments() from js/map.js, as the chart draws
// it), the decompress buffer, every firmware region and every boot path,
// each with its address range and size; and index.html and each family's
// page are exactly what render.mjs writes now (a stale page fails). The
// must-FIRE arm drops one region's range and requires the check to see it.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { esc, mainHtml, view, family, listedFamilies } from "../js/content.js";
import { mib } from "../js/map.js";
import { fill, familyPage, withKitRow, ORIGIN } from "./render.mjs";
import { withOg } from "./og.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(root, f), "utf8");
const data = JSON.parse(read("data/memory.json"));

let fail = 0;
let n = 0;
function arm(name, ok, detail = "") {
  n++;
  if (ok) console.log(`ok   ${name}`);
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}

/** What the HTML for this view must say, as escaped strings; returns those it lacks. */
function missing(html, v) {
  const want = [];
  for (const s of v.segs) want.push(s.label, v.range(s.start, s.end), `${mib(s.end - s.start)} MiB`);
  want.push(v.comp.var, v.range(v.cS, v.cE));
  for (const r of v.regs) want.push(r.label, v.range(r.start, r.end));
  if (v.fw) want.push(v.fw.name);
  for (const m of data.mechanisms) want.push(m.how, ...m.uses);
  for (const l of data.limits) want.push(l.what);
  return want.map(esc).filter((w) => !html.includes(w));
}

for (const fam of data.families) {
  for (const dram of fam.dram_sizes_mib) {
    const v = view(data, fam, dram);
    const lack = missing(mainHtml(data, fam, dram), v);
    arm(`${fam.id} at ${dram} MiB: every region, address and boot path in the HTML`,
      lack.length === 0, lack.join(" | "));
  }
}

// must-FIRE: a page missing one region's range is caught
{
  const fam = data.families[0], dram = fam.dram_sizes_mib[0];
  const v = view(data, fam, dram);
  const kernel = v.segs.find((s) => s.id === "kernel_addr_r");
  const cut = mainHtml(data, fam, dram).split(esc(v.range(kernel.start, kernel.end))).join("");
  arm("must-FIRE: a dropped region range is reported", missing(cut, v).length > 0);
}

// the committed pages are render.mjs's output now
const home = read("index.html");
const first = family(data, null);
arm("index.html is what render.mjs writes",
  home === fill(home, mainHtml(data, first, first.dram_sizes_mib[0]), `${ORIGIN}/`));
for (const fam of listedFamilies(data)) {
  let page = "";
  try { page = read(`${fam.id}/index.html`); } catch { /* missing: fails below */ }
  // (the kit's row, the trail ending with this family, is the page's own;
  // the share tags are drawn from the page's own title and canonical)
  arm(`${fam.id}/index.html is what render.mjs writes`, page === withOg(withKitRow(page, familyPage(home, data, fam))),
    "(run node tools/render.mjs)");
  arm(`${fam.id}/index.html opens that family`, page.includes(` data-soc="${fam.id}"`)
    && page.includes(`<link rel="canonical" href="${ORIGIN}/${fam.id}/">`));
}

// a hidden family is shown only under ?hidden=1: no page, and nothing a
// crawler reads names it (the default family is a listed one)
const hidden = data.families.filter((f) => f.hidden);
const crawled = ["index.html", "sitemap.xml", "llms.txt",
  ...listedFamilies(data).map((f) => `${f.id}/index.html`)].map(read).join("\n");
const names = (text, fam) => text.includes(`/${fam.id}/`) || text.includes(esc(fam.name));
for (const fam of hidden) {
  arm(`${fam.id} (hidden) has no page of its own`, !existsSync(join(root, fam.id, "index.html")));
  arm(`${fam.id} (hidden) is not named in the HTML, sitemap or llms.txt`, !names(crawled, fam));
  arm(`${fam.id} (hidden) is listed under ?hidden=1`, listedFamilies(data, true).includes(fam));
}
arm("the default family is a listed one", !family(data, null).hidden);
// must-FIRE: the same check sees a hidden family when a crawled file names it
if (hidden.length) {
  arm("must-FIRE: a hidden family's page link in llms.txt is caught",
    names(crawled + `\n- [x](${ORIGIN}/${hidden[0].id}/)`, hidden[0]));
}

console.log(`test-render: ${n - fail}/${n} arms pass`);
process.exit(fail ? 1 : 0);
