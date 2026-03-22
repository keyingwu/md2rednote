import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium as playwrightChromium } from 'playwright-core';
import { resolveTemplate } from '../templates.js';
import { MARKDOWN_TABLE_CLASS_NAMES } from '../markdownTableClasses.js';
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
const ancestorSearchRootsCache = new Map();
const imageFileIndexCache = new Map();
const MAX_IMAGE_SEARCH_ANCESTOR_DEPTH = 8;
const MAX_IMAGE_INDEX_ANCESTOR_DEPTH = 6;
const IMAGE_FILE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const SKIPPED_INDEX_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.jj',
  '.obsidian',
  '.trash',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.cache',
]);

const escapeHtml = (value) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const stripLeadingFrontmatter = (markdown) => {
  const lines = markdown.split(/\r?\n/);
  let cursor = 0;

  while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1;
  if (cursor >= lines.length || lines[cursor].trim() !== '---') return markdown;

  const frontmatterStart = cursor;
  cursor += 1;
  while (cursor < lines.length && lines[cursor].trim() !== '---') cursor += 1;
  if (cursor >= lines.length) return markdown;

  cursor += 1;
  while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1;

  return lines.slice(0, frontmatterStart).concat(lines.slice(cursor)).join('\n');
};

export const extractLeadingH1 = (markdown) => {
  const cleanedMarkdown = stripLeadingFrontmatter(markdown);
  const lines = cleanedMarkdown.split(/\r?\n/);
  let cursor = 0;

  while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1;

  const headingLine = lines[cursor] ?? '';
  const match = headingLine.match(/^#(?!#)\s+(.+?)\s*$/);
  if (!match) return { title: null, body: cleanedMarkdown };

  const title = (match[1] || '').replace(/\s+#\s*$/, '').trim();
  if (!title) return { title: null, body: cleanedMarkdown };

  const nextLines = lines.slice(0, cursor).concat(lines.slice(cursor + 1));
  if (cursor < nextLines.length && nextLines[cursor].trim() === '') {
    nextLines.splice(cursor, 1);
  }

  return { title, body: nextLines.join('\n') };
};

export const loadPreviewCss = async () => {
  const candidates = [
    path.join(repoRoot, 'index.css'),
    path.join(repoRoot, 'styles', 'tailwind.css'),
  ];

  let cssPath = candidates[0];
  let css = '';

  for (const candidate of candidates) {
    try {
      css = await readFile(candidate, 'utf8');
      cssPath = candidate;
      break;
    } catch {
      // try next
    }
  }

  if (!css) {
    throw new Error('Preview CSS not found. Expected index.css or styles/tailwind.css');
  }

  if (cssPath.endsWith(`${path.sep}tailwind.css`)) {
    return css
      .split('\n')
      .filter((line) => !line.trim().startsWith('@import "tailwindcss"') && !line.trim().startsWith("@import 'tailwindcss'"))
      .join('\n');
  }

  return css;
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

const TABLE_TAG_TO_CLASS_NAME = {
  table: MARKDOWN_TABLE_CLASS_NAMES.table,
  thead: MARKDOWN_TABLE_CLASS_NAMES.thead,
  tbody: MARKDOWN_TABLE_CLASS_NAMES.tbody,
  tr: MARKDOWN_TABLE_CLASS_NAMES.tr,
  th: MARKDOWN_TABLE_CLASS_NAMES.th,
  td: MARKDOWN_TABLE_CLASS_NAMES.td,
};

const appendClassName = (node, className) => {
  const existingClassName = node.properties?.className;
  const classNames = Array.isArray(existingClassName)
    ? [...existingClassName]
    : typeof existingClassName === 'string'
      ? existingClassName.split(/\s+/).filter(Boolean)
      : [];

  if (!classNames.includes(className)) classNames.push(className);
  node.properties = { ...(node.properties || {}), className: classNames };
};

const rehypeTableClasses = () => (tree) => {
  visit(tree, 'element', (node) => {
    const className = TABLE_TAG_TO_CLASS_NAME[node.tagName];
    if (!className) return;
    appendClassName(node, className);
  });
};

const rehypeLiftImagesOutOfParagraphs = () => (tree) => {
  visit(tree, 'element', (node, index, parent) => {
    if (!parent || typeof index !== 'number' || node.tagName !== 'p' || !Array.isArray(node.children)) return;

    const baseClassName = Array.isArray(node.properties?.className)
      ? node.properties.className
      : typeof node.properties?.className === 'string'
        ? node.properties.className.split(' ').filter(Boolean)
        : [];
    if (baseClassName.includes('md2rn-image-block')) return;

    const hasDirectImage = node.children.some((child) => child?.type === 'element' && child.tagName === 'img');
    if (!hasDirectImage) return;

    const substantiveChildren = node.children.filter((child) => {
      if (!child) return false;
      if (child.type === 'text') return child.value.replace(/\s+/g, '').length > 0;
      return true;
    });
    if (substantiveChildren.length === 1 && substantiveChildren[0]?.type === 'element' && substantiveChildren[0].tagName === 'img') {
      node.properties = {
        ...(node.properties || {}),
        className: [...baseClassName, 'md2rn-image-block'],
      };
      return;
    }

    const replacements = [];
    let currentChildren = [];

    const flushParagraph = () => {
      const hasSubstance = currentChildren.some((child) => {
        if (!child) return false;
        if (child.type === 'text') return child.value.replace(/\s+/g, '').length > 0;
        return true;
      });

      if (!hasSubstance) {
        currentChildren = [];
        return;
      }

      replacements.push({
        ...node,
        children: currentChildren,
      });
      currentChildren = [];
    };

    for (const child of node.children) {
      if (child?.type === 'element' && child.tagName === 'img') {
        flushParagraph();
        replacements.push({
          type: 'element',
          tagName: 'p',
          properties: {
            ...(node.properties || {}),
            className: [...baseClassName, 'md2rn-image-block'],
          },
          children: [child],
        });
        continue;
      }

      currentChildren.push(child);
    }

    flushParagraph();
    if (replacements.length > 0) {
      parent.children.splice(index, 1, ...replacements);
      return [index + replacements.length, 0];
    }
  });
};

const rehypeImageMap = (images) => (tree) => {
  if (!images || typeof images !== 'object') return;
  visit(tree, 'element', (node) => {
    if (node.tagName !== 'img') return;
    const src = node.properties?.src;
    if (typeof src !== 'string') return;
    if (Object.prototype.hasOwnProperty.call(images, src)) {
      node.properties = { ...(node.properties || {}), src: images[src] };
      return;
    }

    let decoded = null;
    try {
      decoded = decodeURI(src);
    } catch {
      decoded = null;
    }

    if (decoded && Object.prototype.hasOwnProperty.call(images, decoded)) {
      node.properties = { ...(node.properties || {}), src: images[decoded] };
      return;
    }

    let encoded = null;
    try {
      encoded = encodeURI(src);
    } catch {
      encoded = null;
    }
    if (encoded && Object.prototype.hasOwnProperty.call(images, encoded)) {
      node.properties = { ...(node.properties || {}), src: images[encoded] };
    }
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

const pathExists = async (candidate) => {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
};

const collectAncestorSearchRoots = (startDir) => {
  if (ancestorSearchRootsCache.has(startDir)) return ancestorSearchRootsCache.get(startDir);

  const roots = [];
  let current = startDir;
  let depth = 0;
  const homeDir = process.env.HOME ? path.resolve(process.env.HOME) : null;

  while (current && depth <= MAX_IMAGE_SEARCH_ANCESTOR_DEPTH) {
    roots.push(current);

    if (homeDir && current === homeDir) break;

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
    depth += 1;
  }

  ancestorSearchRootsCache.set(startDir, roots);
  return roots;
};

const indexImageFilesRecursively = async (rootDir) => {
  if (imageFileIndexCache.has(rootDir)) return imageFileIndexCache.get(rootDir);

  const indexPromise = (async () => {
    const index = new Map();

    const walk = async (dir) => {
      const entries = await readdir(dir, { withFileTypes: true });
      await Promise.all(entries.map(async (entry) => {
        const absolutePath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (SKIPPED_INDEX_DIRS.has(entry.name)) return;
          await walk(absolutePath);
          return;
        }

        if (!entry.isFile()) return;
        if (!IMAGE_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) return;

        const key = entry.name.toLowerCase();
        const matches = index.get(key) || [];
        matches.push(absolutePath);
        index.set(key, matches);
      }));
    };

    await walk(rootDir);
    return index;
  })();

  imageFileIndexCache.set(rootDir, indexPromise);
  return indexPromise;
};

const chooseNearestPath = (matches, baseDir) => {
  if (matches.length <= 1) return matches[0] || null;

  return [...matches].sort((left, right) => {
    const leftRelative = path.relative(baseDir, left);
    const rightRelative = path.relative(baseDir, right);
    const leftEscapes = leftRelative.startsWith('..');
    const rightEscapes = rightRelative.startsWith('..');
    if (leftEscapes !== rightEscapes) return leftEscapes ? 1 : -1;
    return leftRelative.length - rightRelative.length;
  })[0] || null;
};

const resolveLocalImagePath = async (rawSrc, baseDir) => {
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

  if (path.isAbsolute(decoded)) return (await pathExists(decoded)) ? decoded : null;
  if (!baseDir) return null;

  const searchRoots = collectAncestorSearchRoots(baseDir);
  for (const searchRoot of searchRoots) {
    const directCandidate = path.resolve(searchRoot, decoded);
    if (await pathExists(directCandidate)) return directCandidate;
  }

  if (decoded.includes('/') || decoded.includes('\\')) return null;

  const fileName = path.basename(decoded).toLowerCase();
  const indexedRoots = searchRoots.slice(0, MAX_IMAGE_INDEX_ANCESTOR_DEPTH + 1);
  for (const searchRoot of indexedRoots) {
    const index = await indexImageFilesRecursively(searchRoot);
    const matches = index.get(fileName) || [];
    const chosen = chooseNearestPath(matches, baseDir);
    if (chosen) return chosen;
  }

  return null;
};

const rehypeInlineLocalImages = ({ baseDir, missing }) => async (tree) => {
  if (!baseDir) return;
  const tasks = [];
  visit(tree, 'element', (node) => {
    if (node.tagName !== 'img') return;
    const src = node.properties?.src;
    if (typeof src !== 'string' || src.length < 1) return;
    if (src.startsWith('data:') || src.startsWith('blob:')) return;
    if (src.startsWith('http://') || src.startsWith('https://')) return;
    tasks.push({ node, src });
  });

  await Promise.all(tasks.map(async ({ node, src }) => {
    const resolved = await resolveLocalImagePath(src, baseDir);
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

export const markdownToHtml = async (markdown, images, { baseDir, missingImages } = {}) => {
  const processed = markdown.replace(/==(.*?)==/g, '<mark>$1</mark>');

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkObsidianEmbeds)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeHighlight)
    .use(rehypeLiftImagesOutOfParagraphs)
    .use(rehypeOrderedList)
    .use(rehypeTableClasses)
    .use(rehypeImageMap, images)
    .use(rehypeInlineLocalImages, { baseDir, missing: missingImages })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(processed);

  return String(file);
};

export const buildHtmlDocument = async ({
  enTitle,
  title,
  metadata,
  bodyHtml,
  baseHref,
  cardWidth,
  cardHeight,
  padding,
  previewCss,
  extraCss = '',
}) => {
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
    #md2rn-flow p.md2rn-image-block {
      break-inside: avoid;
    }
    #md2rn-flow p.md2rn-image-block img {
      margin: 0;
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
    <style>${previewCss || ''}</style>
    <style>${extraCss || ''}</style>
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

    const waitImages = async (timeoutMs = 15000) => {
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
    const pageCount = Math.max(1, Math.ceil(totalWidth / pageWidth));
    return { pageCount, pageWidth };
  });
};

const resolveLocalChromiumExecutablePath = async () => {
  const envCandidates = [
    process.env.MD2REDNOTE_CHROMIUM_PATH,
    process.env.CHROME_PATH,
    process.env.CHROMIUM_PATH,
  ].filter(Boolean);

  const platformCandidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ]
    : process.platform === 'linux'
      ? [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/snap/bin/chromium',
        ]
      : process.platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          ]
        : [];

  for (const candidate of [...envCandidates, ...platformCandidates]) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }

  return null;
};

const launchChromium = async ({ runtime } = {}) => {
  const isServerless = runtime === 'serverless'
    || Boolean(process.env.VERCEL)
    || Boolean(process.env.AWS_EXECUTION_ENV)
    || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

  if (!isServerless) {
    try {
      return await playwrightChromium.launch({ headless: true });
    } catch (error) {
      const fallbackExecutablePath = await resolveLocalChromiumExecutablePath();
      if (!fallbackExecutablePath) throw error;

      return playwrightChromium.launch({
        headless: true,
        executablePath: fallbackExecutablePath,
      });
    }
  }

  const chromiumLambda = await import('@sparticuz/chromium');
  const lambdaChromium = chromiumLambda.default || chromiumLambda;
  const executablePath = await lambdaChromium.executablePath();

  return playwrightChromium.launch({
    args: lambdaChromium.args,
    executablePath,
    headless: lambdaChromium.headless ?? true,
  });
};

export const renderPagesToPngBuffers = async ({
  article,
  options,
  runtime,
  templateId,
  extraCss,
}) => {
  const width = options?.width ?? 600;
  const ratio = options?.ratio ?? (4 / 3);
  const padding = options?.padding ?? 50;
  const dpr = options?.dpr ?? 3;
  const cardHeight = Math.round(width * ratio);

  const missingImages = [];
  const bodyHtml = await markdownToHtml(article.body, article.images, {
    baseDir: article.baseDir,
    missingImages,
  });
  const previewCss = await loadPreviewCss();
  const template = resolveTemplate(templateId);
  const combinedExtraCss = [template.css, extraCss].filter(Boolean).join('\n');
  const html = await buildHtmlDocument({
    enTitle: article.enTitle,
    title: article.title,
    metadata: article.metadata,
    bodyHtml,
    baseHref: article.baseHref,
    cardWidth: width,
    cardHeight,
    padding,
    previewCss,
    extraCss: combinedExtraCss,
  });

  const browser = await launchChromium({ runtime });
  try {
    const context = await browser.newContext({
      viewport: { width: width + padding * 2, height: cardHeight + padding * 2 },
      deviceScaleFactor: dpr,
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await waitForAssets(page);

    const { pageCount, pageWidth } = await computePages(page);
    const card = page.locator('#md2rn-card');
    const buffers = [];

    for (let index = 0; index < pageCount; index += 1) {
      await page.evaluate((x) => {
        const flow = document.getElementById('md2rn-flow');
        if (!flow) return;
        flow.style.left = `${-Math.round(x)}px`;
      }, index * pageWidth);

      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
      const buffer = await card.screenshot({ type: 'png' });
      buffers.push(buffer);
    }

    return { buffers, missingImages };
  } finally {
    await browser.close();
  }
};

export const pageFileName = (index) => `rednote-page-${String(index + 1).padStart(2, '0')}.png`;

export const zipPngBuffers = async (buffers) => {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  buffers.forEach((buffer, index) => {
    zip.file(pageFileName(index), buffer);
  });
  return zip.generateAsync({ type: 'nodebuffer' });
};

export const renderPagesToZipBuffer = async ({
  article,
  options,
  runtime,
  templateId,
  extraCss,
}) => {
  const { buffers, missingImages } = await renderPagesToPngBuffers({
    article,
    options,
    runtime,
    templateId,
    extraCss,
  });

  const zipBuffer = await zipPngBuffers(buffers);
  return { zipBuffer, pages: buffers.length, missingImages };
};

export const loadArticleFromMarkdownFile = async (markdownPath, overrides = {}) => {
  const markdown = await readFile(markdownPath, 'utf8');
  const extracted = extractLeadingH1(markdown);
  const baseDir = path.dirname(markdownPath);

  return {
    enTitle: overrides.enTitle ?? '',
    title: overrides.title ?? (extracted.title || ''),
    metadata: overrides.metadata ?? '',
    body: extracted.body,
    images: {},
    baseDir,
    baseHref: pathToFileURL(baseDir + path.sep).toString(),
  };
};
