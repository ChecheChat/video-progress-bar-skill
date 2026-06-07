#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

function usage() {
  console.log(`Usage:
  node scripts/generate-progress-bar.js <input.yaml> [--preset presets/default-3x4.yaml] [--out output] [--at MM:SS] [--no-video] [--overlay-only]

The script can auto-read width, height, and duration from local .mov/.mp4 files
when video.file exists and those fields are omitted.

When ffmpeg is installed, the script also exports:
- progress-overlay.mov: transparent ProRes 4444 overlay
- progress-composited.mp4: direct-composited fallback when video.file exists
`);
}

function parseArgs(argv) {
  const args = {
    input: null,
    preset: null,
    out: "output",
    at: null,
    exportVideo: true,
    overlayOnly: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--help" || value === "-h") {
      usage();
      process.exit(0);
    }
    if (value === "--preset") args.preset = argv[++i];
    else if (value === "--out") args.out = argv[++i];
    else if (value === "--at") args.at = argv[++i];
    else if (value === "--no-video") args.exportVideo = false;
    else if (value === "--overlay-only") args.overlayOnly = true;
    else if (!args.input) args.input = value;
    else throw new Error(`Unexpected argument: ${value}`);
  }
  return args;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseInlineKeyValue(text) {
  const index = text.indexOf(":");
  if (index === -1) return null;
  const key = text.slice(0, index).trim();
  const value = text.slice(index + 1).trim();
  return { key, value: parseScalar(value) };
}

function parseSimpleYaml(source) {
  const root = {};
  let section = null;
  let currentItem = null;

  const lines = source.split(/\r?\n/);
  for (const rawLine of lines) {
    const withoutComment = rawLine.replace(/\s+#.*$/, "");
    if (!withoutComment.trim()) continue;

    const indent = withoutComment.match(/^\s*/)[0].length;
    const line = withoutComment.trim();

    if (indent === 0 && !line.startsWith("- ")) {
      const pair = parseInlineKeyValue(line);
      if (!pair) continue;
      section = pair.key;
      currentItem = null;
      root[section] = pair.value === "" ? {} : pair.value;
      continue;
    }

    if (!section) continue;

    if (line.startsWith("- ")) {
      if (!Array.isArray(root[section])) root[section] = [];
      currentItem = {};
      root[section].push(currentItem);
      const rest = line.slice(2).trim();
      const pair = parseInlineKeyValue(rest);
      if (pair) currentItem[pair.key] = pair.value;
      continue;
    }

    const pair = parseInlineKeyValue(line);
    if (!pair) continue;

    if (currentItem && Array.isArray(root[section])) {
      currentItem[pair.key] = pair.value;
    } else if (typeof root[section] === "object" && root[section] !== null) {
      root[section][pair.key] = pair.value;
    }
  }

  return root;
}

function mergeConfig(preset, input) {
  return {
    ...preset,
    ...input,
    layout: { ...(preset.layout || {}), ...(input.layout || {}) },
    progress: { ...(preset.progress || {}), ...(input.progress || {}) },
    text: { ...(preset.text || {}), ...(input.text || {}) },
    separator: { ...(preset.separator || {}), ...(input.separator || {}) },
    output: { ...(preset.output || {}), ...(input.output || {}) },
  };
}

function parseTimecode(value) {
  if (typeof value === "number") return value;
  if (!value || typeof value !== "string") throw new Error(`Invalid timecode: ${value}`);
  const parts = value.split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) throw new Error(`Invalid timecode: ${value}`);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  throw new Error(`Use seconds, MM:SS, or HH:MM:SS timecode: ${value}`);
}

function resolveBinary(binary) {
  const envName = binary === "ffmpeg" ? "FFMPEG_BIN" : binary === "ffprobe" ? "FFPROBE_BIN" : "";
  const configured = envName && process.env[envName];
  if (configured && fs.existsSync(configured)) return configured;

  const localCandidates = [
    path.join(os.homedir(), ".local", "bin", binary),
    path.join(__dirname, "..", "vendor", "bin", binary),
  ];
  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const result = spawnSync("command", ["-v", binary], { shell: true, encoding: "utf8" });
  const resolved = result.stdout && result.stdout.trim().split(/\r?\n/)[0];
  return resolved || binary;
}

