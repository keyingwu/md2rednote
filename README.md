<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# md2rednote

把 Markdown 导出成适合小红书发布的分页 PNG，主打本地 CLI 工作流。

核心点：

- `md2rednote` 是一个本地命令行工具
- 用 Playwright + Chromium 渲染，尽量保证预览和导出一致
- 直接输出分页 PNG，可选打包 ZIP
- 同时保留一个网页预览界面，但它不是主入口

## CLI First

### 1. 安装

要求：Node.js

```bash
npm install
npx playwright install chromium
```

第二条只需要执行一次，用来安装 CLI 导出依赖的 Chromium。

### 2. 最常用命令

```bash
npm run cli -- export --in ./article.md --out ./output
```

导出完成后会在 `./output` 下生成：

- `page-01.png`、`page-02.png` 这类分页图片
- 一个 ZIP 文件（默认开启）

如果你希望像普通命令一样直接调用，可以执行：

```bash
npm link
md2rednote export --in ./article.md --out ./output
```

## Usage

### 从 Markdown 导出

```bash
md2rednote export --in ./article.md --out ./output
```

如果 Markdown 第一行是 `# 标题`，CLI 会自动：

- 把这行当作标题
- 从正文里移除这行，避免首页重复显示

Markdown 里的相对图片路径会按源文件目录解析。

### 从 JSON 导出

```bash
md2rednote export --json ./article.json --out ./output
```

JSON 结构：

```json
{
  "enTitle": "English subtitle",
  "title": "主标题",
  "metadata": "作者 / 日期 / 标签",
  "body": "Markdown 正文",
  "images": {}
}
```

## 常用参数

```bash
md2rednote export \
  --in ./article.md \
  --out ./output \
  --template default \
  --width 600 \
  --ratio 4/3 \
  --padding 50 \
  --dpr 3 \
  --zip
```

支持参数：

- `--in, --input <file>`: Markdown 输入文件
- `--json <file>`: JSON 输入文件
- `--title <text>`: 覆盖标题
- `--en-title <text>`: 覆盖英文标题
- `--metadata <text>`: 覆盖元信息行
- `--template <id>`: 模板 ID，默认 `default`
- `--out <dir>`: 输出目录，默认 `./output`
- `--width <px>`: 卡片宽度，默认 `600`
- `--ratio <h/w>`: 页面比例，默认 `4/3`
- `--padding <px>`: 内边距，默认 `50`
- `--dpr <number>`: 渲染倍率，默认 `3`
- `--zip`: 同时输出 ZIP
- `--no-zip`: 不输出 ZIP
- `--help`: 查看帮助

## Templates

模板定义在 [`templates.js`](/Users/wukeying/Desktop/projects/90_personal/md2rednote/templates.js)，当前内置模板：

- `default`

CLI 和网页端共用同一份模板配置，避免两套样式分叉。

## Web Preview

如果你只想本地看实时预览，可以运行：

```bash
npm run dev
```

注意：这只会启动 Vite 前端，不会运行 `api/` 下的导出接口。

## Vercel Export API

项目也支持部署到 Vercel，通过 `POST /api/export` 走服务端导出。服务端会用 Playwright + Chromium 生成 PNG，再打包 ZIP 上传到 Vercel Blob。

需要的环境变量：

- `BLOB_READ_WRITE_TOKEN`：必填
- `EXPORT_SECRET`：可选；设置后，请求需要带 `Authorization: Bearer ...`

本地联调完整导出链路时可以用：

```bash
npm i -g vercel
vercel dev
```
