# assets-src

Icon sources. Kept **outside** `public/` so vite does not copy them into `dist/`
— only the generated PNGs ship.

`apple-touch-icon-src.svg` is the full-bleed master. It differs from the legacy
`apple-touch-icon.svg` only in that the backdrop has no rounded corners: iOS
applies its own squircle mask, so an icon carrying its own radius + transparent
margin renders as a double-rounded badge floating on black.

Regenerate after editing the master:

```bash
cd prototype
rsvg-convert -w 180 -h 180 assets-src/apple-touch-icon-src.svg -o public/apple-touch-icon.png
rsvg-convert -w 192 -h 192 assets-src/apple-touch-icon-src.svg -o public/icon-192.png
rsvg-convert -w 512 -h 512 assets-src/apple-touch-icon-src.svg -o public/icon-512.png
rsvg-convert -w  96 -h  96 assets-src/apple-touch-icon-src.svg -o public/badge-96.png
```

`rsvg-convert` comes from `brew install librsvg`.

PNG (not SVG) is required in two places:

- `apple-touch-icon` — iOS Safari cannot decode an SVG one and silently
  substitutes a screenshot of the page as the home-screen icon. Home-screen
  install is a prerequisite for iOS Web Push, which the study's daily reminder
  depends on.
- notification `icon` / `badge` — Android Chrome cannot decode SVG here and
  falls back to a generic bell.

`public/icon.svg` and `public/favicon.svg` stay where they are: they are still
referenced by `index.html` (favicon) and `manifest.json` (as an extra `any`
entry for browsers that prefer vectors).

Bump `CACHE_NAME` in `public/sw.js` whenever these change — `manifest.json` is
precached cache-first, so without a bump existing installs keep the old icon set
indefinitely.
