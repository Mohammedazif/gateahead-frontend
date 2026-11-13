# GateAhead Crossing Pin — logo kit v1

Approved concept **3**, saved for future use. The SVG files are the editable, scalable originals. No fonts, network requests, or external image links are needed to render them. This kit preserves the approved pin-and-gate symbol; the original presentation with the GateAhead name is saved in `reference/`.

Open **preview.html** to view all six versions. The ZIP is a complete, portable copy of this folder.

**preview.png** is a shareable snapshot of the v1 kit. The HTML preview reads the SVG sources directly and reflects later edits.

## Choose a version

| File name | Use |
| --- | --- |
| `gateahead-mark-on-light` | Charcoal pin and amber gate on light backgrounds |
| `gateahead-mark-on-dark` | Amber pin and ivory gate on dark backgrounds |
| `gateahead-mark-black` | Single-color black artwork |
| `gateahead-mark-white` | Single-color white artwork on dark backgrounds |
| `gateahead-icon-rounded` | Dark app tile with rounded corners; transparent outside the tile |
| `gateahead-icon-square` | Opaque dark square for app stores and operating-system masks |

Colors: amber **#E7A23A**, charcoal **#14181B**, ivory **#F4EFE6**. The app's accompanying brand text uses Outfit; the symbol itself uses paths only.

## Formats

| Folder / format | Contents |
| --- | --- |
| `svg/` | Six scalable originals; transparent marks and rounded corners |
| `png/` | Every version at every standard size; transparency preserved, square icon saved as opaque RGB |
| `webp/` | Lossless web images at every standard size; transparency preserved |
| `jpg/` | Every standard size, flattened onto a matching light or dark background |
| `pdf/` | Vector print copies, one page each, with a 4-inch longest edge and a matching background |
| `eps/` | Vector EPS print copies, with the same backgrounds as the PDFs |
| `tiff/` | Lossless 4096-pixel exports with 300 DPI metadata and transparency |
| `platforms/web/` | Multi-size ICO favicon, SVG favicon, 180px Apple touch icon, 192px and 512px web icons |
| `platforms/desktop/` | Windows ICO (16–256px), macOS ICNS (16–1024px), 512px PNG |
| `platforms/ios/` | Ready-to-copy `AppIcon.appiconset`, including `Contents.json` and opaque RGB PNGs up to 1024px |
| `platforms/android/` | Launcher PNGs for ldpi through xxxhdpi, adaptive-icon XML/vector resources, 512px store icon |
| `reference/` | Original selected concept image; use the SVG/export folders for production artwork |
| `manifest.json` | Every file's SHA-256 checksum, byte size, and raster dimensions |

PDF/EPS are vector artwork, not a bitmap wrapped in a document. These are RGB exports; use a printer's requested color profile when preparing CMYK production files. TIFF's 300 DPI metadata corresponds to about 13.65 inches on its longest edge.

## Sizes

PNG, WebP, and JPG each include these **31 longest-edge sizes**, in pixels:

**16, 20, 24, 29, 32, 36, 40, 48, 57, 58, 60, 64, 72, 76, 80, 87, 96, 114, 120, 128, 144, 152, 167, 180, 192, 256, 384, 512, 1024, 2048, 4096.**

App icons are square. Standalone marks keep their 384:464 aspect ratio; for example, a 1024px mark is 847×1024px. Filenames include the exact width and height. Use SVG whenever possible to retain sharp edges at any size. Select the square icon for iOS; let the operating system apply its mask.

## Re-export or create another size

The saved assets are ready to use without tools. Regeneration requires **Python 3.9+ with Pillow, Node.js 18+, and Chrome/Chromium**. A full rebuild also requires **Poppler's `pdftops`** for EPS. No npm dependencies are required. The scripts work entirely offline.

From this folder:

```bash
# Regenerate all standard exports, platform assets, manifest, preview, and ZIP.
python3 scripts/export.py

# Add custom longest-edge sizes without deleting existing exports.
python3 scripts/export.py --sizes 800,1600,3000

# Specify the browser if it is not auto-detected.
python3 scripts/export.py --browser /path/to/chrome

# Refresh the manifest and ZIP after editing documentation or sources.
python3 scripts/export.py --package-only
```

Alternatively, set `CHROMIUM_PATH` to the browser executable. In a trusted isolated environment where Chromium's sandbox cannot run, the renderer supports `GATEAHEAD_NO_SANDBOX=1`.

Edit the SVG masters in `svg/` and run a full rebuild to update the exports. Custom exports can be added from 1 to 16384px; SVG remains scalable beyond those raster limits. The scripts replace matching outputs and keep additional files. `export-config.json` records the standard sizes, colors, and variants.

The generated archive is saved beside this folder as **gateahead-logo-kit-v1.zip**. Rebuilding this kit does not replace app files automatically; copy the chosen exports into each app when changing the design.
