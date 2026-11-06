# numeral-site-scripts

Scripts that run on the Numeral Webflow site (numeral.com). Webflow loads them from jsDelivr, so this repo is the only copy of the code.

| File | Webflow page | What it does |
|---|---|---|
| `coverage-globe.js` | Coverage | 3D coverage map. Colours each country from the VAT CMS table rows on the page. |
| `coverage-table.js` | Coverage | Status icons and the All / Live / Coming Soon filter on the VAT table. |
| `get-started-globe.js` | Get Started Alt | Wireframe globe with pulsing country-to-country arcs and currency pills. |

The globes load Three.js and the world-atlas map from jsDelivr on their own. Nothing else needs to be on the page.

The Luma → Webflow events sync is separate, in the private `numeral-webflow` repo.

## How Webflow loads them

Each page's custom code has one tag per script, pinned to a release tag:

```html
<!-- Coverage → Page settings → Before </body> -->
<script src="https://cdn.jsdelivr.net/gh/mpr22/numeral-site-scripts@v1.1.0/coverage-table.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/gh/mpr22/numeral-site-scripts@v1.1.0/coverage-globe.min.js" defer></script>
```

Get Started Alt has an HTML embed in the right-hand panel. It holds the mount `<div data-gs-alt="globe-mount" …>`, with the framing attributes, followed by a script tag for `get-started-globe.min.js`.

jsDelivr minifies a file when you ask for `.min.js`, so the repo only holds readable source.

## Releasing a change

1. Edit the file and commit.
2. Tag a new version: `git tag v1.1.1 && git push origin main --tags`.
3. In Webflow, change the version in the script URL, then publish.

The live site only changes when the Webflow URL changes. Never move an existing tag: jsDelivr caches tagged files permanently.

## coverage-globe.js

Mounts into `[data-coverage-globe]`. If the page has none, it mounts into `.coverage-map_svg-holder`. It fills the nearest positioned ancestor.

**Data:** reads `.coverage-table_row[data-status]` and `.coverage-table_row-country-name`. The statuses are `Live`, `Coming soon` and `Waiting`. If a CMS name doesn't match the world-atlas name, add it to `ALIASES`.

**Behaviour:**
- It loads nothing until the map is within about 600px of the viewport.
- It plays a rise-and-spin intro the first time it's on screen.
- It spins slowly. Dragging rotates it to either pole.
- Zoom with the +/− buttons, top left (mirroring the legend), or a trackpad pinch. The mouse wheel zooms only after someone clicks the globe, until the cursor leaves it.
- Hovering a country lightens it. Clicking one fills the page's `.coverage-map_tooltip`. Clicking the label, or anywhere off the globe, closes it.
- Faint dust drifts behind the globe.

**Optional data attributes:**

| Attribute | Default | Meaning |
|---|---|---|
| `data-start-longitude` | `-60.4` | Longitude facing the viewer at load |
| `data-view-pitch` | `0.4` | Tilt toward the viewer, radians |
| `data-zoom` | `1.3` | Initial zoom |
| `data-min-zoom` / `data-max-zoom` | `0.62` / `2.2` | Zoom limits (`0.62` shows the whole globe) |
| `data-globe-radius` | `0.62` | Globe radius at zoom 1, as a fraction of container height |
| `data-globe-x` | `0.5` | Horizontal centre, as a fraction of width |
| `data-spin-speed` | `0.035` | Idle spin, radians per second |
| `data-tilt` | `0` | Spin-axis tilt, degrees |

Colours, dust and intro timing are in `DEFAULTS` at the top of the file.

## coverage-table.js

Does three things:
- swaps in the status icons
- runs the filter dropdown
- closes the dropdown when someone clicks outside it

## get-started-globe.js

Mounts into `[data-numeral-globe]` or `[data-gs-alt="globe-mount"]`, and fills the nearest positioned ancestor.

**Optional data attributes:**
- `data-labels="usa,uk,jpn"`, or `"none"`
- `data-globe-x`, `data-globe-y`, `data-globe-radius`
- `data-ocean-opacity`, `data-rim-color`
- `data-pill-size` (px)
- `data-arc-width`, `data-arc-pulse-width` (px)
- `data-spin-speed`, `data-start-longitude`, `data-view-pitch`
- `data-mouse`: how strongly the globe follows the mouse; `0` turns it off
- `data-background="depth"`: a particle field behind the globe
