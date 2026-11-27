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
`js/content.js` turns that into the page's words and tables as HTML, with no
DOM. `js/app.js` puts that HTML in `<main>` and draws the charts.

## Pages

| URL | Shows |
|---|---|
| `/` | the first SoC family; `?soc=<family-id>&dram=<MiB>` picks another |
| `/<family-id>/` (`/amlogic/`, `/rockchip/`) | that family's map, its tables in the HTML; `?dram=` picks the size |

A family marked `"hidden": true` in `data/memory.json` (MediaTek: no public
board uses it yet) is listed only under `?hidden=1`, the switch every Libre
Computer tool uses: the home page draws it from `?soc=<family-id>&hidden=1`.
It has no page of its own and no line in the sitemap or `llms.txt`.
`data/memory.json` itself still names it, as each tool's data does for its
hidden boards.

`?embed=1` (with `?theme=`) works on both, for libre.computer's frame.

## Render

After changing `index.html`, `js/content.js` or `data/memory.json`, run

```
node tools/render.mjs
```

and commit what it writes: the map's tables in `index.html` and in each
family's page, `robots.txt`, `sitemap.xml` and `llms.txt`. A second run
changes nothing; `tools/test-render.mjs` fails while a page is stale.

## Checks

```
node tools/test-map.mjs        # map invariants; every chart window starts at 0
node tools/test-render.mjs     # the HTML names every region; pages are render.mjs's output
python3 tools/check-site.py    # links, assets, names, canonicals, sitemap in the published tree
python3 tools/check-kit.py     # vendored shell kit unchanged
```

Every bar on the page is a length (bytes or MiB), so every axis starts at zero.
The boot files are too small to see on the whole-map bar, so they get their own
zero-based chart of slot sizes.

## Preview

```
python3 -m http.server
```
