
# Video Progress Bar Skill

Generate a transparent chapter progress bar overlay for edited videos, especially Jianying/CapCut workflows.

This skill is useful when you already know the final chapter timings and want a reusable progress bar material that can be placed above your finished video.

## What It Generates

- `preview.svg`: static preview image.
- `preview.html`: animated browser preview.
- `chapter-timing.json`: validated chapter timing and computed segment widths.
- `progress-overlay.mov`: transparent ProRes overlay for Jianying/CapCut when FFmpeg is available.
- `progress-composited.mp4`: optional direct-composited fallback when a source video file is provided.

## Requirements

- Node.js 18 or newer.
- FFmpeg and FFprobe for video export.

FFmpeg is a separate open source video tool. It is not bundled with this repository. If FFmpeg is not installed, the script can still generate previews and FFmpeg command notes, but it cannot export `progress-overlay.mov`.

## Quick Start

Run from this folder:

```bash
node scripts/generate-progress-bar.js examples/sample-input.yaml --preset presets/default-3x4.yaml --out output/sample
```

The transparent overlay will be generated at:

```text
output/sample/progress-overlay.mov
```

In Jianying/CapCut, import `progress-overlay.mov`, place it on a track above your video, and align it to `00:00`.

## Input File

Edit `examples/sample-input.yaml` or create your own input file:

```yaml
video:
  width: 1080
  height: 1440
  duration: "04:39"

chapters:
  - title: "引入"
    start: "00:00"
  - title: "MD"
    start: "00:42"
  - title: "HTML"
    start: "01:36"
  - title: "结构"
    start: "02:45"
  - title: "总结"
    start: "03:58"
```

If you provide a local source video path, the script tries to read `width`, `height`, and `duration` automatically:

```yaml
video:
  file: "/Users/you/Videos/my-video.mp4"
```

## Customize The Style

Do not edit the script for style changes. Copy the preset and edit the copied YAML:

```bash
cp presets/default-3x4.yaml presets/my-style.yaml
node scripts/generate-progress-bar.js examples/sample-input.yaml --preset presets/my-style.yaml --out output/my-run
```

Common fields:

```yaml
layout:
  position: "top"
  width_percent: 100
  height_percent: 6.9
  x_offset: 0
  y_offset: 0

progress:
  played_color: "#F4A6C1"
  unplayed_color: "#A8A8A8"
  opacity: 100

text:
  color: "#FFFFFF"
  opacity: 100
  font_file: ""
  font_size: "auto"

separator:
  enabled: true
  width: 2
  color: "#FFFFFF"
  opacity: 60
```

- Change played color: edit `progress.played_color`.
- Change unplayed/background color: edit `progress.unplayed_color`.
- Change title color: edit `text.color`.
- Change the bar height: edit `layout.height_percent`.
- Put the bar at the bottom: set `layout.position` to `bottom`.
- Use a specific font: set `text.font_file` to a local `.ttf`, `.otf`, or `.ttc` file.

## Notes

- Chapter segment widths are based on chapter duration, not equal division.
- The last chapter automatically ends at the total video duration.
- Keep chapter titles short so they fit inside each segment.
- Generated files under `output/` are ignored by Git.

