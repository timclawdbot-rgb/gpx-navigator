# GPX Navigator — Expo (TypeScript)

A lightweight GPX navigation app built with Expo + React Native.

## Features
- Load a **GPX file** from your device
- Parses track/route points and **draws the route** on a map
- **Drive mode**:
  - follows your GPS position
  - tilts/zooms to a 3D-ish navigation camera
  - shows a **speedometer (km/h)**

## What it is / isn’t
- ✅ GPX overlay + GPS follow
- ❌ Not turn-by-turn navigation (no routing, no spoken directions, no rerouting)

## Run

```bash
npm install
npx expo start
```

If you’re running inside a VM / tricky network, tunnel mode works well:

```bash
npx expo start --tunnel
```

## Notes
- GPX parsing supports `trkseg/trkpt` and `rte/rtept`.
- Speed is taken from GPS `coords.speed` when available.

## Disclaimer
This is a demo app and may be inaccurate. Use at your own risk.
