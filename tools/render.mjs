#!/usr/bin/env node
/** Draws the memory map's words and tables into the HTML with js/content.js,
 * the renderer js/app.js redraws with, so a reader or crawler that runs no
 * JavaScript (GPTBot, ClaudeBot, a link preview) gets every address and
 * size, and writes what a crawler looks for beside them:
 *
 *   index.html                 the default family's map in <main>, a canonical
 *   <family-id>/index.html     one page per SoC family (data/memory.json)
 *   robots.txt, sitemap.xml, llms.txt
 *
 *     node tools/render.mjs
 *
 * Run it after changing index.html, js/content.js or data/memory.json, and
 * commit what it writes (README "Render"). Running it twice changes nothing.
 */
import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { esc, mainHtml } from "../js/content.js";
import { sitemapWithLastmod } from "./lastmod.mjs";
import { stampOg } from "./og.mjs";

export const ORIGIN = "https://memory.software.libre.computer";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFile(path.join(ROOT, f), "utf8");
const meta = (html, re) => (html.match(re) || [, ""])[1];

/** `html` with `content` as its <main> and a canonical for `url`. The whole
 *  <main> is replaced, so a second run replaces rather than nests. */
export function fill(html, content, url) {
  html = html.replace(/(<main\b[^>]*>)[\s\S]*?(<\/main>)/, (_, open, close) => `${open}${content}${close}`);
  const canon = `<link rel="canonical" href="${esc(url)}">`;
  return /<link rel="canonical"[^>]*>/.test(html)
    ? html.replace(/<link rel="canonical"[^>]*>/, canon)
    : html.replace(/(<meta name="description"[^>]*>)/, `$1\n${canon}`);
}

/** A family's page from the home page: its map, title, description,
 *  canonical and data-soc, and every local asset one directory up. */
export function familyPage(home, data, fam) {
  const desc = meta(home, /<meta name="description" content="([^"]*)"/);
  const title = meta(home, /<title>([^<]*)<\/title>/);
  return fill(home, mainHtml(data, fam, fam.dram_sizes_mib[0]), `${ORIGIN}/${fam.id}/`)
    .replace(/<title>[^<]*<\/title>/, () => `<title>${esc(fam.name)} — ${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*"/, (_, a) => `${a}${esc(`${fam.name}: ${desc}`)}"`)
    .replace(/<body([^>]*?)( data-soc="[^"]*")?>/, (_, a) => `<body${a} data-soc="${esc(fam.id)}">`)
    .replace(/(\s(?:src|href)=")(?![a-z]+:|\/|#|\.\.\/)/g, "$1../");
}

/** The kit's second row as tools/lc-ui-kit/sync.py last wrote it into this
 *  family page (its trail ends with the family: Memory › Amlogic): kept, so
 *  a render alone changes nothing; sync.py rewrites it when the kit moves. */
const KIT_ROW = /[ \t]*<div class="lc-subnav-sites">[\s\S]*?<\/div>/;
export function withKitRow(old, html) {
  const kept = old.match(KIT_ROW);
  return kept && KIT_ROW.test(html) ? html.replace(KIT_ROW, () => kept[0]) : html;
}
async function keepKitRow(file, html) {
  return withKitRow(await readFile(file, "utf8").catch(() => ""), html);
}

async function main() {
  const data = JSON.parse(await read("data/memory.json"));
  const fams = data.families;

  // the home page draws the first family at its smallest size, as app.js opens it
  const home = fill(await read("index.html"), mainHtml(data, fams[0], fams[0].dram_sizes_mib[0]), `${ORIGIN}/`);
  await writeFile(path.join(ROOT, "index.html"), home);
  const sitemap = [`${ORIGIN}/`];

  for (const fam of fams) {
    await mkdir(path.join(ROOT, fam.id), { recursive: true });
    const file = path.join(ROOT, fam.id, "index.html");
    await writeFile(file, await keepKitRow(file, familyPage(home, data, fam)));
    sitemap.push(`${ORIGIN}/${fam.id}/`);
  }
  // a family that left the data: its page goes too (only pages this wrote)
  for (const d of await readdir(ROOT, { withFileTypes: true })) {
    if (!d.isDirectory() || fams.some((f) => f.id === d.name)) continue;
    const f = path.join(ROOT, d.name, "index.html");
    if ((await readFile(f, "utf8").catch(() => "")).includes(" data-soc=")) await rm(path.dirname(f), { recursive: true });
  }

  await writeFile(path.join(ROOT, "robots.txt"), `User-agent: *\nContent-Signal: search=yes, ai-input=yes, ai-train=yes\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  await stampOg(ROOT, ORIGIN, sitemap);
  await writeFile(path.join(ROOT, "sitemap.xml"), await sitemapWithLastmod(ROOT, ORIGIN, sitemap));

  // the data names each family's SoCs (in its name), not the boards that use them
  await writeFile(path.join(ROOT, "llms.txt"), [
    `# ${meta(home, /<title>([^<]*)<\/title>/)}`, "",
    `> ${meta(home, /<meta name="description" content="([^"]*)"/)}`, "",
    "Part of Libre Computer (https://libre.computer/llms.txt). The map is per SoC family; " +
      "every page carries its addresses and sizes as HTML tables.", "",
    "## SoC families", "",
    ...fams.map((f) => `- [${f.name}](${ORIGIN}/${f.id}/)`), "",
  ].join("\n"));

  console.log(`rendered index.html, ${fams.length} family pages (${fams.map((f) => f.id).join(", ")}), robots.txt, sitemap.xml, llms.txt`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
