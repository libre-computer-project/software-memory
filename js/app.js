import { mountShell, showHiddenFlag } from "./lc-kit.js";
import { MiB, num, hex, mib, zeroWindow, ticks, spreadLabels } from "./map.js";
import { COLOR, colorOf, dramLabel, family, listedFamilies, mainHtml, view } from "./content.js";

const SVG = "http://www.w3.org/2000/svg";

function el(name, attrs = {}, parent = null) {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function html(tag, text, parent, cls) {
  const e = document.createElement(tag);
  if (text !== undefined && text !== null) e.textContent = text;
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

/* Below this the maps run down the screen (narrow: a phone, the product
   page's frame); the stylesheet's breakpoint is the same. */
const NARROW = window.matchMedia("(max-width: 720px)");

/**
 * The address map on a narrow screen: a bar from the DRAM base at the top
 * down to `total`, in proportion, and every region's name and size beside
 * it at full text size. The drawing is in the box's own pixels (viewBox =
 * its width), so 13 is 13px; labels are spread so none overlap
 * (spreadLabels), with a leader line back to their slot.
 */
function addressColumn(host, total, regions, overlays, label) {
  const W = Math.max(280, host.clientWidth || 360);
  const LINE = 20, TOP = 26, AXIS_X = 40, BAR_X = 46, BAR_W = 34, TEXT_X = BAR_X + BAR_W + 22;
  const items = [
    ...regions.map((r) => ({ ...r, overlay: false })),
    ...overlays.map((o) => ({ ...o, overlay: true, short: o.tip.split(" ")[0] })),
  ].sort((a, b) => (a.start + a.end) - (b.start + b.end));
  const BAR_H = Math.max(360, items.length * LINE + 20);
  const H = TOP + BAR_H + 12;
  const y = (b) => TOP + (b / total) * BAR_H;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "mm-svg mm-svg-col",
    role: "img", "aria-label": label });

  const title = el("text", { x: 0, y: 15, class: "mm-axis-title" }, svg);
  title.textContent = "Offset from the DRAM base (MiB), downward";
  for (const r of regions) {
    const rect = el("rect", { x: BAR_X, y: y(r.start), width: BAR_W,
      height: Math.max(y(r.end) - y(r.start), 0.5), class: "mm-region" }, svg);
    rect.setAttribute("style", `fill: ${r.color}`);
    el("title", {}, rect).textContent = r.tip;
  }
  for (const o of overlays) {
    const rect = el("rect", { x: BAR_X + 4, y: y(o.start), width: BAR_W - 8,
      height: y(o.end) - y(o.start), class: "mm-overlay" }, svg);
    el("title", {}, rect).textContent = o.tip;
  }
  el("line", { x1: AXIS_X, x2: AXIS_X, y1: TOP, y2: TOP + BAR_H, class: "mm-axis" }, svg);
  for (const t of ticks(total / MiB)) {
    const ty = y(t * MiB);
    el("line", { x1: AXIS_X - 4, x2: AXIS_X, y1: ty, y2: ty, class: "mm-axis" }, svg);
    const lab = el("text", { x: AXIS_X - 6, y: ty + 4, class: "mm-tick", "text-anchor": "end" }, svg);
    lab.textContent = String(t);
  }

  const mids = items.map((it) => y((it.start + it.end) / 2));
  const at = spreadLabels(mids, LINE, TOP + 9, TOP + BAR_H);
  items.forEach((it, i) => {
    el("polyline", { points: `${BAR_X + BAR_W},${mids[i]} ${TEXT_X - 8},${at[i] - 4} ${TEXT_X - 3},${at[i] - 4}`,
      class: "mm-leader" }, svg);
    const t = el("text", { x: TEXT_X, y: at[i], class: "mm-col-label" }, svg);
    t.textContent = `${it.overlay ? "↳ " : ""}${it.short} · ${mib(it.end - it.start)} MiB`;
  });
  host.appendChild(svg);
}

/**
 * One horizontal address bar from offset 0 to `total` bytes, with a MiB axis.
 * The window is [0, total]: a region's width is its size.
 */
