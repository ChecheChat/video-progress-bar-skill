# AI 视频章节进度条 Skill

<div align="center">

**给已经剪好的视频，自动生成可导入剪映 / CapCut 的透明章节进度条素材。**

不用手动画矩形，不用反复对齐章节。  
填好视频时长和章节时间，跑一条命令，就能得到预览图、动态预览页和透明 `.mov` 进度条素材。

</div>

---

> ## 这个项目适合谁？
>
> 适合已经剪好视频、已经知道章节时间点，但不想每期都手动做章节进度条的创作者。
>
> 它不是“自动剪视频工具”，而是专门解决一个很具体的小自动化问题：  
> **把重复制作章节进度条这一步交给脚本和 AI Agent。**

## 效果预览

下面是示例配置生成出来的静态预览图：

<div align="center">
  <img src="assets/demo/preview.svg" width="360" alt="视频章节进度条静态预览" />
  <br/>
  <sub>示例：1080x1440 竖屏视频，章节宽度按时长比例计算</sub>
</div>

这个项目运行后会生成：

| 文件 | 用途 |
|---|---|
| `preview.svg` | 静态预览图，可以快速看颜色、文字和章节比例 |
| `preview.html` | 动态预览页，可以在浏览器里看进度条播放效果 |
| `chapter-timing.json` | 校验后的章节时间和每段宽度数据 |
| `progress-overlay.mov` | 带透明通道的视频素材，可导入剪映 / CapCut |
| `progress-composited.mp4` | 可选：如果提供源视频，可直接合成一个 mp4 |

> 注意：`progress-overlay.mov` 会保留透明通道，文件可能比较大，这是正常的。仓库里只放预览示例，不上传生成后的视频大文件。

## 它是怎么工作的？

| 步骤 | 你提供什么 | 程序做什么 |
|---|---|---|
| 1 | 视频宽高、总时长、章节标题、章节开始时间 | 校验章节时间 |
| 2 | 样式预设，比如颜色、字体、高度、位置 | 生成静态预览和动态预览 |
| 3 | FFmpeg 视频导出 | 生成透明 `.mov` 进度条素材 |
| 4 | 剪映 / CapCut 导入 | 放到原视频上方轨道，并从 `00:00` 对齐 |

章节宽度不是平均分配的，而是按章节时长占整个视频的比例计算。  
比如某一章更长，它在进度条上占的宽度也会更长。

## 使用前需要准备

| 工具 | 作用 |
|---|---|
| Node.js 18+ | 运行这个脚本 |
| FFmpeg / FFprobe | 导出透明 `.mov` 视频素材 |

FFmpeg 是独立的开源视频工具，不包含在本仓库里。  
如果暂时没有安装 FFmpeg，也可以先生成 `preview.svg` 和 `preview.html` 看效果；等 FFmpeg 配好后，再导出正式素材。

## 快速开始

### 1. 修改输入文件

打开 `examples/sample-input.yaml`，把它改成你自己的视频信息：

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
  - title: "HTML"
    start: "01:36"
  - title: "结构"
    start: "02:45"
  - title: "总结"
    start: "03:58"
```

如果你填写的是本地真实视频路径，脚本会尝试自动读取视频宽高和时长：

```yaml
video:
  file: "/Users/you/Videos/my-video.mp4"
