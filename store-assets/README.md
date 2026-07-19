# Store assets

`icon-source.svg` is the master 1024×1024 icon artwork (crossed blades on a dark void, matching the in-game theme). Everything below must be exported from it before submitting to Play Console — none of these derived files are committed here since they're generated binary assets.

## Required exports

### Adaptive icon (Android 8+, `android/app/src/main/res/`)
- Foreground layer: 432×432px PNG, artwork kept within the centered ~264×264 safe zone (the crossed-blades group already respects this).
- Background layer: solid `#0a0a0f` (or the radial gradient from the source), 432×432px.
- Place as `mipmap-anydpi-v26/ic_launcher.xml` (adaptive icon XML) referencing the two layers, generated automatically if you run the icon through Android Studio's Image Asset tool (recommended over hand-authoring).

### Legacy launcher icon PNG fallbacks (pre-Android 8)
| Density | Size |
|---|---|
| mdpi | 48×48 |
| hdpi | 72×72 |
| xhdpi | 96×96 |
| xxhdpi | 144×144 |
| xxxhdpi | 192×192 |

### Play Console store listing (uploaded directly in Console, not part of the APK)
- Hi-res icon: 512×512 PNG
- Feature graphic: 1024×500 PNG/JPG
- Phone screenshots: at least 2, actual device aspect ratio

## Recommended export method
Open `icon-source.svg` in Android Studio's **Image Asset Studio** (right-click `res/` → New → Image Asset) and let it generate the full adaptive-icon mipmap set automatically — this avoids manual pixel-size mistakes. Alternatively use any SVG-to-PNG tool (e.g. `rsvg-convert`, Inkscape CLI, or an online converter) to produce each size listed above manually.