function addressBar(host, total, regions, overlays = [], label = "") {
  host.replaceChildren();
  if (NARROW.matches) return addressColumn(host, total, regions, overlays, label);
  const W = 1000, H = 92, X0 = 14, X1 = 972, BAR_Y = 8, BAR_H = 40;
  // role=img hides the rectangles' own titles, so the picture is named whole;
  // the list after it carries every region in words
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "mm-svg", role: "img", "aria-label": label });
  const x = (b) => X0 + (b / total) * (X1 - X0);

  for (const r of regions) {
    const rect = el("rect", {
      x: x(r.start), y: BAR_Y, width: Math.max(x(r.end) - x(r.start), 0.5), height: BAR_H,
      class: "mm-region",
    }, svg);
    rect.setAttribute("style", `fill: ${r.color}`);
    el("title", {}, rect).textContent = r.tip;
    // Label inside only when it fits; a region with an overlay is labelled in
    // the part before it, so the outline never runs through the text.
    const over = overlays.find((o) => o.start > r.start && o.start < r.end);
    const room = x(over ? over.start : r.end) - x(r.start);
    const fits = (s) => s.length * 7.5 + 12 <= room;
    const text = fits(r.short) ? r.short : fits(r.short.split(" ")[0]) ? r.short.split(" ")[0] : null;
    if (text) {
      const t = el("text", { x: x(r.start) + room / 2, y: BAR_Y + BAR_H / 2 + 5,
        class: "mm-in-label", "text-anchor": "middle" }, svg);
      t.textContent = text;
    }
  }
  for (const o of overlays) {
    const rect = el("rect", {
      x: x(o.start), y: BAR_Y + 4, width: x(o.end) - x(o.start), height: BAR_H - 8,
      class: "mm-overlay",
    }, svg);
    el("title", {}, rect).textContent = o.tip;
  }

  // Axis: ticks in MiB, bare; the unit is on the title, once.
  const totalMiB = total / MiB;
  const axisY = BAR_Y + BAR_H + 6;
  el("line", { x1: X0, x2: X1, y1: axisY, y2: axisY, class: "mm-axis" }, svg);
  for (const t of ticks(totalMiB)) {
    const tx = x(t * MiB);
    el("line", { x1: tx, x2: tx, y1: axisY, y2: axisY + 5, class: "mm-axis" }, svg);
    const lab = el("text", { x: tx, y: axisY + 17, class: "mm-tick", "text-anchor": "middle" }, svg);
    lab.textContent = String(t);
  }
  const title = el("text", { x: (X0 + X1) / 2, y: H - 2, class: "mm-axis-title",
    "text-anchor": "middle" }, svg);
  title.textContent = "Offset from the DRAM base (MiB)";
  host.appendChild(svg);
}

/** Horizontal bars of size, from 0. */
function budgetBars(host, rows) {
  host.replaceChildren();
  // narrow: drawn in the box's own pixels, so the text is its real size
  const W = NARROW.matches ? Math.max(280, host.clientWidth || 360) : 1000;
  const ROW = 26, TOP = 6;
  const LABEL_W = NARROW.matches ? Math.min(190, Math.round(W * 0.5)) : 190;
  // room right of the longest bar for its value ("1656.96")
  const X1 = W - (NARROW.matches ? 64 : 60);
  const H = TOP + rows.length * ROW + 40;
  // no list follows this one, so its label carries the numbers
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "mm-svg", role: "img",
    "aria-label": "Room for each file, in MiB: " + rows.map((r) => `${r.label} ${mib(r.mib * MiB)}`).join(", ") });
  const w = zeroWindow(rows.map((r) => r.mib));
  const x = (v) => LABEL_W + ((v - w.lo) / (w.hi - w.lo)) * (X1 - LABEL_W);

  rows.forEach((r, i) => {
    const y = TOP + i * ROW;
    const name = el("text", { x: LABEL_W - 8, y: y + 16, class: "mm-row-label", "text-anchor": "end" }, svg);
    name.textContent = r.label;
    const rect = el("rect", { x: x(0), y: y + 3, width: Math.max(x(r.mib) - x(0), 1), height: ROW - 8,
      class: "mm-region" }, svg);
    rect.setAttribute("style", `fill: ${r.color}`);
    el("title", {}, rect).textContent = `${r.label}: ${mib(r.mib * MiB)} MiB`;
    const val = el("text", { x: x(r.mib) + 6, y: y + 16, class: "mm-value" }, svg);
    val.textContent = mib(r.mib * MiB);
  });

  const axisY = TOP + rows.length * ROW + 2;
  el("line", { x1: x(0), x2: X1, y1: axisY, y2: axisY, class: "mm-axis" }, svg);
  for (const t of ticks(w.hi, 6)) {
    if (t > w.hi) continue;
    el("line", { x1: x(t), x2: x(t), y1: axisY, y2: axisY + 5, class: "mm-axis" }, svg);
    const lab = el("text", { x: x(t), y: axisY + 17, class: "mm-tick", "text-anchor": "middle" }, svg);
    lab.textContent = String(t);
  }
  const title = el("text", { x: (x(0) + X1) / 2, y: H - 2, class: "mm-axis-title", "text-anchor": "middle" }, svg);
  title.textContent = "Room (MiB)";
  host.appendChild(svg);
}

/** The family a generated page is for: <family-id>/index.html, written by
 * tools/render.mjs, says so on its body (data-soc). Null on the home page. */
const pageSoc = () => document.body.dataset.soc || null;

