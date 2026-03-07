#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { extractLeadingH1, pageFileName, renderPagesToPngBuffers, zipPngBuffers } from '../exporter/render.mjs';
import { TEMPLATES, listTemplates } from '../templates.js';

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
  --template <id>             Template id (default: default)
  --out <dir>                 Output directory (default: ./output)
  --width <px>                Card width in CSS px (default: 600)
  --ratio <h/w>               Page ratio as "4/3" or "1.333" (default: 4/3)
  --padding <px>              Inner padding in CSS px (default: 50)
  --dpr <number>              Device scale factor (default: 3)
  --zip                        Also write a .zip next to PNGs
  --no-zip                     Skip zip
  --help                       Show help

Templates:
${listTemplates().map((tpl) => `  - ${tpl.id}${tpl.id === 'default' ? ' (default)' : ''}`).join('\n')}

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
    templateId: 'default',
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
      case '--template':
        result.templateId = takeValue();
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

const exportPages = async ({ article, outDir, width, ratio, padding, dpr, zip, templateId }) => {
  assertNumberInRange(width, 'width', { min: 240, max: 2000 });
  assertNumberInRange(ratio, 'ratio', { min: 0.5, max: 3 });
  assertNumberInRange(padding, 'padding', { min: 0, max: 200 });
  assertNumberInRange(dpr, 'dpr', { min: 1, max: 6 });

  await mkdir(outDir, { recursive: true });

  try {
    const { buffers, missingImages } = await renderPagesToPngBuffers({
      article,
      options: { width, ratio, padding, dpr },
      templateId,
    });

    if (missingImages.length > 0) {
      const unique = Array.from(new Set(missingImages)).slice(0, 12);
      // eslint-disable-next-line no-console
      console.warn(`Warning: ${missingImages.length} image(s) could not be inlined. Examples:\n- ${unique.join('\n- ')}`);
    }

    const files = await Promise.all(buffers.map(async (buffer, index) => {
      const name = pageFileName(index);
      const filePath = path.join(outDir, name);
      await writeFile(filePath, buffer);
      return { name, buffer };
    }));

    let zipPath = null;
    if (zip) {
      const zipBuffer = await zipPngBuffers(buffers);
      zipPath = path.join(outDir, `rednote-export-${Date.now()}.zip`);
      await writeFile(zipPath, zipBuffer);
    }

    return { pages: files.length, zipPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Executable doesn\'t exist') || message.includes('executable') || message.includes('Chromium')) {
      throw new Error(`${message}\n\nChromium not found. Run: npx playwright install chromium`);
    }
    throw err;
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

  if (!Object.prototype.hasOwnProperty.call(TEMPLATES, opts.templateId)) {
    const available = listTemplates().map((tpl) => tpl.id).join(', ');
    throw new Error(`Unknown template: ${opts.templateId}. Available: ${available}`);
  }

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
    templateId: opts.templateId,
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