```

### 2. 运行命令

在项目文件夹里运行：

```bash
node scripts/generate-progress-bar.js examples/sample-input.yaml --preset presets/default-3x4.yaml --out output/sample
```

### 3. 导入剪映 / CapCut

运行完成后，透明进度条素材会在这里：

```text
output/sample/progress-overlay.mov
```

把 `progress-overlay.mov` 导入剪映或 CapCut，放到原视频上方轨道，并从 `00:00` 对齐即可。

## 可以自定义什么？

样式不用改代码，只需要复制一份预设文件再修改：

```bash
cp presets/default-3x4.yaml presets/my-style.yaml
node scripts/generate-progress-bar.js examples/sample-input.yaml --preset presets/my-style.yaml --out output/my-run
```

常用配置项：

| 想修改什么 | 修改哪个字段 | 示例 |
|---|---|---|
| 已播放颜色 | `progress.played_color` | `"#F4A6C1"` |
| 未播放颜色 | `progress.unplayed_color` | `"#A8A8A8"` |
| 文字颜色 | `text.color` | `"#FFFFFF"` |
| 字体文件 | `text.font_file` | `"/path/to/font.ttf"` |
| 字号 | `text.font_size` | `"auto"` 或 `42` |
| 进度条高度 | `layout.height_percent` | `6.9` |
| 顶部 / 底部 | `layout.position` | `"top"` 或 `"bottom"` |
| 分割线开关 | `separator.enabled` | `true` / `false` |
| 分割线粗细 | `separator.width` | `2` |
| 分割线颜色 | `separator.color` | `"#FFFFFF"` |

默认预设在 `presets/default-3x4.yaml`：

```yaml
layout:
  position: "top"
  width_percent: 100
  height_percent: 6.9

progress:
  played_color: "#F4A6C1"
  unplayed_color: "#A8A8A8"

text:
  color: "#FFFFFF"
  font_family: "PingFang SC, Microsoft YaHei, Hiragino Sans GB, Arial, sans-serif"
  font_file: ""
  font_size: "auto"
  font_weight: "bold"

separator:
  enabled: true
  width: 2
  color: "#FFFFFF"
```

## 字体说明

预览文件会优先使用：

```text
PingFang SC, Microsoft YaHei, Hiragino Sans GB, Arial, sans-serif
```

导出 `.mov` 时，FFmpeg 需要真实的本地字体文件。  
如果 `text.font_file` 为空，脚本会自动尝试寻找 macOS / Windows / Linux 上常见的中文字体。

如果你想强制使用某个字体，可以这样写：

```yaml
text:
  font_file: "/Users/you/Fonts/YourFont.ttf"
```

支持 `.ttf`、`.otf`、`.ttc` 字体文件。

## 普通用户和 AI Agent 用户怎么用？

| 使用方式 | 怎么操作 |
|---|---|
| 普通用户 | 下载本仓库，修改 YAML，运行命令 |
| Codex / Claude Code 用户 | 让 Agent 阅读 `SKILL.md`，再让它帮你生成配置、运行脚本、检查结果 |

`SKILL.md` 是写给 AI Agent 的说明书。  
普通用户不一定需要读它，但 Agent 读完以后，会更清楚该如何配合你生成进度条。

## 仓库结构

```text
video-progress-bar-skill/
├── README.md
├── SKILL.md
├── examples/
│   └── sample-input.yaml
├── presets/
│   └── default-3x4.yaml
├── scripts/
│   └── generate-progress-bar.js
└── assets/
    ├── demo/
    │   ├── preview.svg
    │   ├── preview.html
    │   └── demo-input.yaml
    └── community/
        └── wechat-group.jpg
```

## 注意事项

- 章节开始时间必须递增。
- 最后一章会自动结束在视频总时长。
- 章节标题不要太长，否则容易挤在进度条里。
- 默认章节宽度按时长比例计算，不是平均分。
- `output/` 里的生成结果不会上传到 GitHub。
- 透明 `.mov` 文件因为保留 alpha 通道，体积可能明显大于普通 mp4。

## 交流群 / 更多 AI 自媒体实践

我是 **车车Chat**，会持续分享 AI 自媒体、设计师 AI 工作流、视频自动化相关实践。

<div align="center">
  <img src="assets/community/wechat-group.jpg" width="260" alt="车车 AI 观察室微信群二维码" />
  <br/>
  <sub>群聊：车车 AI 观察室。二维码可能过期，如果失效，可以全网搜索：车车Chat。</sub>
</div>

## License

MIT License.  

FFmpeg 是独立开源项目，本仓库不包含 FFmpeg 本体，用户需要自行安装或配置。
