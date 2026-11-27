/* The page's words and tables for one SoC family at one DRAM size, as HTML,
 * with no DOM: the one renderer of the map's content.
 *
 * js/app.js puts mainHtml() into <main> on every redraw and then draws the
 * charts into its empty boxes; tools/render.mjs writes the same string into
 * index.html and each family's page (/<family-id>/), so a reader that runs
 * no JavaScript gets the same names, addresses and sizes the page shows. The
 * numbers come from js/map.js, as the charts' do, so the two cannot disagree.
 */
import { MiB, num, hex, mib, segments, ramdiskRoom, firmwareRegions } from "./map.js";

/* Region colours come from the kit's theme variables, so a theme change
   repaints with no redraw. */
export const COLOR = {
  low: "var(--bg-sunken)",
  scriptaddr: "var(--c-uart)",
  pxefile_addr_r: "var(--c-i2c)",
  fdtoverlay_addr_r: "var(--c-sdio)",
  fdt_addr_r: "var(--c-pwm)",
  spare: "var(--border)",
  kernel_addr_r: "var(--c-eth)",
  kernel_comp_addr_r: "var(--c-powerlv)",
  ramdisk_addr_r: "var(--c-usb)",
  uboot: "var(--brass)",
  io: "var(--text-dim)",
  free: "var(--c-nc)",
};
/* Firmware regions are coloured one per region, in order, so two regions of
   the same mapping type are still told apart. */
export const FW_COLORS = ["var(--c-jtag)", "var(--c-cec)", "var(--c-gpio)", "var(--c-clk)", "var(--c-nc)"];
export const colorOf = (seg) => COLOR[seg.id] || COLOR[seg.kind] || "var(--c-misc)";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

export const dramLabel = (m) => (m >= 1024 ? `${m / 1024} GiB` : `${m} MiB`);

/** The families a visitor is shown. One marked `"hidden": true` (no public
 *  board uses it yet) is listed only under ?hidden=1, the switch every Libre
 *  Computer tool uses; it gets no page of its own, and no line in the sitemap
 *  or llms.txt. */
export function listedFamilies(data, showHidden = false) {
  return data.families.filter((f) => showHidden || !f.hidden);
}

/** A family by id, else the first listed (the page's default). */
export function family(data, id) {
  return data.families.find((f) => f.id === id) || listedFamilies(data)[0];
}

/** The DRAM size drawn for `wanted` MiB: it when the family offers it, else its smallest. */
export function dramFor(fam, wanted) {
  return fam.dram_sizes_mib.includes(Number(wanted)) ? Number(wanted) : fam.dram_sizes_mib[0];
}

/** Everything the content and the charts read, for one family at one size. */
export function view(data, fam, dram) {
  const base = num(fam.dram_base);
  const abs = (off) => hex(base + off);
  const range = (s, e) => `${abs(s)}–${abs(e - 1)}`;
  const segs = segments(data, dram, fam);
  const comp = data.nested.find((n) => n.var === "kernel_comp_addr_r");
  const cS = num(comp.offset), cE = cS + num(comp.size);
  const fw = firmwareRegions(data, fam);
  const regs = fw ? fw.regions.map((r, i) => ({ ...r, color: FW_COLORS[i % FW_COLORS.length] })) : [];
  return { fam, dram, base, abs, range, segs, comp, cS, cE, fw, regs,
    roomMiB: ramdiskRoom(data, dram, fam) / MiB };
}

const code = (t) => `<code>${esc(t)}</code>`;
const tr = (cells, head = false) => {
  const t = head ? "th" : "td";
  return `<tr>${cells.map((c) => `<${t}>${c}</${t}>`).join("")}</tr>`;
};
const legend = (id, items) => `<ol class="mm-legend" id="${id}">${items.map((it) =>
  `<li><span class="lc-swatch mm-swatch" style="background: ${esc(it.color)}"></span>` +
  `${code(it.name)}<span class="mm-range"> ${esc(it.range)} · ${esc(it.size)}</span>` +
  (it.note ? `<span class="mm-dim"> — ${esc(it.note)}</span>` : "") + "</li>").join("")}</ol>`;
