#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from 'playwright-core';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const COMMAND = 'md2rednote';

const printHelp = () => {
  // Keep the help terse; the primary audience is local CLI usage.
  // eslint-disable-next-line no-console
  console.log(`
${COMMAND} export --in <article.md> --out <dir> [options]
${COMMAND} export --json <article.json> --out <dir> [options]

Options:
  --in, --input <file>        Markdown body input
  --json <file>               ArticleContent JSON input { enTitle,title,metadata,body,images }
  --title <text>              Override title
  --en-title <text>           Override English title
  --metadata <text>           Override metadata line
  --out <dir>                 Output directory (default: ./output)
  --width <px>                Card width in CSS px (default: 600)
  --ratio <h/w>               Page ratio as "4/3" or "1.333" (default: 4/3)
  --padding <px>              Inner padding in CSS px (default: 50)
  --dpr <number>              Device scale factor (default: 3)
  --zip                        Also write a .zip next to PNGs
  --no-zip                     Skip zip
  --help                       Show help

Notes:
  - This CLI uses Chromium (Playwright) for pixel-perfect rendering.
  - If the Markdown starts with a '# ' heading, it will be used as the title and removed from the body.
  - If Chromium is missing, run: npx playwright install chromium
`.trim());
};

const parseArgs = (argv) => {
  const args = argv.slice(2);
  const result = {
    cmd: 'export',
    input: null,
    json: null,
    title: null,
    enTitle: null,
    metadata: null,
    outDir: path.resolve(process.cwd(), 'output'),
    width: 600,
    ratio: 4 / 3,
    padding: 50,
    dpr: 3,
    zip: true,
    help: false,
  };

  if (args.length === 0) return result;

  let i = 0;
  if (args[0] && !args[0].startsWith('-')) {
    result.cmd = args[0];
    i = 1;
  }

  while (i < args.length) {
    const token = args[i];
    if (token === '--help' || token === '-h') {
      result.help = true;
      i += 1;
      continue;
    }
    if (token === '--zip') {
      result.zip = true;
      i += 1;
      continue;
    }
    if (token === '--no-zip') {
      result.zip = false;
      i += 1;
      continue;
    }

    const next = args[i + 1];
    const takeValue = () => {
      if (!next || next.startsWith('-')) {
        throw new Error(`Missing value for ${token}`);
      }
      i += 2;
      return next;
    };

    switch (token) {
      case '--in':
      case '--input':
      case '-i':
        result.input = path.resolve(process.cwd(), takeValue());
        break;
      case '--json':
        result.json = path.resolve(process.cwd(), takeValue());
        break;
      case '--out':
      case '-o':
        result.outDir = path.resolve(process.cwd(), takeValue());
        break;
      case '--title':
        result.title = takeValue();
        break;
      case '--en-title':
        result.enTitle = takeValue();
        break;
      case '--metadata':
        result.metadata = takeValue();
        break;
      case '--width':
        result.width = Number(takeValue());
        break;
      case '--ratio': {
        const raw = takeValue().trim();
        if (raw.includes('/')) {
          const [h, w] = raw.split('/').map((part) => Number(part));
          result.ratio = h / w;
        } else {
          result.ratio = Number(raw);
        }
        break;
      }
      case '--padding':
        result.padding = Number(takeValue());
        break;
      case '--dpr':
        result.dpr = Number(takeValue());
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return result;
};

const assertNumberInRange = (value, label, { min, max }) => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a number.`);
  if (value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`);
};

const loadArticleFromJson = async (jsonPath) => {
  const raw = await readFile(jsonPath, 'utf8');
  const parsed = JSON.parse(raw);

  return {
    enTitle: typeof parsed.enTitle === 'string' ? parsed.enTitle : '',
    title: typeof parsed.title === 'string' ? parsed.title : '',
    metadata: typeof parsed.metadata === 'string' ? parsed.metadata : '',
    body: typeof parsed.body === 'string' ? parsed.body : '',
    images: typeof parsed.images === 'object' && parsed.images ? parsed.images : {},
  };
};

