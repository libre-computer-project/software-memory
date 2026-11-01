#!/usr/bin/env node
// Invariants of the memory map and of every chart window on the page.
//
//   node tools/test-map.mjs        exit 0 when every arm holds, 1 otherwise
//
// Must-HOLD arms check the data and the windows. The must-FIRE arms build the
// two things this page must never publish -- a truncated (non-zero) axis
// window, and a map that does not fit its board -- and require them to be
// rejected. Without those, every HOLD could pass against a checker that
// cannot fail.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MiB, num, segments, ramdiskRoom, firmwareRegions, zeroWindow, isZeroBased, ticks, spreadLabels,
} from "../js/map.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(root, "data/memory.json"), "utf8"));

let fail = 0;
let n = 0;
function arm(name, ok, detail = "") {
  n++;
  if (ok) console.log(`ok   ${name}`);
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}

const slot = (v) => data.slots.find((s) => s.var === v);

// The map covers [0, DRAM) contiguously for every family at every size offered.
for (const f of data.families) {
  for (const size of f.dram_sizes_mib) {
    const segs = segments(data, size, f);
    let at = 0, gap = null;
    for (const s of segs) { if (s.start !== at || s.end <= s.start) gap = s.id; at = s.end; }
    arm(`contiguous map: ${f.id} at ${size} MiB`,
      gap === null && segs[0].start === 0 && at === size * MiB, `gap at ${gap}, end ${at}`);
  }
}

// A family's ramdisk stop holds at every size: the slot never passes it.
const mtk = data.families.find((f) => f.ramdisk_stop);
for (const size of mtk.dram_sizes_mib) {
  const rd = segments(data, size, mtk).find((s) => s.id === "ramdisk_addr_r");
  arm(`ramdisk stops at ${mtk.ramdisk_stop} on ${mtk.id} at ${size} MiB`,
    rd.end <= num(mtk.ramdisk_stop));
}

// A family's RAM top holds: U-Boot ends at it, and what lies past it is
// drawn as the I/O window, not as RAM U-Boot could use.
for (const f of data.families.filter((x) => x.ram_top_mib)) {
  for (const size of f.dram_sizes_mib.filter((s) => s > f.ram_top_mib)) {
    const segs = segments(data, size, f);
    const ub = segs.find((s) => s.id === "uboot");
    const io = segs.at(-1);
    arm(`${f.id} at ${size} MiB: U-Boot ends at ram_top_mib ${f.ram_top_mib}`,
      ub.end === f.ram_top_mib * MiB);
    arm(`${f.id} at ${size} MiB: the I/O window fills the rest`,
      io.id === "io" && io.start === f.ram_top_mib * MiB && io.end === size * MiB);
    arm(`${f.id} at ${size} MiB: the ramdisk stays below U-Boot`,
      segs.find((s) => s.id === "ramdisk_addr_r").end <= ub.start);
  }
}
// must-FIRE: without the cap, a 4 GiB map would put U-Boot in the I/O window.
const rk = data.families.find((f) => f.id === "rockchip");
arm("must-FIRE: uncapped 4096 MiB map puts U-Boot past 0xF8000000",
  segments(data, 4096, { ...rk, ram_top_mib: undefined }).find((s) => s.id === "uboot").end > rk.ram_top_mib * MiB);

// Every family's smallest board fits the map.
for (const f of data.families) {
  let ok = true;
  const smallest = Math.min(...f.dram_sizes_mib);
  try { segments(data, smallest, f); } catch (_) { ok = false; }
  arm(`map fits ${f.id} at ${smallest} MiB`, ok);
  arm(`${f.id} sizes ascend`, f.dram_sizes_mib.every((s, i, a) => i === 0 || s > a[i - 1]));
}

// Slot facts the page states.
const k = slot("kernel_addr_r");
arm("kernel slot is 2 MiB-aligned", num(k.offset) % (2 * MiB) === 0);
const comp = data.nested.find((x) => x.var === "kernel_comp_addr_r");
const cStart = num(comp.offset), cEnd = cStart + num(comp.size);
const kStart = num(k.offset), kEnd = kStart + num(k.size);
arm("decompress buffer inside the kernel slot", cStart >= kStart && cEnd <= kEnd);
arm("compressed source cannot reach the decompress buffer",
  kStart + num(data.env.kernel_comp_size) <= cStart);
