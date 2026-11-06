# numeral-site-scripts

Standalone scripts for the Numeral Webflow site, served from jsDelivr.

| File | Used on | What it does |
|---|---|---|
| `coverage-globe.js` | `/coverage` | 3D coverage map. Colours each country from the VAT CMS table rows on the page and replaces the old flat SVG map. |
| `connection-globe.js` | `/get-started-alt` | Wireframe globe with pulsing country-to-country arcs and currency pills. |

Both load Three.js and the world-atlas map data from jsDelivr on their own. Nothing else needs to be on the page.

## Using a script in Webflow

Add one tag to the page's footer custom code. Always pin an exact release tag, never a branch:

```html
<script src="https://cdn.jsdelivr.net/gh/mpr22/numeral-site-scripts@v1.0.0/coverage-globe.min.js" defer></script>
```

jsDelivr minifies the file when you request `.min.js`, so the repo only holds readable source.

## Releasing a change

1. Edit the file and commit.
2. Tag a new version: `git tag v1.0.1 && git push --tags`.
3. In Webflow, bump the version in the script URL, then publish.

The live site only changes when the Webflow URL changes. Re-pushing a tag won't reach visitors: jsDelivr caches tagged files permanently.

## coverage-globe.js

Mounts into `[data-coverage-globe]`, or into the page's `.coverage-map_svg-holder` if there's no mount element. It fills the nearest positioned ancestor.

**Data:** reads `.coverage-table_row[data-status]` and `.coverage-table_row-country-name` from the page. Statuses are `Live`, `Coming soon` and `Waiting`. If a CMS name doesn't match the world-atlas name, add it to `ALIASES` in the script.

**Behaviour:**
- Starts loading only when the map is within about 600px of the viewport.
- The first time the map is on screen, it plays an intro that rises and spins in, then settles.
- Slow spin and drag to rotate to either pole. Zoom with the +/− buttons (top right, under the page legend) or a trackpad pinch. The mouse wheel also zooms, but only after someone has clicked the globe, and only until the cursor leaves it.
- Hovering a country lightens it. Clicking a country fills the page's `.coverage-map_tooltip`. Clicking the label or anywhere off the globe closes it.
- Faint drifting dust in the panel behind the globe.

**Optional data attributes** on the mount element:

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

## connection-globe.js

Mounts into `[data-numeral-globe]` or `[data-gs-alt="globe-mount"]` and fills the nearest positioned ancestor.

**Optional data attributes:**
- `data-labels="usa,uk,jpn"`, or `"none"` for no labels
- `data-globe-x`, `data-globe-y`, `data-globe-radius`
- `data-ocean-opacity`, `data-rim-color`
- `data-pill-size` (px)
- `data-arc-width`, `data-arc-pulse-width` (px)
- `data-spin-speed`, `data-start-longitude`, `data-view-pitch`
- `data-mouse`: how strongly the globe follows the mouse; `0` turns it off
- `data-background="depth"`: a particle field behind the globe