const loadPreviewCss = async () => {
  const cssPath = path.join(repoRoot, 'styles', 'tailwind.css');
  const css = await readFile(cssPath, 'utf8');
  return css
    .split('\n')
    .filter((line) => !line.trim().startsWith('@import "tailwindcss"') && !line.trim().startsWith("@import 'tailwindcss'"))
    .join('\n');
};

const remarkObsidianEmbeds = () => (tree) => {
  const imageExtPattern = /\.(png|jpe?g|gif|webp|svg)$/i;
  const embedPattern = /!\[\[([^\]]+?)\]\]/g;

  const parseEmbed = (raw) => {
    const parts = raw.split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 1) return null;

    const target = parts[0];
    if (!imageExtPattern.test(target)) return null;

    let alt = '';
    let width = null;

    if (parts.length >= 2) {
      if (/^\d+$/.test(parts[1])) {
        width = Number(parts[1]);
      } else {
        alt = parts[1];
      }
    }
    if (parts.length >= 3 && width == null && /^\d+$/.test(parts[2])) {
      width = Number(parts[2]);
    }

    return { target, alt, width };
  };

  visit(tree, 'text', (node, index, parent) => {
    if (!parent || typeof index !== 'number') return;
    const value = typeof node.value === 'string' ? node.value : '';
    if (!value.includes('![[', 0)) return;

    const nextChildren = [];
    let lastIndex = 0;
    let match;
    while ((match = embedPattern.exec(value)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      const parsed = parseEmbed(match[1] ?? '');
      if (!parsed) continue;

      if (start > lastIndex) {
        nextChildren.push({ type: 'text', value: value.slice(lastIndex, start) });
      }

      const encodedTarget = encodeURI(parsed.target);
      if (parsed.width && Number.isFinite(parsed.width) && parsed.width > 0) {
        nextChildren.push({
          type: 'html',
          value: `<img src="${escapeHtml(encodedTarget)}" alt="${escapeHtml(parsed.alt)}" width="${Math.round(parsed.width)}" />`,
        });
      } else {
        nextChildren.push({
          type: 'image',
          url: encodedTarget,
          alt: parsed.alt,
        });
      }

      lastIndex = end;
    }

    if (nextChildren.length === 0) return;

    if (lastIndex < value.length) {
      nextChildren.push({ type: 'text', value: value.slice(lastIndex) });
    }

    parent.children.splice(index, 1, ...nextChildren);
    // Tell unist-util-visit that we've replaced this node with N nodes.
    return [index + nextChildren.length, 0];
  });
};

const rehypeOrderedList = () => (tree) => {
  visit(tree, 'element', (node) => {
    if (node.tagName !== 'ol') return;
    const startProp = node.properties?.start;
    const start = Number.isFinite(Number(startProp)) ? Number(startProp) : 1;

    let index = start;
    node.children?.forEach((child) => {
      if (!child || child.type !== 'element' || child.tagName !== 'li') return;

      const existingClass = child.properties?.className;
      const className = Array.isArray(existingClass)
        ? existingClass
        : typeof existingClass === 'string'
          ? existingClass.split(' ').filter(Boolean)
          : [];

      if (!className.includes('ordered-list-item')) className.push('ordered-list-item');
      child.properties = { ...(child.properties || {}), className };

      const markerNode = {
        type: 'element',
        tagName: 'span',
        properties: { className: ['ordered-list-marker'], 'aria-hidden': 'true' },
        children: [{ type: 'text', value: `${index}.` }],
      };

      const contentNode = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['ordered-list-content'] },
        children: child.children || [],
      };

      child.children = [markerNode, contentNode];
      index += 1;
    });
  });
};

