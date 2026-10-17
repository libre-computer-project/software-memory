/* The memory map as numbers: segments, windows and ticks, with no DOM.
 *
 * Everything that decides WHAT is drawn lives here, so the invariants can be
 * tested without a browser (tools/test-map.mjs):
 *   - the map covers [0, DRAM size) with no gap and no overlap;
 *   - every chart window starts at zero, because the length of a bar is read
 *     as the size of the region or budget it stands for.
 */

export const MiB = 1024 * 1024;

export function num(hex) {
  if (hex === null || hex === undefined) return null;
  const n = Number.parseInt(String(hex), 16);
  if (!Number.isFinite(n)) throw new Error(`not a hex number: ${hex}`);
  return n;
}

export function hex(n, width = 8) {
  return "0x" + Math.round(n).toString(16).toUpperCase().padStart(width, "0");
}

export function mib(bytes) {
  const v = bytes / MiB;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/**
 * What U-Boot holds at the top of DRAM after relocation, in bytes: the
 * family's own figure (framebuffer, heap, image, stack and the 16 MiB LMB
 * keeps below the stack). It differs by family, so there is no global one.
 */
export function ubootTop(family) {
  if (!family || !family.uboot_top || !(family.uboot_top.mib > 0)) {
    throw new Error(`family ${family && family.id} has no uboot_top`);
  }
  return family.uboot_top.mib * MiB;
}

/**
 * Where the ramdisk may end: below U-Boot's relocated top of DRAM, and below
 * the family's stop when it has one (a SoC region the slot must not reach).
 */
export function ramdiskEnd(data, dramMiB, family) {
  const top = dramMiB * MiB - ubootTop(family);
  const stop = family.ramdisk_stop ? num(family.ramdisk_stop) : Infinity;
  return Math.min(top, stop);
}

/** The ramdisk room on a board of this size, in bytes. */
export function ramdiskRoom(data, dramMiB, family) {
  const last = data.slots[data.slots.length - 1];
  return ramdiskEnd(data, dramMiB, family) - num(last.offset);
}

/**
 * The whole map for one DRAM size, as contiguous segments from offset 0.
 * kind: "low" | "slot" | "spare" | "free" | "uboot".
 */
export function segments(data, dramMiB, family) {
  const total = dramMiB * MiB;
  const out = [];
  const lowEnd = num(data.low_window.end);
  out.push({ id: "low", kind: "low", label: data.low_window.label, start: 0, end: lowEnd,
    note: data.low_window.note });

  let at = lowEnd;
  for (const s of data.slots) {
    const start = num(s.offset);
    if (start !== at) throw new Error(`slot ${s.var} starts at ${hex(start)}, expected ${hex(at)}`);
    const end = s.grows ? ramdiskEnd(data, dramMiB, family) : start + num(s.size);
    if (end <= start) throw new Error(`no room for ${s.var} on a ${dramMiB} MiB board`);
    out.push({ id: s.var || `spare-${hex(start)}`, kind: s.var ? "slot" : "spare",
      label: s.var || "spare", start, end, note: s.holds, grows: !!s.grows });
    at = end;
  }
  const ubootStart = total - ubootTop(family);
  if (at < ubootStart) {
    out.push({ id: "free", kind: "free", label: "Free for Linux", start: at, end: ubootStart,
      note: family.ramdisk_stop_note || "" });
    at = ubootStart;
  }
  out.push({ id: "uboot", kind: "uboot", label: "U-Boot (relocated)", start: at, end: total,
    note: family.uboot_top.note });
  return out;
}

/** Firmware-block regions for a family, or null when none is drawn. */
export function firmwareRegions(data, family) {
  const fw = data.firmware[family.firmware];
  if (!fw) return null;
  return {
    name: fw.name,
    total: num(fw.end),
    regions: fw.regions.map((r) => ({ ...r, start: num(r.start), end: num(r.end) })),
  };
}

/**
 * The axis window for any bar on this page: [0, hi]. The bars are lengths
 * (bytes, MiB), so the low end is ZERO -- never the smallest value present.
 */
export function zeroWindow(values) {
  const finite = values.filter((v) => Number.isFinite(v) && v > 0);
  const hi = finite.length ? Math.max(...finite) : 1;
  return { lo: 0, hi };
}

export function isZeroBased(w) {
  return w.lo === 0 && w.hi > 0;
}

/**
 * Tick positions from 0 up to hi, in the axis unit. Memory reads in powers of
 * two, so the step is the smallest power of two that gives at most `want`
 * intervals.
 */
export function ticks(hi, want = 8) {
  if (!(hi > 0)) return [0];
  const step = 2 ** Math.ceil(Math.log2(hi / want));
  const out = [];
  for (let t = 0; t <= hi + 1e-9; t += step) out.push(Math.round(t * 1e6) / 1e6);
  return out;
}
