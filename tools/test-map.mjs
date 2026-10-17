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
  MiB, num, segments, ramdiskRoom, firmwareRegions, zeroWindow, isZeroBased, ticks,
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
const room512 = ramdiskRoom(data, 512) / MiB;
arm("ramdisk room on 512 MiB is 154 MiB", room512 === 154, `got ${room512}`);

// The limits table is the data, not a second answer.
const lim = Object.fromEntries(data.limits.map((l) => [l.what, l.mib]));
arm("limit: raw kernel = kernel slot", lim["Raw kernel (header image_size)"] === num(k.size) / MiB);
arm("limit: compressed file = kernel_comp_size",
  lim["Compressed kernel file"] === num(data.env.kernel_comp_size) / MiB);
arm("limit: decompressed = buffer", lim["Compressed kernel, decompressed"] === num(comp.size) / MiB);
arm("limit: initramfs = 512 MiB room", lim["Initramfs, on a 512 MiB board"] === room512);
arm("limit: dtb = fdt slot", lim["Device tree with overlays"] === num(slot("fdt_addr_r").size) / MiB);
arm("limit: script = script slot", lim["Boot script"] === num(slot("scriptaddr").size) / MiB);

// Firmware block is contiguous from 0.
const fw = firmwareRegions(data, data.families.find((f) => f.id === "amlogic"));
let fat = 0, fgap = false;
for (const r of fw.regions) { if (r.start !== fat) fgap = true; fat = r.end; }
arm("firmware block contiguous from 0", !fgap && fat === fw.total);

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
try { segments(data, 256); } catch (_) { threw = true; }
arm("must-FIRE: 256 MiB board refused", threw);

console.log(`test-map: ${n - fail}/${n} arms pass`);
process.exit(fail ? 1 : 0);