const rehypeImageMap = (images) => (tree) => {
  if (!images || typeof images !== 'object') return;
  visit(tree, 'element', (node) => {
    if (node.tagName !== 'img') return;
    const src = node.properties?.src;
    if (typeof src !== 'string') return;
    if (!Object.prototype.hasOwnProperty.call(images, src)) return;
    node.properties = { ...(node.properties || {}), src: images[src] };
  });
};

const guessImageMimeType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return null;
  }
};

const stripQueryAndHash = (src) => src.split('#')[0].split('?')[0];

const resolveLocalImagePath = (rawSrc, baseDir) => {
  const src = stripQueryAndHash(rawSrc);
  const decoded = (() => {
    try {
      return decodeURI(src);
    } catch {
      return src;
    }
  })();

  if (decoded.startsWith('file://')) {
    try {
      return fileURLToPath(decoded);
    } catch {
      return null;
    }
  }

  if (path.isAbsolute(decoded)) return decoded;
  if (!baseDir) return null;
  return path.resolve(baseDir, decoded);
};

const rehypeInlineLocalImages = ({ baseDir, missing }) => async (tree) => {
  const tasks = [];
  visit(tree, 'element', (node) => {
    if (node.tagName !== 'img') return;
    const src = node.properties?.src;
    if (typeof src !== 'string' || src.length < 1) return;
    if (src.startsWith('data:') || src.startsWith('blob:')) return;
    if (src.startsWith('http://') || src.startsWith('https://')) return;
    // Inline file:// and relative assets so Chromium can render them from setContent().
    tasks.push({ node, src });
  });

  await Promise.all(tasks.map(async ({ node, src }) => {
    const resolved = resolveLocalImagePath(src, baseDir);
    if (!resolved) {
      missing?.push(src);
      return;
    }

    const mime = guessImageMimeType(resolved);
    if (!mime) {
      missing?.push(src);
      return;
    }

    try {
      const buf = await readFile(resolved);
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      node.properties = { ...(node.properties || {}), src: dataUrl };
    } catch {
      missing?.push(src);
    }
  }));
};

const markdownToHtml = async (markdown, images, { baseDir, missingImages } = {}) => {
  const processed = markdown.replace(/==(.*?)==/g, '<mark>$1</mark>');

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkObsidianEmbeds)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeHighlight)
    .use(rehypeOrderedList)
    .use(rehypeImageMap, images)
    .use(rehypeInlineLocalImages, { baseDir, missing: missingImages })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(processed);

  return String(file);
};

