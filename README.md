# Quillpad

A pocket sketching & painting studio for **iPhone and Android**, built with a fast HTML canvas engine and wrapped as native apps with [Capacitor](https://capacitorjs.com). It covers the core feature set of mobile painting apps like Procreate Pocket — pressure brushes, layers, blend modes, QuickShape, gestures, time-lapse and PSD export — in an original, open-source app.

**Try it now in your phone's browser:** https://chadant1.github.io/quillpad/
(on iPhone tap **Share → Add to Home Screen**, on Android tap **⋮ → Install app** for a full-screen standalone app)

**Android APK:** [Releases → android-latest → Quillpad.apk](https://github.com/chadant1/quillpad/releases/tag/android-latest) — rebuilt automatically on every push.

## Features

| Area | What you get |
| --- | --- |
| **Brushes** | 13 brushes (Studio Pen, Technical Pen, Monoline, Calligraphy, Sketch Pencil, Charcoal, Marker, Gouache, Watercolor Wash, Soft/Hard Airbrush, Spray Paint, Pixel Square). Stamp-based engine with stylus pressure, fixed or direction-following angle, spacing, hardness, flow, grain, jitter, scatter, start taper and **StreamLine** smoothing. Every setting is editable in the brush studio and remembered per brush. |
| **Stylus** | Apple Pencil (iPad) and pressure styluses like Samsung S Pen: pressure controls size/opacity with an adjustable pressure curve, **tilt shading** (lay the pen down to shade with a wider, softer, oval mark that follows the pen's direction — tunable per brush), palm rejection (once a stylus is used, fingers only navigate). |
| **Animation** | **Animation Assist**: each layer is a frame. Timeline with thumbnails, onion skins (1–6 frames each side, colored red/green), playback at 1–60 fps in Loop, Ping-Pong or One Shot, per-frame hold, fixed background/foreground layers, duplicate/delete frames, and export to **animated GIF** or **MP4/WebM video**. |
| **Paint · Smudge · Erase** | Each tool picks its own brush, size and opacity. Smudge pulls and blends paint; eraser works with any brush. |
| **QuickShape** | Hold at the end of a stroke and it snaps to a perfect line, arc, polyline, triangle, rectangle, polygon, circle or ellipse. |
| **Layers** | Up to ~60 layers (depending on canvas size), opacity, 17 blend modes, alpha lock, clipping masks, reference layer, rename, duplicate, merge down, reorder, fill, clear, invert, hide, background color. |
| **Color** | Hue ring + saturation/brightness square, HSB/RGB/Hex value sliders, recent colors, built-in palettes and a custom palette. **ColorDrop:** drag the color dot onto the canvas to flood-fill (respects selections and the reference layer). Touch & hold or use the eyedropper button to pick colors. |
| **Selection & Transform** | Freehand, rectangle and ellipse selections; invert, copy/cut to new layer, fill, clear. Move, uniform/freeform scale, rotate (with 15° snapping), flip, fit, and two-finger pinch/rotate of the selected content. |
| **Adjustments** | Hue/Saturation/Brightness, Gaussian Blur, Sharpen, Noise, Color Balance, Contrast, Invert, Posterize — live preview, limited to the selection if one exists. |
| **Gestures** | Pinch to zoom & rotate (snaps to 90°), quick pinch to fit, two-finger tap undo, three-finger tap redo, four-finger tap full-screen, touch & hold eyedropper. Mouse wheel / trackpad zoom, space-drag pan on desktop. |
| **Guides** | Grid drawing guide and live **symmetry** (vertical, horizontal, quadrant, radial). Non-destructive mirror view, flip canvas. |
| **Gallery** | Multiple artworks saved automatically on the device (IndexedDB), thumbnails, rename, duplicate, delete, new canvas presets or custom sizes, import a photo as a new artwork. |
| **Export** | PNG, JPEG, **layered PSD** (opens in Photoshop, Procreate, Krita, Photopea) and single-layer PNG, via the native share sheet. |
| **Time-lapse** | Every stroke is recorded; replay it or export an MP4/WebM video. |
| **Works offline** | Service worker for the web version; the native apps bundle everything. |

Keyboard (iPad/desktop): `P` play animation · `,` `.` previous/next frame · `B` brush · `S` smudge · `E` eraser · `L` selection · `V` transform · `I` eyedropper · `[` `]` size · `⌘/Ctrl+Z` undo · `⇧⌘Z` redo · `⌘0` fit · `Tab` hide UI · `Esc` cancel.

## Project layout

```
www/                 the whole app (plain ES modules, no build step)
  js/brush.js        brush presets + stroke engine (paint / erase / smudge, symmetry)
  js/quickshape.js   shape recognition
  js/doc.js          layers, blend modes, clipping, compositing
  js/editor.js       rendering, tools, transform, selection, adjustments, layer ops
  js/input.js        pointer events, multi-touch gestures, eyedropper
  js/ui.js           panels: brushes, layers, colors, actions, adjustments
  js/history.js      undo / redo (dirty-rectangle pixel diffs)
  js/storage.js      IndexedDB gallery
  js/psd.js          layered PSD writer
  js/timelapse.js    recording, replay, video export
  js/animation.js    Animation Assist: frames, onion skins, timeline, playback, export
  js/gif.js          animated GIF encoder (median-cut palette + LZW)
resources/           app icons + splash screens for the native apps
scripts/setup-native.mjs  generates android/ and ios/ with Capacitor and applies icons & permissions
```

The native `android/` and `ios/` folders are generated, not committed: `npm run setup` creates both.

## Run it

```bash
npm install
npm start            # serves www/ at http://localhost:8080
```

### Android

* **Easiest:** download `Quillpad.apk` from the [android-latest release](https://github.com/chadant1/quillpad/releases/tag/android-latest) on your phone and install it.
* **Build yourself:** install Node 22 and Android Studio (JDK 21), then `npm install` and `npm run android` (creates the Android project and opens it) and press ▶ Run.
* **Play Store:** in Android Studio use *Build → Generate Signed App Bundle* and upload the `.aab` to the Google Play Console ($25 one-time developer fee).

### iPhone / iPad

Apple Pencil works on iPad (Apple doesn't support Pencil on iPhone). Apple only allows iOS apps to be built on a Mac:

1. Install Xcode 16+ on a Mac, clone this repo, run `npm install`.
2. `npm run ios` — creates the iOS project and opens it in Xcode.
3. Select your iPhone, set your Apple ID under *Signing & Capabilities*, press ▶ Run.
   A free Apple ID installs to your own phone for 7 days; the Apple Developer Program ($99/year) is needed for TestFlight and the App Store.

No Mac? Use the web version above and **Add to Home Screen** — it runs full-screen and offline like an app.

### After changing the web code

```bash
npm run sync        # copies www/ into the native projects
```

## License

MIT. Quillpad is an independent project and is not affiliated with or endorsed by Savage Interactive (makers of Procreate®).
