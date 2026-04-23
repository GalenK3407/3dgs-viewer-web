<p align="center">
  <img src="./docs/images/logo.png" alt="3DGS Studio logo" width="1000" />
</p>

<p align="center">
  English | <a href="./README.zh-CN.md">简体中文</a>
</p>

> Browser-native viewing, cleanup, shot planning, and MP4 export for 3D Gaussian Splatting scenes.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Built with Spark.js](https://img.shields.io/badge/Powered_by-Spark.js-orange.svg)](https://github.com/sparkjsdev/spark)

`3DGS Studio` is a lightweight browser workstation for 3D Gaussian Splatting (3DGS). Instead of acting as a passive viewer, it focuses on the full presentation workflow: load a local scene, remove noisy splats, plan camera motion around a pivot, and export an MP4 preview directly in the browser.

The repository now defaults to English. The web UI includes an `EN / 中文` toggle, and the Chinese documentation remains available from the links above.

## Interface Preview

Current preview assets still show the Chinese UI and are temporarily kept with a `-zh-CN` suffix until English screenshots are captured.

![Overview](./docs/images/overview-zh-CN.png)

## Demo

<img src="./assets/demo-zh-CN.gif" alt="3DGS Studio demo" width="100%" />

## Key Features

- Pivot-based shot planning for smooth camera previews and MP4 exports
- Browser-only splat cleanup with `Picker` and `Brush` deletion workflows
- Undo / redo support for iterative cleanup passes
- One-click `.ply` export for the visible splats after editing
- Local-file workflow with drag-and-drop support for `.ply`, `.splat`, `.spz`, and `.ksplat`
- Automatic world-up alignment for uploaded scenes

## Quick Start

### 1. Requirements

- Use a modern browser with `WebCodecs` support, such as Chrome or Edge
- Serve the project over HTTP instead of opening `index.html` directly

### 2. Start a Local Server

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

### 3. One-Minute Workflow

1. Load a local 3DGS file by clicking `Open File` or dragging it into the page.
2. Double-click the subject you want to focus on to set the `Pivot`.
3. Enter planner mode and press `+` to add shot points from the current camera view.
4. Press `P` to preview the path and refine the motion.
5. Press `E` to enter editing mode and clean noisy splats with `Picker` or `Brush`.
6. Export the final result as an MP4 from the panel in the upper-right corner.

## Documentation

- English guide: [docs/guide.md](./docs/guide.md)
- 中文指南: [docs/guide.zh-CN.md](./docs/guide.zh-CN.md)

## Roadmap

- [ ] Load remote model files by URL for lightweight scene sharing
- [ ] Compare multiple scenes for before / after review
- [ ] Introduce a modern build setup such as Vite and split `viewer.js` into modules
- [ ] Add stronger editing tools such as bounding-box deletion and ROI extraction

## Acknowledgements

- [Spark.js](https://github.com/sparkjsdev/spark) by World Labs
- [Three.js](https://github.com/mrdoob/three.js)
- [mp4-muxer](https://github.com/Vanilagy/mp4-muxer)

## License

This project is released under the [MIT License](./LICENSE).