const escapeHtml = (value) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const extractLeadingH1 = (markdown) => {
  const lines = markdown.split(/\r?\n/);
  let cursor = 0;

  while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1;

  if (cursor < lines.length && lines[cursor].trim() === '---') {
    cursor += 1;
    while (cursor < lines.length && lines[cursor].trim() !== '---') cursor += 1;
    if (cursor < lines.length && lines[cursor].trim() === '---') cursor += 1;
    while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1;
  }

  const headingLine = lines[cursor] ?? '';
  const match = headingLine.match(/^#(?!#)\s+(.+?)\s*$/);
  if (!match) return { title: null, body: markdown };

  const title = (match[1] || '').replace(/\s+#\s*$/, '').trim();
  if (!title) return { title: null, body: markdown };

  const nextLines = lines.slice(0, cursor).concat(lines.slice(cursor + 1));
  if (cursor < nextLines.length && nextLines[cursor].trim() === '') {
    nextLines.splice(cursor, 1);
  }

  return { title, body: nextLines.join('\n') };
};

const buildHtmlDocument = async ({ enTitle, title, metadata, bodyHtml, baseHref, cardWidth, cardHeight, padding }) => {
  const previewCss = await loadPreviewCss();

  const layoutCss = `
    :root {
      --md2rn-card-w: ${cardWidth}px;
      --md2rn-card-h: ${cardHeight}px;
      --md2rn-pad: ${padding}px;
      --md2rn-content-w: calc(var(--md2rn-card-w) - (var(--md2rn-pad) * 2));
      --md2rn-content-h: calc(var(--md2rn-card-h) - (var(--md2rn-pad) * 2));
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
    }
    * { box-sizing: border-box; }
    #md2rn-stage {
      display: grid;
      place-items: start;
      padding: 0;
    }
    #md2rn-card {
      position: relative;
      width: var(--md2rn-card-w);
      height: var(--md2rn-card-h);
      background: #ffffff;
      border-radius: 18px;
      overflow: hidden;
    }
    #md2rn-viewport {
      position: absolute;
      left: var(--md2rn-pad);
      right: var(--md2rn-pad);
      top: var(--md2rn-pad);
      bottom: var(--md2rn-pad);
      overflow: hidden;
    }
    #md2rn-flow {
      position: relative;
      left: 0;
      top: 0;
      width: var(--md2rn-content-w);
      height: var(--md2rn-content-h);
      column-width: var(--md2rn-content-w);
      column-gap: 0px;
      column-fill: auto;
      padding-bottom: 12px;
    }
    #md2rn-flow h1,
    #md2rn-flow h2,
    #md2rn-flow h3,
    #md2rn-flow h4,
    #md2rn-flow blockquote,
    #md2rn-flow pre,
    #md2rn-flow img {
      break-inside: avoid;
    }
    #md2rn-flow p,
    #md2rn-flow li {
      break-inside: auto;
    }
  `;

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${baseHref ? `<base href="${escapeHtml(baseHref)}" />` : ''}
    <title>md2rednote</title>

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;700;800&family=JetBrains+Mono:wght@400;700&family=Noto+Serif+SC:wght@700&display=swap">

    <style>${layoutCss}</style>
    <style>${previewCss}</style>
  </head>
  <body>
    <div id="md2rn-stage">
      <div id="md2rn-card" data-export-root="true">
        <div id="md2rn-viewport">
          <div id="md2rn-flow" class="typo-content">
            ${enTitle ? `<span class="en-title">${escapeHtml(enTitle)}</span>` : ''}
            ${title ? `<h1>${escapeHtml(title)}</h1>` : ''}
            ${metadata ? `<div class="metadata">${escapeHtml(metadata)}</div>` : ''}
            ${bodyHtml}
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;
};

const waitForAssets = async (page) => {
  await page.waitForLoadState('domcontentloaded');

  await page.evaluate(async () => {
    const waitFonts = async () => {
      if (!('fonts' in document)) return;
      try {
        await document.fonts.ready;
      } catch {
        // ignore
      }
    };

    const waitImages = async (timeoutMs = 12000) => {
      const images = Array.from(document.querySelectorAll('img'));
      await Promise.all(images.map((img) => new Promise((resolve) => {
        if (img.complete) {
          resolve();
          return;
        }
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          img.removeEventListener('load', done);
          img.removeEventListener('error', done);
          resolve();
        };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        setTimeout(done, timeoutMs);
      })));
    };

    await waitFonts();
    await waitImages();
  });
};

const computePages = async (page) => {
  return page.evaluate(() => {
    const viewport = document.getElementById('md2rn-viewport');
    const flow = document.getElementById('md2rn-flow');
    if (!viewport || !flow) return { pageCount: 1, pageWidth: 0 };

    const pageWidth = viewport.clientWidth;
    if (pageWidth <= 0) return { pageCount: 1, pageWidth: 0 };

    const totalWidth = flow.scrollWidth;
    const pageCount = Math.max(1, Math.floor((totalWidth + pageWidth / 2) / pageWidth));
    return { pageCount, pageWidth };
  });
};

const writeZip = async ({ outDir, files }) => {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.name, file.buffer);
  }
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const zipPath = path.join(outDir, `rednote-export-${Date.now()}.zip`);
  await writeFile(zipPath, buf);
  return zipPath;
};

