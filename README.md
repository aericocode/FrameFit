# Frame Fit

Jigsaw puzzles that play while you solve them. Drop in a video, GIF, or image — Frame Fit slices it into pieces you reassemble while the media keeps running.

![Frame Fit](https://img.shields.io/badge/status-WIP-e8c547) ![Vanilla JS](https://img.shields.io/badge/stack-vanilla%20JS-5b8af0)

[Launch Frame Fit](https://aericocode.github.io/FrameFit/)

## Run

No build step. Clone the repo and open index.html.

## Use

1. Drop a video/image on the landing panel (or click **Browse files**).
2. Hit **Start puzzle**.
3. Drag pieces. Drop near a neighbour to snap. Snap groups slide together.

**Controls**

| Action | Input |
|---|---|
| Drag piece/group | Click + drag |
| Pan workspace | Space + drag, or middle-click drag, or click empty space |
| Zoom | Scroll wheel |
| Fit to screen | `Fit` button |
| Pull loose pieces toward puzzle | `Gather` button |
| Toggle reference image | `Ghost` button |
| Skip media / scrub / volume / speed | Toolbar playback bar |

## Stack

Plain HTML, CSS, and JS — no bundler, no framework.

```
framefit/
├── index.html
├── css/
│   ├── toolkit.css      flat dark UI tokens + components
│   └── app.css          Frame Fit-specific styles
└── js/
    ├── shapes.js        EdgeTable, Path2D builders, PathCache
    ├── media.js         MediaPlayer (video/image queue)
    ├── engine.js        PuzzleEngine (state, drag, snap, viewport)
    ├── renderer.js      Renderer (single rAF, pre-scaled offscreen)
    ├── ui.js            UIController (toolbar, modal, empty/ready/win)
    └── app.js           orchestrator
```

**Architecture notes**

- One source of truth for every shared edge in `EdgeTable` — both pieces sharing an edge see the same tab/blank, so neighbours always fit.
- One `requestAnimationFrame` loop, owned by `Renderer`. `MediaPlayer` exposes `getSource()`; the renderer pulls per frame and `drawImage`s from the live element.
- Each frame pre-scales the source into a puzzle-sized `OffscreenCanvas`, then blits per-piece crops (with tab overflow padding) instead of redrawing the full source per piece.
- Per-edge borders: only edges facing a different group are stroked, so internal seams disappear as pieces snap together. Borders fade to zero on solve, then a single unclipped `drawImage` replaces clipped pieces to eliminate hairline gaps.
- Hit testing uses two passes: precise `Path2D.isPointInPath` first, then a padded bounding-box fallback so near-misses still pick up pieces instead of accidentally panning.

## Performance

Tested up to 800 pieces with live HD video on a single workspace at 60 fps in Chrome. The piece slider tops out at 800; bumping past that means revisiting the prescale step.

## Known caveats

- `tk-overlay-bg` from the toolkit is visible by default — Frame Fit overrides it to be `.show`-gated. If the toolkit grows a hidden-by-default modal pattern, drop the override in `app.css`.
- Toolbar progressively hides controls below 1500/1300/1100/900px. On very narrow viewports, Gather may clip — Frame Fit isn't really designed for sub-800px screens.
- Google Fonts (DM Mono, Syne) are loaded from CDN; falls back to system mono/sans if blocked.

## License

Personal project. Use freely.