const section = (body, id = "") => `<section class="mm-section"${id ? ` id="${id}"` : ""}>${body}</section>`;
const table = (id, rows) => `<div class="lc-table-scroll"><table class="lc-table" id="${id}">${rows.join("")}</table></div>`;

/** The inside of <main>: every section, with the charts' boxes left empty for app.js. */
export function mainHtml(data, fam, dram) {
  const v = view(data, fam, dram);
  const { abs, range, segs, comp, cS, cE, fw, regs, roomMiB } = v;
  const out = [`<h1 class="lc-vh">Memory map: ${esc(fam.name)}</h1>`];

  out.push(section(
    "<h2>The whole map</h2>" +
    `<p class="mm-lede" id="lede">${esc(`${fam.name}, ${dramLabel(dram)} of DRAM starting at ${hex(v.base)}. ${data.unit_note}`)}</p>` +
    '<div id="map" class="mm-chart"></div>' +
    legend("map-legend", [
      ...segs.map((s) => ({ name: s.label, color: colorOf(s), range: range(s.start, s.end),
        size: `${mib(s.end - s.start)} MiB`, note: s.note })),
      { name: comp.var, color: COLOR.kernel_comp_addr_r, range: range(cS, cE),
        size: `${mib(cE - cS)} MiB`, note: comp.holds },
    ])));

  out.push(section(
    "<h2>Room for each file</h2>" +
    '<p class="mm-lede">The size of each load slot. The boot files are small next to the kernel and the initramfs, so they get their own scale here rather than a sliver of the map above.</p>' +
    '<div id="budgets" class="mm-chart"></div>'));

  if (fw) {
    out.push(section(
      `<h2 id="fw-title">${esc(fw.name)}</h2>` +
      `<p class="mm-lede" id="fw-lede">${esc(`The first ${mib(fw.total)} MiB, drawn on its own scale. Each region's line below says how Linux sees it.`)}</p>` +
      '<div id="firmware" class="mm-chart"></div>' +
      legend("fw-legend", regs.map((r) => ({ name: r.label, color: r.color, range: range(r.start, r.end),
        size: `${mib(r.end - r.start)} MiB, ${r.map}`, note: r.note }))), "fw-section"));
  }

  const smallest = Math.min(...fam.dram_sizes_mib);
  const lim = [tr(["Payload", "Largest that fits (MiB)"], true)];
  for (const l of data.limits) {
    if (l.computed === "ramdisk_room") {
      lim.push(tr([esc(`${l.what}, on a ${smallest} MiB board`),
        esc(`${mib(ramdiskRoom(data, smallest, fam))} (${mib(roomMiB * MiB)} on this board)`)]));
    } else {
      lim.push(tr([esc(l.what), esc(String(l.mib))]));
    }
  }
  const top = fam.uboot_top;
  lim.push(tr(["Held by U-Boot at the top of DRAM", esc(`${mib(top.mib * MiB)} (${top.basis})`)]));
  out.push(section("<h2>What fits</h2>" + table("limits", lim)));

  const st = [tr(["Variable", "Address", "Size (MiB)", "Holds"], true)];
  for (const s of segs.filter((x) => x.kind === "slot")) {
    const src = data.slots.find((d) => d.var === s.id);
    st.push(tr([code(src.alias ? `${src.var} = ${src.alias}` : src.var), code(abs(s.start)),
      esc(mib(s.end - s.start) + (s.grows ? "+" : "")), esc(src.holds)]));
  }
  st.push(tr([code(comp.var), code(abs(cS)), esc(mib(cE - cS)), esc(comp.holds)]));
  st.push(tr([code("kernel_comp_size"), code(data.env.kernel_comp_size), "—",
    "the most compressed input booti reads"]));
  out.push(section("<h2>Addresses</h2>" + table("slots", st)));

  const mt = [tr(["Boot path", "Addresses it uses"], true)];
  for (const m of data.mechanisms) {
    mt.push(tr([esc(m.how), m.uses.length ? m.uses.map(code).join(", ") : esc(m.note)]));
  }
  out.push(section("<h2>Which boot path uses which address</h2>" + table("mechanisms", mt) +
    `<p class="mm-note" id="caveat">${esc(data.caveat)}</p>`));

  return "\n  " + out.join("\n  ") + "\n";
}
