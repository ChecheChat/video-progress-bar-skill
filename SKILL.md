---
name: video-progress-bar
description: Generate a chapter progress bar for edited videos, especially Jianying/CapCut workflows. Use when the user wants a reusable overlay material or preview based on video size, duration, chapter titles, confirmed chapter start times, and configurable visual style.
---

# Video Progress Bar

Use this skill after the video has been edited and the chapter timing is stable. The goal is to create a reusable chapter progress bar for Jianying/CapCut, with a preview step before final export.

## Core Workflow

1. Collect the video size, total duration, chapter titles, and chapter start times.
2. Validate the chapter timeline before generating assets.
3. Generate a preview using the user's style preset.
4. Export a transparent overlay material when FFmpeg is available.
5. If transparent overlay import is unreliable, provide a direct-composited video fallback.

Do not guess final chapter times silently. If only a script or transcript is provided, propose chapter timings and ask the user to confirm or edit them before producing final material.

## Progress Bar Rules

- Position: top of the video.
- Overall width: 100% of the video width.
- Overall height: 6.9% of the video height by default.
- Chapter width mode: duration ratio, never equal segments.
- Progress mode: cumulative fill.
- Played content: filled with the user's played color.
- Unplayed content: filled with the user's unplayed color.
- Chapter text and separators stay above the fill layer.

Formula:

```text
chapter_width = video_width * chapter_duration / video_duration
```

## Inputs

Expected input shape:

```yaml
video:
  file: "my-video.mp4"
  width: 1080
  height: 1440
  duration: "04:39"

chapters:
  - title: "引入"
    start: "00:00"
  - title: "MD"
    start: "00:42"
```

If `video.file` points to a local `.mov` or `.mp4`, the script tries to auto-read `width`, `height`, and `duration` when those fields are omitted. It uses `ffprobe` when available and falls back to a built-in MOV/MP4 metadata reader:

```yaml
video:
  file: "/Users/a0000/Documents/无进度条.mov"
```

Prefer short chapter titles:

- Chinese: 2-8 characters when possible.
- English: 1-3 words when possible.
- If a title is too long for its chapter width, warn the user and suggest a shorter title.

## Style Preset

Use `presets/default-3x4.yaml` unless the user provides another preset. Important defaults:

- `layout.height_percent`: `6.9`
- `layout.position`: `top`
- `layout.x_offset` / `layout.y_offset`: `0`
- `progress.mode`: `cumulative_fill`
- `progress.played_color`: personal pink
- `progress.unplayed_color`: neutral gray
- `separator.enabled`: `true`
- `output.fps`: `30`

Style settings should be treated as personal preferences and kept separate from chapter timing.
For reliable Chinese text in FFmpeg exports, set `text.font_file` to a local `.ttf`, `.otf`, or `.ttc` file. If it is blank, the script tries common macOS, Windows, and Linux Chinese font paths.

## Configurable Style Fields

Tell users to copy the default preset before changing style:

```bash
cp presets/default-3x4.yaml presets/my-style.yaml
```

Then run with the copied preset:

```bash
node scripts/generate-progress-bar.js examples/sample-input.yaml --preset presets/my-style.yaml --out output/my-run
```

Use this field guide when users ask how to customize the progress bar:

```yaml
layout:
  position: "top"        # top or bottom
  width_percent: 100     # progress bar width as a percent of video width
  height_percent: 6.9    # progress bar height as a percent of video height
  x_offset: 0            # move right by pixels
  y_offset: 0            # move down from top, or up from bottom

progress:
  played_color: "#F4A6C1"    # already-played fill color
  unplayed_color: "#A8A8A8"  # not-yet-played background color
  opacity: 100               # fill opacity, 0-100

text:
  color: "#FFFFFF"       # chapter title color
  opacity: 100           # title opacity, 0-100
  font_family: "PingFang SC, Microsoft YaHei, Hiragino Sans GB, Arial, sans-serif"
  font_file: ""          # optional local .ttf/.otf/.ttc path for FFmpeg export
  font_size: "auto"      # auto or a number like 42
  font_weight: "bold"    # used by SVG/HTML preview
  max_title_length: 8    # warning threshold, not a hard limit

separator:
  enabled: true          # show chapter dividers
  width: 2               # divider width in pixels for video export
  color: "#FFFFFF"       # divider color
  opacity: 60            # divider opacity, 0-100

output:
  fps: 30                # overlay video frame rate
```

Common customization requests:

- Change played color: edit `progress.played_color`.
- Change unplayed/background color: edit `progress.unplayed_color`.
- Change title color: edit `text.color`.
- Change divider color or thickness: edit `separator.color` and `separator.width`.
- Make the bar taller or thinner: edit `layout.height_percent`.
- Make the bar shorter than full width: edit `layout.width_percent` and usually set `layout.x_offset`.
- Move the bar lower or higher: edit `layout.y_offset`.
- Put the bar at the bottom: set `layout.position` to `bottom`.
- Use a specific font: set `text.font_file` to a local font path.

Do not put chapter timing in the preset. Chapter timing belongs in the input YAML; visual style belongs in the preset YAML.

## Script

Run from the skill folder:

```bash
node scripts/generate-progress-bar.js examples/sample-input.yaml --preset presets/default-3x4.yaml --out output/sample --no-video
```

For a custom input:

```bash
node scripts/generate-progress-bar.js examples/sample-input.yaml --preset presets/default-3x4.yaml --out output
```

The script produces:

- `chapter-timing.json`: validated chapter timing and computed widths.
- `preview.svg`: static preview at the chosen preview time.
- `preview.html`: animated browser preview using cumulative fill.
- `ffmpeg-commands.txt`: exact FFmpeg commands for video export.
- `ffmpeg-notes.txt`: export status and Jianying/CapCut guidance.

When FFmpeg is installed, the script also produces:

- `progress-overlay.mov`: transparent ProRes 4444 overlay material.
- `progress-composited.mp4`: direct-composited fallback when `video.file` points to a local source video.

Optional flags:

```bash
--at 00:02:00
--out output/custom-run
--no-video
--overlay-only
```

## Output Priority

1. Jianying/CapCut overlay material.
2. Direct composite video fallback if transparent import fails.

If FFmpeg is unavailable, do not pretend video export succeeded. Explain that preview and timing are ready, and point the user to `ffmpeg-commands.txt` after they install FFmpeg.

## Validation Checklist

- Chapter starts are strictly increasing and inside the video duration.
- Last chapter automatically ends at the total video duration.
- Segment widths are proportional to chapter duration.
- Long titles are warned before export.
- The progress bar stays inside the frame after offsets are applied.
- Generated overlay starts at `00:00` and should be aligned to the beginning of the timeline in Jianying/CapCut.
