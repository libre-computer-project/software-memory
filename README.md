# Libre Computer Memory Map

Where U-Boot loads the boot script, the device tree, the kernel and the
initramfs on Libre Computer boards, and how much room each one has. Published at
https://memory.software.libre.computer/.

Companion to the GPIO pinout, the board layout and the power tree.

## Data

`data/memory.json` is the whole map, as offsets from the SoC's DRAM base:

- the load slots;
- the decompress buffer nested in the kernel slot;
- the U-Boot reservation at the top of DRAM;
- the firmware block drawn for Amlogic;
- the boot paths that use each address.

`js/map.js` turns it into segments, windows and ticks with no DOM.
`js/app.js` draws it.

## Checks

```
node tools/test-map.mjs        # map invariants; every chart window starts at 0
python3 tools/check-site.py    # links, assets and names in the published tree
python3 tools/check-kit.py     # vendored shell kit unchanged
```

Every bar on the page is a length (bytes or MiB), so every axis starts at zero.
The boot files are too small to see on the whole-map bar, so they get their own
zero-based chart of slot sizes.

## Preview

```
python3 -m http.server
```