const exportPages = async ({ article, outDir, width, ratio, padding, dpr, zip }) => {
  assertNumberInRange(width, 'width', { min: 240, max: 2000 });
  assertNumberInRange(ratio, 'ratio', { min: 0.5, max: 3 });
  assertNumberInRange(padding, 'padding', { min: 0, max: 200 });
  assertNumberInRange(dpr, 'dpr', { min: 1, max: 6 });

  const cardHeight = Math.round(width * ratio);
  const baseHref = article.baseHref || '';
  const missingImages = [];
  const bodyHtml = await markdownToHtml(article.body, article.images, { baseDir: article.baseDir, missingImages });
  const html = await buildHtmlDocument({
    enTitle: article.enTitle,
    title: article.title,
    metadata: article.metadata,
    bodyHtml,
    baseHref,
    cardWidth: width,
    cardHeight,
    padding,
  });

  await mkdir(outDir, { recursive: true });

  if (missingImages.length > 0) {
    const unique = Array.from(new Set(missingImages)).slice(0, 12);
    // eslint-disable-next-line no-console
    console.warn(`Warning: ${missingImages.length} image(s) could not be inlined. Examples:\n- ${unique.join('\n- ')}`);
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${message}\n\nChromium not found. Run: npx playwright install chromium`);
  }

  try {
    const context = await browser.newContext({
      viewport: { width: width + padding * 2, height: cardHeight + padding * 2 },
      deviceScaleFactor: dpr,
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });

    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await waitForAssets(page);

    const { pageCount, pageWidth } = await computePages(page);

    const card = page.locator('#md2rn-card');
    const files = [];
    for (let index = 0; index < pageCount; index += 1) {
      await page.evaluate((x) => {
        const flow = document.getElementById('md2rn-flow');
        if (!flow) return;
        flow.style.left = `${-Math.round(x)}px`;
      }, index * pageWidth);

      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));

      const buffer = await card.screenshot({ type: 'png' });
      const name = `rednote-page-${String(index + 1).padStart(2, '0')}.png`;
      const filePath = path.join(outDir, name);
      await writeFile(filePath, buffer);
      files.push({ name, buffer });
    }

    let zipPath = null;
    if (zip) {
      zipPath = await writeZip({ outDir, files });
    }

    return { pages: files.length, zipPath };
  } finally {
    await browser.close();
  }
};

const main = async () => {
  const opts = parseArgs(process.argv);

  if (opts.help || opts.cmd === 'help') {
    printHelp();
    return;
  }

  if (opts.cmd !== 'export') {
    throw new Error(`Unknown command: ${opts.cmd}`);
  }

  if (!opts.json && !opts.input) {
    printHelp();
    throw new Error('Missing --in <file> or --json <file>.');
  }

  const article = opts.json ? await loadArticleFromJson(opts.json) : {
    enTitle: '',
    title: '',
    metadata: '',
    body: '',
    images: {},
  };

  if (opts.input) {
    const markdown = await readFile(opts.input, 'utf8');
    const extracted = extractLeadingH1(markdown);
    article.body = extracted.body;
    article.baseHref = pathToFileURL(path.dirname(opts.input) + path.sep).toString();
    article.baseDir = path.dirname(opts.input);
    if (!article.title && extracted.title) {
      article.title = extracted.title;
    }
  }

  if (typeof opts.title === 'string') article.title = opts.title;
  if (typeof opts.enTitle === 'string') article.enTitle = opts.enTitle;
  if (typeof opts.metadata === 'string') article.metadata = opts.metadata;

  if (!article.body) {
    throw new Error('Article body is empty.');
  }

  const result = await exportPages({
    article,
    outDir: opts.outDir,
    width: opts.width,
    ratio: opts.ratio,
    padding: opts.padding,
    dpr: opts.dpr,
    zip: opts.zip,
  });

  // eslint-disable-next-line no-console
  console.log(`Exported ${result.pages} page(s) to ${opts.outDir}`);
  if (result.zipPath) {
    // eslint-disable-next-line no-console
    console.log(`ZIP: ${result.zipPath}`);
  }
};

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
