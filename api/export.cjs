const crypto = require('node:crypto');

const readJsonBody = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 15_000_000) {
      reject(new Error('Request body too large.'));
      req.destroy();
    }
  });
  req.on('end', () => {
    if (!raw) {
      resolve({});
      return;
    }
    try {
      resolve(JSON.parse(raw));
    } catch {
      reject(new Error('Invalid JSON.'));
    }
  });
  req.on('error', reject);
});

const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

const getBearerToken = (req) => {
  const header = req.headers.authorization || '';
  const match = typeof header === 'string' ? header.match(/^Bearer\s+(.+)\s*$/i) : null;
  return match ? match[1] : null;
};

const pickString = (value, fallback = '') => (typeof value === 'string' ? value : fallback);

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  if (process.env.EXPORT_SECRET) {
    const token = getBearerToken(req);
    if (!token || token !== process.env.EXPORT_SECRET) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    sendJson(res, 500, { error: 'Missing BLOB_READ_WRITE_TOKEN on server.' });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : 'Invalid request body.' });
    return;
  }

  const articleInput = payload.article || payload;
  const templateId = pickString(payload.templateId || articleInput.templateId, 'default');

  const optionsInput = payload.options || {};
  const width = Number.isFinite(Number(optionsInput.width)) ? Number(optionsInput.width) : 600;
  const ratio = Number.isFinite(Number(optionsInput.ratio)) ? Number(optionsInput.ratio) : 4 / 3;
  const padding = Number.isFinite(Number(optionsInput.padding)) ? Number(optionsInput.padding) : 50;
  const dpr = Number.isFinite(Number(optionsInput.dpr)) ? Number(optionsInput.dpr) : 3;

  const rawMarkdown = pickString(articleInput.body, '');
  const rawTitle = pickString(articleInput.title, '');

  const [{ extractLeadingH1, pageFileName, renderPagesToPngBuffers, zipPngBuffers }, { TEMPLATES }] = await Promise.all([
    import('../exporter/render.mjs'),
    import('../templates.js'),
  ]);

  if (!Object.prototype.hasOwnProperty.call(TEMPLATES, templateId)) {
    sendJson(res, 400, { error: `Unknown template: ${templateId}` });
    return;
  }

  const extracted = extractLeadingH1(rawMarkdown);
  const normalizedTitle = rawTitle || extracted.title || '';

  const article = {
    enTitle: pickString(articleInput.enTitle, ''),
    title: normalizedTitle,
    metadata: pickString(articleInput.metadata, ''),
    body: extracted.body,
    images: typeof articleInput.images === 'object' && articleInput.images ? articleInput.images : {},
    baseHref: '',
    baseDir: '',
  };

  try {
    const { buffers, missingImages } = await renderPagesToPngBuffers({
      article,
      options: { width, ratio, padding, dpr },
      runtime: 'serverless',
      templateId,
    });

    const zipBuffer = await zipPngBuffers(buffers);

    const { put } = await import('@vercel/blob');

    const runId = crypto.randomUUID();
    const datePrefix = new Date().toISOString().slice(0, 10);
    const basePath = `md2rednote/${datePrefix}/${runId}`;

    const [zipResult, ...pageResults] = await Promise.all([
      put(`${basePath}/rednote-export.zip`, zipBuffer, {
        access: 'public',
        contentType: 'application/zip',
        token: blobToken,
      }),
      ...buffers.map((buffer, index) => put(`${basePath}/${pageFileName(index)}`, buffer, {
        access: 'public',
        contentType: 'image/png',
        token: blobToken,
      })),
    ]);

    sendJson(res, 200, {
      zipUrl: zipResult.url,
      pageUrls: pageResults.map((result) => result.url),
      pages: buffers.length,
      missingImages,
      templateId,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    sendJson(res, 500, { error: err instanceof Error ? err.message : 'Export failed.' });
  }
};