async function main() {
  mountShell();
  // beside this module, not the page: a family's page is a directory down
  const data = await (await fetch(new URL("../data/memory.json", import.meta.url))).json();
  const famSel = document.getElementById("family-select");
  const dramSel = document.getElementById("dram-select");
  const params = new URLSearchParams(location.search);
  // a family no public board uses yet is listed only under ?hidden=1
  const showHidden = params.get("hidden") === "1";
  const shown = listedFamilies(data, showHidden);
  for (const f of shown) {
    const o = html("option", f.name, famSel);
    o.value = f.id;
  }
  showHiddenFlag(shown.length - listedFamilies(data).length,
    "?hidden=1: SoC families no public board uses yet are listed");
  const wanted = params.get("soc") || pageSoc();
  if (wanted) famSel.value = wanted;
  // a ?soc= this page does not list: the picker shows the family drawn
  if (famSel.selectedIndex < 0) famSel.value = shown[0].id;

  // Only the sizes whose map is plain DRAM from the base are offered; a size
  // the family does not list falls back to its smallest.
  const fillDram = (fam) => {
    const keep = String(dramSel.value || params.get("dram") || "");
    dramSel.replaceChildren();
    for (const s of fam.dram_sizes_mib) {
      const o = html("option", dramLabel(s), dramSel);
      o.value = String(s);
    }
    dramSel.value = fam.dram_sizes_mib.map(String).includes(keep) ? keep : String(fam.dram_sizes_mib[0]);
  };

  const render = () => {
    const fam = family(data, famSel.value);
    const dram = Number(dramSel.value);
    // a family's own page says the family in its path, so ?soc= is left out
    // unless it asked for another one
    const q = new URLSearchParams();
    if (fam.id !== pageSoc()) q.set("soc", fam.id);
    q.set("dram", String(dram));
    // inside a product page's frame (the kit's embed mode): keep it so, or a
    // reload in the frame comes back as the whole tool
    for (const k of ["embed", "theme", "hidden"]) if (params.get(k)) q.set(k, params.get(k));
    history.replaceState(null, "", `?${q}`);

    // the words and tables: the same function tools/render.mjs writes into
    // the page, so the served HTML and this redraw are one renderer
    document.getElementById("main").innerHTML = mainHtml(data, fam, dram);
    const { base, range, segs, comp, cS, cE, fw, regs, roomMiB } = view(data, fam, dram);
    addressBar(document.getElementById("map"), dram * MiB,
      segs.map((s) => ({
        start: s.start, end: s.end, color: colorOf(s),
        short: s.kind === "slot" ? s.label.replace(/_addr_r$/, "") : s.label,
        tip: `${s.label}\n${range(s.start, s.end)}\n${mib(s.end - s.start)} MiB`,
      })),
      [{ start: cS, end: cE, tip: `kernel_comp_addr_r (decompress buffer, inside the kernel slot)\n${range(cS, cE)}\n${mib(cE - cS)} MiB` }],
      `Address map of ${dram} MiB of DRAM from ${hex(base)}; each region is listed below`);

    budgetBars(document.getElementById("budgets"), [
      ...data.slots.filter((s) => s.var).map((s) => ({
        label: s.var, color: COLOR[s.var],
        mib: s.grows ? roomMiB : num(s.size) / MiB,
      })),
      { label: "kernel_comp_addr_r", color: COLOR.kernel_comp_addr_r, mib: num(comp.size) / MiB },
    ]);

    if (fw) {
      addressBar(document.getElementById("firmware"), fw.total, regs.map((r) => ({
        start: r.start, end: r.end, color: r.color, short: r.short || r.label,
        tip: `${r.label} (${r.map})\n${range(r.start, r.end)}\n${mib(r.end - r.start)} MiB`,
      })), [], `${fw.name}: the first ${mib(fw.total)} MiB; each region is listed below`);
    }
  };

  famSel.addEventListener("change", () => {
    // on a family's own page another family is another page; ?embed=,
    // ?theme= and ?dram= go along
    const here = pageSoc();
    if (here && famSel.value !== here) {
      // a hidden family has no page: the home page draws it from ?soc=
      const hidden = family(data, famSel.value).hidden;
      const url = new URL(hidden ? "../" : `../${encodeURIComponent(famSel.value)}/`, location.href);
      url.search = location.search;
      if (hidden) url.searchParams.set("soc", famSel.value);
      else url.searchParams.delete("soc");
      location.assign(url);
      return;
    }
    fillDram(family(data, famSel.value));
    render();
  });
  dramSel.addEventListener("change", render);
  fillDram(family(data, famSel.value));
  render();
  // The narrow drawing is in the box's own pixels, so a change of width
  // (a rotated phone, crossing the breakpoint) draws it again.
  let resizeTimer = 0;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 120);
  });
}

main().catch((e) => {
  const p = html("p", `Could not draw the map: ${e.message}`, document.getElementById("notices"), "lc-notice");
  p.setAttribute("role", "alert");
});
