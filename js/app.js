import { mountShell } from "./lc-kit.js";
import {
  MiB, num, hex, mib, segments, ramdiskRoom, firmwareRegions, zeroWindow, ticks,
} from "./map.js";

const SVG = "http://www.w3.org/2000/svg";

/* Region colours come from the kit's theme variables, set through `style` so a
   theme change repaints the SVG with no redraw. */
const COLOR = {
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
const FW_COLORS = ["var(--c-jtag)", "var(--c-cec)", "var(--c-gpio)", "var(--c-clk)", "var(--c-nc)"];
const colorOf = (seg) => COLOR[seg.id] || COLOR[seg.kind] || "var(--c-misc)";

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

/**
 * One horizontal address bar from offset 0 to `total` bytes, with a MiB axis.
 * The window is [0, total]: a region's width is its size.
 */
function addressBar(host, total, regions, overlays = [], label = "") {
  host.replaceChildren();
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
  const ROW = 26, LABEL_W = 190, X1 = 940, TOP = 6;
  const H = TOP + rows.length * ROW + 40;
  // no list follows this one, so its label carries the numbers
  const svg = el("svg", { viewBox: `0 0 1000 ${H}`, class: "mm-svg", role: "img",
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

function legend(host, items) {
  host.replaceChildren();
  for (const it of items) {
    const li = html("li", null, host);
    const sw = html("span", null, li, "lc-swatch mm-swatch");
    sw.style.background = it.color;
    html("code", it.name, li);
    html("span", ` ${it.range} · ${it.size}`, li, "mm-range");
    if (it.note) html("span", ` — ${it.note}`, li, "mm-dim");
  }
}

function row(table, cells, head = false) {
  const tr = html("tr", null, table);
  for (const c of cells) {
    const td = html(head ? "th" : "td", null, tr);
    if (c instanceof Node) td.appendChild(c); else td.textContent = c;
  }
}

function code(text) {
  const c = document.createElement("code");
  c.textContent = text;
  return c;
}

async function main() {
  mountShell();
  const data = await (await fetch("data/memory.json")).json();
  const famSel = document.getElementById("family-select");
  const dramSel = document.getElementById("dram-select");
  for (const f of data.families) {
    const o = html("option", f.name, famSel);
    o.value = f.id;
  }
  const params = new URLSearchParams(location.search);
  if (params.get("soc")) famSel.value = params.get("soc");
  // a ?soc= this page does not know: the picker shows the family drawn
  if (famSel.selectedIndex < 0) famSel.value = data.families[0].id;

  // Only the sizes whose map is plain DRAM from the base are offered; a size
  // the family does not list falls back to its smallest.
  const fillDram = (fam) => {
    const keep = String(dramSel.value || params.get("dram") || "");
    dramSel.replaceChildren();
    for (const s of fam.dram_sizes_mib) {
      const o = html("option", s >= 1024 ? `${s / 1024} GiB` : `${s} MiB`, dramSel);
      o.value = String(s);
    }
    dramSel.value = fam.dram_sizes_mib.map(String).includes(keep) ? keep : String(fam.dram_sizes_mib[0]);
  };

  const render = () => {
    const fam = data.families.find((f) => f.id === famSel.value) || data.families[0];
    const dram = Number(dramSel.value);
    const base = num(fam.dram_base);
    const abs = (off) => hex(base + off);
    const range = (s, e) => `${abs(s)}–${abs(e - 1)}`;
    const q = new URLSearchParams({ soc: fam.id, dram: String(dram) });
    history.replaceState(null, "", `?${q}`);

    document.getElementById("lede").textContent =
      `${fam.name}, ${dram >= 1024 ? dram / 1024 + " GiB" : dram + " MiB"} of DRAM starting at ${hex(base)}. ` +
      data.unit_note;

    const segs = segments(data, dram, fam);
    const comp = data.nested.find((n) => n.var === "kernel_comp_addr_r");
    const cS = num(comp.offset), cE = cS + num(comp.size);
    addressBar(document.getElementById("map"), dram * MiB,
      segs.map((s) => ({
        start: s.start, end: s.end, color: colorOf(s),
        short: s.kind === "slot" ? s.label.replace(/_addr_r$/, "") : s.label,
        tip: `${s.label}\n${range(s.start, s.end)}\n${mib(s.end - s.start)} MiB`,
      })),
      [{ start: cS, end: cE, tip: `kernel_comp_addr_r (decompress buffer, inside the kernel slot)\n${range(cS, cE)}\n${mib(cE - cS)} MiB` }],
      `Address map of ${dram} MiB of DRAM from ${hex(base)}; each region is listed below`);
    legend(document.getElementById("map-legend"), [
      ...segs.map((s) => ({
        name: s.label, color: colorOf(s), range: range(s.start, s.end),
        size: `${mib(s.end - s.start)} MiB`, note: s.note,
      })),
      { name: "kernel_comp_addr_r", color: COLOR.kernel_comp_addr_r, range: range(cS, cE),
        size: `${mib(cE - cS)} MiB`, note: comp.holds },
    ]);

    const roomMiB = ramdiskRoom(data, dram, fam) / MiB;
    budgetBars(document.getElementById("budgets"), [
      ...data.slots.filter((s) => s.var).map((s) => ({
        label: s.var, color: COLOR[s.var],
        mib: s.grows ? roomMiB : num(s.size) / MiB,
      })),
      { label: "kernel_comp_addr_r", color: COLOR.kernel_comp_addr_r, mib: num(comp.size) / MiB },
    ]);

    const fw = firmwareRegions(data, fam);
    const fwSec = document.getElementById("fw-section");
    if (fw) {
      fwSec.hidden = false;
      document.getElementById("fw-title").textContent = fw.name;
      document.getElementById("fw-lede").textContent =
        `The first ${mib(fw.total)} MiB, drawn on its own scale. Each region's line below says how Linux sees it.`;
      const regs = fw.regions.map((r, i) => ({ ...r, color: FW_COLORS[i % FW_COLORS.length] }));
      addressBar(document.getElementById("firmware"), fw.total, regs.map((r) => ({
        start: r.start, end: r.end, color: r.color, short: r.short || r.label,
        tip: `${r.label} (${r.map})\n${range(r.start, r.end)}\n${mib(r.end - r.start)} MiB`,
      })), [], `${fw.name}: the first ${mib(fw.total)} MiB; each region is listed below`);
      legend(document.getElementById("fw-legend"), regs.map((r) => ({
        name: r.label, color: r.color, range: range(r.start, r.end),
        size: `${mib(r.end - r.start)} MiB, ${r.map}`, note: r.note,
      })));
    } else {
      fwSec.hidden = true;
    }

    const lim = document.getElementById("limits");
    lim.replaceChildren();
    row(lim, ["Payload", "Largest that fits (MiB)"], true);
    const smallest = Math.min(...fam.dram_sizes_mib);
    for (const l of data.limits) {
      if (l.computed === "ramdisk_room") {
        const floor = ramdiskRoom(data, smallest, fam);
        row(lim, [`${l.what}, on a ${smallest} MiB board`,
          `${mib(floor)} (${mib(roomMiB * MiB)} on this board)`]);
      } else {
        row(lim, [l.what, String(l.mib)]);
      }
    }
    const top = fam.uboot_top;
    row(lim, ["Held by U-Boot at the top of DRAM", `${mib(top.mib * MiB)} (${top.basis})`]);

    const st = document.getElementById("slots");
    st.replaceChildren();
    row(st, ["Variable", "Address", "Size (MiB)", "Holds"], true);
    for (const s of segs.filter((x) => x.kind === "slot")) {
      const src = data.slots.find((d) => d.var === s.id);
      const name = src.alias ? `${src.var} = ${src.alias}` : src.var;
      row(st, [code(name), code(abs(s.start)), mib(s.end - s.start) + (s.grows ? "+" : ""), src.holds]);
    }
    row(st, [code(comp.var), code(abs(cS)), mib(cE - cS), comp.holds]);
    row(st, [code("kernel_comp_size"), code(data.env.kernel_comp_size), "—",
      "the most compressed input booti reads"]);

    const mt = document.getElementById("mechanisms");
    mt.replaceChildren();
    row(mt, ["Boot path", "Addresses it uses"], true);
    for (const m of data.mechanisms) {
      const span = document.createElement("span");
      if (m.uses.length) {
        m.uses.forEach((u, i) => { if (i) span.append(", "); span.append(code(u)); });
      } else {
        span.textContent = m.note;
      }
      row(mt, [m.how, span]);
    }
    document.getElementById("caveat").textContent = data.caveat;
  };

  famSel.addEventListener("change", () => {
    fillDram(data.families.find((f) => f.id === famSel.value));
    render();
  });
  dramSel.addEventListener("change", render);
  fillDram(data.families.find((f) => f.id === famSel.value) || data.families[0]);
  render();
}

main().catch((e) => {
  const p = html("p", `Could not draw the map: ${e.message}`, document.getElementById("notices"), "lc-notice");
  p.setAttribute("role", "alert");
});