function hasBinary(binary) {
  const result = spawnSync(resolveBinary(binary), ["-version"], { stdio: "ignore" });
  return result.status === 0;
}

function readFfprobeMetadata(file) {
  if (!hasBinary("ffprobe")) return null;
  const result = spawnSync(
    resolveBinary("ffprobe"),
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height:format=duration",
      "-of",
      "json",
      file,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    const stream = parsed.streams && parsed.streams[0];
    const duration = Number(parsed.format && parsed.format.duration);
    if (!stream || !stream.width || !stream.height || !duration) return null;
    return {
      width: Number(stream.width),
      height: Number(stream.height),
      duration,
    };
  } catch {
    return null;
  }
}

function readAtomList(fd, start, end) {
  const readBuf = (pos, len) => {
    const buffer = Buffer.alloc(len);
    fs.readSync(fd, buffer, 0, len, pos);
    return buffer;
  };
  const atoms = [];
  let pos = start;
  while (pos + 8 <= end) {
    const headerBuffer = readBuf(pos, 16);
    let size = headerBuffer.readUInt32BE(0);
    const type = headerBuffer.slice(4, 8).toString("latin1");
    let header = 8;
    if (size === 1) {
      size = Number(headerBuffer.readBigUInt64BE(8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < 8 || pos + size > end) break;
    atoms.push({ type, start: pos, size, header, end: pos + size });
    pos += size;
  }
  return { atoms, readBuf };
}

function readMovMetadata(file) {
  const fd = fs.openSync(file, "r");
  try {
    const stat = fs.fstatSync(fd);
    const containers = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "udta", "meta", "dinf", "dref"]);
    let movie = null;
    const tracks = [];

    const fixed1616 = (buffer, offset) => buffer.readUInt32BE(offset) / 65536;
    const walk = (start, end) => {
      const { atoms, readBuf } = readAtomList(fd, start, end);
      for (const atom of atoms) {
        if (atom.type === "mvhd") {
          const buffer = readBuf(atom.start + atom.header, atom.size - atom.header);
          const version = buffer.readUInt8(0);
          let timescale;
          let duration;
          if (version === 1) {
            timescale = buffer.readUInt32BE(20);
            duration = Number(buffer.readBigUInt64BE(24));
          } else {
            timescale = buffer.readUInt32BE(12);
            duration = buffer.readUInt32BE(16);
          }
          movie = { duration: duration / timescale };
        }
        if (atom.type === "trak") tracks.push(atom);
        if (containers.has(atom.type)) {
          walk(atom.start + atom.header + (atom.type === "meta" ? 4 : 0), atom.end);
        }
      }
    };

    const parseTrack = (trackAtom) => {
      const track = {};
      const walkTrack = (start, end, path = []) => {
        const { atoms, readBuf } = readAtomList(fd, start, end);
        for (const atom of atoms) {
          const nextPath = [...path, atom.type];
          if (atom.type === "tkhd") {
            const buffer = readBuf(atom.start + atom.header, atom.size - atom.header);
            const version = buffer.readUInt8(0);
            const base = version === 1 ? 88 : 76;
            track.width = fixed1616(buffer, base);
            track.height = fixed1616(buffer, base + 4);
          }
          if (atom.type === "hdlr" && path[path.length - 1] === "mdia") {
            const buffer = readBuf(atom.start + atom.header, atom.size - atom.header);
            track.handler = buffer.slice(8, 12).toString("latin1");
          }
          if (containers.has(atom.type)) {
            walkTrack(atom.start + atom.header + (atom.type === "meta" ? 4 : 0), atom.end, nextPath);
          }
        }
      };
      walkTrack(trackAtom.start + trackAtom.header, trackAtom.end, ["trak"]);
      return track;
    };

    walk(0, stat.size);
    const videoTrack = tracks.map(parseTrack).find((track) => track.handler === "vide" && track.width && track.height);
    if (!videoTrack || !movie) return null;
    return {
      width: Math.round(videoTrack.width),
      height: Math.round(videoTrack.height),
      duration: movie.duration,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function hydrateVideoMetadata(config, inputPath) {
  if (!config.video || !config.video.file) return config;
  const videoFile = path.isAbsolute(config.video.file)
    ? config.video.file
    : path.resolve(path.dirname(inputPath), config.video.file);
  if (!fs.existsSync(videoFile)) return config;

  const metadata = readFfprobeMetadata(videoFile) || readMovMetadata(videoFile);
  if (!metadata) return config;

  config.video.file = videoFile;
  if (!config.video.width) config.video.width = metadata.width;
  if (!config.video.height) config.video.height = metadata.height;
  if (!config.video.duration) config.video.duration = metadata.duration;
  return config;
}

function formatTime(seconds) {
  const rounded = Math.max(0, Math.round(seconds));
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  if (h > 0) {
    return [h, m, s].map((part) => String(part).padStart(2, "0")).join(":");
  }
  return [m, s].map((part) => String(part).padStart(2, "0")).join(":");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeFfmpegText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%");
}

function escapeFfmpegPath(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function commandForDisplay(command, args) {
  return [command, ...args.map(shellQuote)].join(" ");
}

function parseHexColor(value, fallback) {
  const raw = String(value || fallback).trim();
  const match = raw.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) throw new Error(`Use a 6-digit hex color, for example "#F4A6C1": ${value}`);
  const hex = match[1];
  return {
    hex: `#${hex.toUpperCase()}`,
    ffmpeg: `0x${hex.toUpperCase()}`,
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function resolveFontFile(config) {
  const configured = config.text && (config.text.font_file || config.text.fontfile);
  if (configured && fs.existsSync(configured)) return configured;

  const candidates = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
    "C:\\Windows\\Fonts\\msyh.ttc",
    "C:\\Windows\\Fonts\\simhei.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function estimateTitleWidth(title, fontSize) {
  let width = 0;
  for (const char of String(title)) {
    width += /[\u3400-\u9fff]/.test(char) ? fontSize : fontSize * 0.58;
  }
  return width;
}

function buildTimeline(config) {
  const video = config.video || {};
  const chapters = config.chapters || [];
  const width = Number(video.width);
  const height = Number(video.height);
  const duration = parseTimecode(video.duration);

  if (!width || !height) throw new Error("video.width and video.height are required.");
  if (!duration) throw new Error("video.duration is required.");
  if (!Array.isArray(chapters) || chapters.length === 0) throw new Error("At least one chapter is required.");

  const starts = chapters.map((chapter) => parseTimecode(chapter.start));
  starts.forEach((start, index) => {
    if (start < 0 || start >= duration) throw new Error(`Chapter ${index + 1} starts outside the video duration.`);
    if (index > 0 && start <= starts[index - 1]) throw new Error("Chapter starts must be strictly increasing.");
  });

  const barWidth = Math.round(width * (Number(config.layout.width_percent || 100) / 100));
  const barHeight = Math.round(height * (Number(config.layout.height_percent || 6.6) / 100));
  const barX = Math.round(Number(config.layout.x_offset || 0));
  const position = config.layout.position || "top";
  const yOffset = Math.round(Number(config.layout.y_offset ?? config.layout.top_offset ?? 0));
  const barY = position === "bottom" ? height - barHeight - yOffset : yOffset;
  const fps = Number(config.output.fps || 30);
  const fontSize =
    config.text.font_size === "auto"
      ? clamp(Math.round(barHeight * 0.42), 18, 48)
      : Number(config.text.font_size);
  const maxTitleLength = Number(config.text.max_title_length || 8);
  if (!fps || fps <= 0) throw new Error("output.fps must be greater than 0.");
  if (barWidth <= 0 || barHeight <= 0) throw new Error("layout width/height must be greater than 0.");
  if (barX < 0 || barY < 0 || barX + barWidth > width || barY + barHeight > height) {
    throw new Error("Progress bar is outside the video frame. Check width_percent, x_offset, position, and y_offset.");
  }

  let x = 0;
  const warnings = [];
  const computed = chapters.map((chapter, index) => {
    const start = starts[index];
    const end = index + 1 < starts.length ? starts[index + 1] : duration;
    const chapterDuration = end - start;
    const chapterWidth = index + 1 === chapters.length ? barWidth - x : Math.round((barWidth * chapterDuration) / duration);
    const title = String(chapter.title || `Chapter ${index + 1}`);
    const estimatedTitleWidth = estimateTitleWidth(title, fontSize);

    if (title.length > maxTitleLength) {
      warnings.push(`Title "${title}" is longer than max_title_length ${maxTitleLength}.`);
    }
    if (estimatedTitleWidth > chapterWidth * 0.86) {
      warnings.push(`Title "${title}" may not fit in its ${chapterWidth}px chapter segment.`);
    }

    const item = {
      index: index + 1,
      title,
      start: formatTime(start),
      end: formatTime(end),
      start_seconds: start,
      end_seconds: end,
      duration_seconds: chapterDuration,
      x,
      absolute_x: barX + x,
      width: chapterWidth,
    };
    x += chapterWidth;
    return item;
  });

  return {
    width,
    height,
    duration,
    barWidth,
    barHeight,
    barX,
    barY,
    fps,
    fontSize,
    chapters: computed,
    warnings,
  };
}

function renderSvg(config, timeline, atSeconds) {
  const topOffset = timeline.barY;
  const playedWidth = clamp((timeline.barWidth * atSeconds) / timeline.duration, 0, timeline.barWidth);
  const fillOpacity = Number(config.progress.opacity || 100) / 100;
  const sepOpacity = Number(config.separator.opacity || 60) / 100;
  const textY = topOffset + timeline.barHeight / 2 + timeline.fontSize * 0.35;
  const fontFamily = config.text.font_family || "Arial, sans-serif";
  const separatorEnabled = config.separator.enabled !== false;
  const separatorSymbol = config.separator.symbol || "|";

  const chapterTexts = timeline.chapters
    .map((chapter) => {
      const center = timeline.barX + chapter.x + chapter.width / 2;
      return `<text x="${center}" y="${textY}" text-anchor="middle" font-family="${escapeXml(fontFamily)}" font-size="${timeline.fontSize}" font-weight="${escapeXml(config.text.font_weight || "bold")}" fill="${escapeXml(config.text.color || "#FFFFFF")}">${escapeXml(chapter.title)}</text>`;
    })
    .join("\n  ");

  const separators = separatorEnabled
    ? timeline.chapters
        .slice(1)
        .map((chapter) => {
          return `<text x="${timeline.barX + chapter.x}" y="${textY}" text-anchor="middle" font-family="${escapeXml(fontFamily)}" font-size="${timeline.fontSize}" font-weight="${escapeXml(config.text.font_weight || "bold")}" fill="${escapeXml(config.separator.color || "#FFFFFF")}" opacity="${sepOpacity}">${escapeXml(separatorSymbol)}</text>`;
        })
        .join("\n  ")
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${timeline.width}" height="${timeline.height}" viewBox="0 0 ${timeline.width} ${timeline.height}">
  <rect x="0" y="0" width="${timeline.width}" height="${timeline.height}" fill="transparent"/>
  <rect x="${timeline.barX}" y="${topOffset}" width="${timeline.barWidth}" height="${timeline.barHeight}" fill="${escapeXml(config.progress.unplayed_color || "#A8A8A8")}" opacity="${fillOpacity}"/>
  <rect x="${timeline.barX}" y="${topOffset}" width="${playedWidth}" height="${timeline.barHeight}" fill="${escapeXml(config.progress.played_color || "#F4A6C1")}" opacity="${fillOpacity}"/>
  ${separators}
  ${chapterTexts}
</svg>
`;
}

function renderHtml(config, timeline) {
  const topOffset = timeline.barY;
  const fontFamily = config.text.font_family || "Arial, sans-serif";
  const sepOpacity = Number(config.separator.opacity || 60) / 100;
  const separatorEnabled = config.separator.enabled !== false;
  const separatorSymbol = config.separator.symbol || "|";
  const chapterLabels = timeline.chapters
    .map((chapter) => {
      return `<div class="chapter" style="left:${timeline.barX + chapter.x}px;width:${chapter.width}px;">${escapeXml(chapter.title)}</div>`;
    })
    .join("\n      ");
  const separators = separatorEnabled
    ? timeline.chapters
        .slice(1)
        .map((chapter) => {
          return `<div class="separator" style="left:${timeline.barX + chapter.x}px;">${escapeXml(separatorSymbol)}</div>`;
        })
        .join("\n      ")
    : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Progress Bar Preview</title>
  <style>
    html, body {
      width: ${timeline.width}px;
      height: ${timeline.height}px;
      margin: 0;
      background: transparent;
      overflow: hidden;
    }
    .stage {
      position: relative;
      width: ${timeline.width}px;
      height: ${timeline.height}px;
      background: transparent;
      font-family: ${fontFamily};
    }
    .bar {
      position: absolute;
      left: ${timeline.barX}px;
      top: ${topOffset}px;
      width: ${timeline.barWidth}px;
      height: ${timeline.barHeight}px;
      background: ${config.progress.unplayed_color || "#A8A8A8"};
      overflow: hidden;
    }
    .played {
      position: absolute;
      left: 0;
      top: 0;
      height: 100%;
      width: 0;
      background: ${config.progress.played_color || "#F4A6C1"};
      animation: fill ${timeline.duration}s linear forwards;
    }
    .chapter,
    .separator {
      position: absolute;
      top: ${topOffset}px;
      height: ${timeline.barHeight}px;
      line-height: ${timeline.barHeight}px;
      font-size: ${timeline.fontSize}px;
      font-weight: ${config.text.font_weight || "bold"};
      color: ${config.text.color || "#FFFFFF"};
      text-align: center;
      white-space: nowrap;
      pointer-events: none;
    }
    .separator {
      transform: translateX(-50%);
      color: ${config.separator.color || "#FFFFFF"};
      opacity: ${sepOpacity};
    }
    @keyframes fill {
      from { width: 0; }
      to { width: ${timeline.barWidth}px; }
    }
  </style>
</head>
<body>
  <div class="stage">
    <div class="bar"><div class="played"></div></div>
    ${separators}
    ${chapterLabels}
  </div>
</body>
</html>
`;
}

function hasFfmpeg() {
  return hasBinary("ffmpeg");
}

function resolveVideoFile(config) {
  return config.video && config.video.file && fs.existsSync(config.video.file) ? config.video.file : null;
}

function buildOverlayFilter(config, timeline) {
  const played = parseHexColor(config.progress.played_color, "#F4A6C1");
  const unplayed = parseHexColor(config.progress.unplayed_color, "#A8A8A8");
  const fillAlpha = Math.round(clamp(Number(config.progress.opacity || 100) / 100, 0, 1) * 255);
  const sepOpacity = clamp(Number(config.separator.opacity || 60) / 100, 0, 1);
  const barX = timeline.barX;
  const barY = timeline.barY;
  const barRight = timeline.barX + timeline.barWidth - 1;
  const barBottom = timeline.barY + timeline.barHeight - 1;
  const lastFrame = Math.max(1, Math.round(timeline.duration * timeline.fps) - 1);
  const insideBar = `between(X\\,${barX}\\,${barRight})*between(Y\\,${barY}\\,${barBottom})`;
  const playedEdge = `${barX}+${timeline.barWidth}*N/${lastFrame}`;
  const channel = (playedChannel, unplayedChannel) =>
    `if(${insideBar}\\,if(lte(X\\,${playedEdge})\\,${playedChannel}\\,${unplayedChannel})\\,0)`;

  const filters = [
    `geq=r='${channel(played.r, unplayed.r)}':g='${channel(played.g, unplayed.g)}':b='${channel(played.b, unplayed.b)}':a='if(${insideBar}\\,${fillAlpha}\\,0)'`,
  ];

  if (config.separator.enabled !== false) {
    const separatorColor = parseHexColor(config.separator.color, "#FFFFFF");
    const separatorWidth = Math.max(1, Math.round(Number(config.separator.width || 2)));
    const separatorTop = Math.round(barY + timeline.barHeight * 0.18);
    const separatorHeight = Math.max(1, Math.round(timeline.barHeight * 0.64));
    for (const chapter of timeline.chapters.slice(1)) {
      filters.push(
        `drawbox=x=${timeline.barX + chapter.x - Math.floor(separatorWidth / 2)}:y=${separatorTop}:w=${separatorWidth}:h=${separatorHeight}:color=${separatorColor.ffmpeg}@${sepOpacity}:t=fill`,
      );
    }
  }

  const fontSize = Math.round(timeline.fontSize);
  const fontFile = resolveFontFile(config);
  const fontFamily = String(config.text.font_family || "Arial").split(",")[0].trim().replace(/^["']|["']$/g, "");
  const fontOption = fontFile
    ? `fontfile=${escapeFfmpegPath(fontFile)}`
    : `font=${escapeFfmpegText(fontFamily || "Arial")}`;
  const fontColor = parseHexColor(config.text.color, "#FFFFFF").ffmpeg;
  const textOpacity = clamp(Number(config.text.opacity || 100) / 100, 0, 1);
  const weightNotice = config.text.font_weight && config.text.font_weight !== "normal" ? "" : "";
  void weightNotice;

  for (const chapter of timeline.chapters) {
    const x = `${timeline.barX + chapter.x}+(${chapter.width}-text_w)/2`;
    const y = `${timeline.barY}+(${timeline.barHeight}-text_h)/2`;
    filters.push(
      `drawtext=${fontOption}:text='${escapeFfmpegText(chapter.title)}':fontsize=${fontSize}:fontcolor=${fontColor}@${textOpacity}:x='${x}':y='${y}'`,
    );
  }

  return filters.join(",");
}

function buildOverlayCommand(config, timeline, overlayPath) {
  const filter = buildOverlayFilter(config, timeline);
  return [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `nullsrc=s=${timeline.width}x${timeline.height}:r=${timeline.fps}:d=${timeline.duration},format=rgba`,
    "-vf",
    filter,
    "-an",
    "-c:v",
    "prores_ks",
    "-profile:v",
    "4",
    "-pix_fmt",
    "yuva444p10le",
    "-alpha_bits",
    "16",
    overlayPath,
  ];
}

function buildCompositeCommand(videoFile, overlayPath, outputPath) {
  return [
    "-y",
    "-i",
    videoFile,
    "-i",
    overlayPath,
    "-filter_complex",
    "[0:v][1:v]overlay=0:0:format=auto[v]",
    "-map",
    "[v]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "medium",
    "-c:a",
    "copy",
    "-shortest",
    outputPath,
  ];
}

function runFfmpeg(args, logPath) {
  const ffmpeg = resolveBinary("ffmpeg");
  const result = spawnSync(ffmpeg, args, { encoding: "utf8" });
  fs.writeFileSync(
    logPath,
    [
      commandForDisplay(ffmpeg, args),
      "",
      "STDOUT:",
      result.stdout || "",
      "",
      "STDERR:",
      result.stderr || "",
    ].join("\n"),
  );
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed. See ${logPath}`);
  }
}

function exportVideos(config, timeline, outDir, args) {
  const overlayPath = path.join(outDir, "progress-overlay.mov");
  const compositePath = path.join(outDir, "progress-composited.mp4");
  const overlayArgs = buildOverlayCommand(config, timeline, overlayPath);
  const videoFile = resolveVideoFile(config);
  const shouldComposite =
    !args.overlayOnly && videoFile && config.output && config.output.fallback_direct_composite !== false;
  const compositeArgs = shouldComposite ? buildCompositeCommand(videoFile, overlayPath, compositePath) : null;

  const commandText = [
    "# Transparent overlay export",
    commandForDisplay(resolveBinary("ffmpeg"), overlayArgs),
    "",
    shouldComposite ? "# Direct-composited fallback" : "# Direct-composited fallback skipped: no local video.file or --overlay-only was used",
    shouldComposite ? commandForDisplay(resolveBinary("ffmpeg"), compositeArgs) : "",
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "ffmpeg-commands.txt"), commandText);

  if (!args.exportVideo || !hasFfmpeg()) {
    return {
      overlayPath,
      compositePath: shouldComposite ? compositePath : null,
      exported: false,
      compositeExported: false,
    };
  }

  runFfmpeg(overlayArgs, path.join(outDir, "ffmpeg-overlay.log"));
  if (shouldComposite) {
    runFfmpeg(compositeArgs, path.join(outDir, "ffmpeg-composite.log"));
  }

  return {
    overlayPath,
    compositePath: shouldComposite ? compositePath : null,
    exported: true,
    compositeExported: Boolean(shouldComposite),
  };
}

function ffmpegNotes(config, timeline, ffmpegAvailable, exportResult, args) {
  const videoFile = config.video && config.video.file ? config.video.file : "input-video.mp4";
  return `Video Progress Bar export notes

FFmpeg available: ${ffmpegAvailable ? "yes" : "no"}
Video export requested: ${args.exportVideo ? "yes" : "no"}

Generated preview files are ready. The HTML preview is transparent and animated, but Jianying/CapCut usually needs a video overlay file rather than HTML.

${exportResult.exported ? `Transparent overlay material: ${exportResult.overlayPath}` : args.exportVideo ? "Transparent overlay material was not exported. Install ffmpeg and rerun." : "Transparent overlay material was not exported because --no-video was used."}
${exportResult.compositeExported ? `Direct composite fallback: ${exportResult.compositePath}` : "Direct composite fallback was not exported. Provide a local video.file or rerun without --overlay-only."}

Video:
- file: ${videoFile}
- size: ${timeline.width}x${timeline.height}
- duration: ${formatTime(timeline.duration)}
- bar: ${timeline.barWidth}x${timeline.barHeight} at (${timeline.barX}, ${timeline.barY})
- fps: ${timeline.fps}

Keep the overlay aligned to 00:00 in Jianying/CapCut.
See ffmpeg-commands.txt for the exact commands.
`;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    usage();
    process.exit(1);
  }

  const inputPath = path.resolve(args.input);
  const presetPath = path.resolve(args.preset || path.join(path.dirname(inputPath), "..", "presets", "default-3x4.yaml"));
  const outDir = path.resolve(args.out);

  const input = parseSimpleYaml(fs.readFileSync(inputPath, "utf8"));
  const preset = fs.existsSync(presetPath) ? parseSimpleYaml(fs.readFileSync(presetPath, "utf8")) : {};
  const config = hydrateVideoMetadata(mergeConfig(preset, input), inputPath);
  const timeline = buildTimeline(config);
  const previewAt = args.at ? parseTimecode(args.at) : timeline.duration / 2;
  const ffmpegAvailable = hasFfmpeg();

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "chapter-timing.json"), JSON.stringify({ timeline, warnings: timeline.warnings }, null, 2));
  fs.writeFileSync(path.join(outDir, "preview.svg"), renderSvg(config, timeline, previewAt));
  fs.writeFileSync(path.join(outDir, "preview.html"), renderHtml(config, timeline));
  const exportResult = exportVideos(config, timeline, outDir, args);
  fs.writeFileSync(path.join(outDir, "ffmpeg-notes.txt"), ffmpegNotes(config, timeline, ffmpegAvailable, exportResult, args));

  console.log(`Generated progress bar assets in ${outDir}`);
  console.log(`- preview.svg`);
  console.log(`- preview.html`);
  console.log(`- chapter-timing.json`);
  console.log(`- ffmpeg-commands.txt`);
  console.log(`- ffmpeg-notes.txt`);
  if (exportResult.exported) console.log(`- progress-overlay.mov`);
  if (exportResult.compositeExported) console.log(`- progress-composited.mp4`);
  if (args.exportVideo && !ffmpegAvailable) {
    console.log("\nVideo export skipped because ffmpeg is not installed. Preview files and ffmpeg commands were still generated.");
  }
  if (timeline.warnings.length) {
    console.log("\nWarnings:");
    timeline.warnings.forEach((warning) => console.log(`- ${warning}`));
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