// U-Boot's top is the family's own figure, with a stated basis.
for (const f of data.families) {
  const t = f.uboot_top;
  arm(`${f.id}: uboot_top has mib, basis and note`,
    t && t.mib > 0 && ["measured", "from the build configuration"].includes(t.basis) && !!t.note);
  arm(`${f.id}: U-Boot region on the map is uboot_top`,
    segments(data, f.dram_sizes_mib[0], f).at(-1).end - segments(data, f.dram_sizes_mib[0], f).at(-1).start
      === t.mib * MiB);
}
const aml = data.families.find((f) => f.id === "amlogic");
const amlRoom512 = ramdiskRoom(data, 512, aml);
arm("amlogic ramdisk room on 512 MiB = 512 MiB - top - 0x0D600000",
  amlRoom512 === 512 * MiB - aml.uboot_top.mib * MiB - num(slot("ramdisk_addr_r").offset));

// The limits table is the data, not a second answer.
const lim = Object.fromEntries(data.limits.map((l) => [l.what, l.mib]));
arm("limit: raw kernel = kernel slot", lim["Raw kernel (header image_size)"] === num(k.size) / MiB);
arm("limit: compressed file = kernel_comp_size",
  lim["Compressed kernel file"] === num(data.env.kernel_comp_size) / MiB);
arm("limit: decompressed = buffer", lim["Compressed kernel, decompressed"] === num(comp.size) / MiB);
arm("limit: initramfs is computed per family, not a stored number",
  data.limits.some((l) => l.computed === "ramdisk_room" && l.mib === undefined));
arm("limit: dtb = fdt slot", lim["Device tree with overlays"] === num(slot("fdt_addr_r").size) / MiB);
arm("limit: script = script slot", lim["Boot script"] === num(slot("scriptaddr").size) / MiB);

// Firmware block is contiguous from 0.
const fw = firmwareRegions(data, data.families.find((f) => f.id === "amlogic"));
let fat = 0, fgap = false;
for (const r of fw.regions) { if (r.start !== fat) fgap = true; fat = r.end; }
arm("firmware block contiguous from 0", !fgap && fat === fw.total);

// Labels beside the vertical map: in order, never closer than the gap,
// inside the bar, for every family at every size (the regions' middles).
const okSpread = (ys, gap, lo, hi) =>
  ys.every((y, i) => y >= lo - 1e-9 && y <= hi + 1e-9 && (i === 0 || y - ys[i - 1] >= gap - 1e-9));
for (const f of data.families) {
  for (const size of f.dram_sizes_mib) {
    const segs = segments(data, size, f);
    const H = Math.max(360, segs.length * 20 + 20);
    const mids = segs.map((s) => 10 + ((s.start + s.end) / 2 / (size * MiB)) * H);
    arm(`labels spread: ${f.id} at ${size} MiB`, okSpread(spreadLabels(mids, 20, 10, 10 + H), 20, 10, 10 + H));
  }
}
// must-FIRE: labels that all want the same place are pulled apart, and the
// unspread input would have failed the same check.
const crowd = [100, 100, 100, 100, 299];
arm("must-FIRE: crowded labels fail unspread", !okSpread(crowd, 20, 0, 300));
arm("crowded labels spread", okSpread(spreadLabels(crowd, 20, 0, 300), 20, 0, 300));
arm("labels pushed off the bottom come back inside",
  okSpread(spreadLabels([290, 295, 300, 300], 20, 0, 300), 20, 0, 300));

// Every window is zero-based, whatever the values.
const cases = {
  spread: [1, 2, 144, 154],
  "near-identical": [1000, 1001, 1002],
  "all-equal": [64, 64, 64],
  "far-from-zero": [3000, 3100],
  single: [154],
  empty: [],
  "non-finite": [NaN, Infinity, 12],
};
for (const [name, v] of Object.entries(cases)) {
  arm(`zero window: ${name}`, isZeroBased(zeroWindow(v)));
}

// Ticks start at zero and stay inside the window.
for (const hi of [16, 154, 512, 4096]) {
  const t = ticks(hi);
  arm(`ticks 0..${hi}`, t[0] === 0 && t[t.length - 1] <= hi && t.length >= 2);
}

// must-FIRE: a truncating window (lo = smallest value) is rejected.
const vals = [64, 144, 154];
arm("must-FIRE: truncated window rejected", !isZeroBased({ lo: Math.min(...vals), hi: Math.max(...vals) }));

// must-FIRE: a board too small for the map is refused, not drawn.
let threw = false;
try { segments(data, 256, aml); } catch (_) { threw = true; }
arm("must-FIRE: 256 MiB board refused", threw);

// must-FIRE: a family with no U-Boot top is refused, not drawn with a default.
threw = false;
try { segments(data, 1024, { ...aml, uboot_top: undefined }); } catch (_) { threw = true; }
arm("must-FIRE: family without uboot_top refused", threw);

console.log(`test-map: ${n - fail}/${n} arms pass`);
process.exit(fail ? 1 : 0);
