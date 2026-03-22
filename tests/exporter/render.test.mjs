import test from 'node:test';
import assert from 'node:assert/strict';

import { markdownToHtml } from '../../exporter/render.mjs';

test('markdownToHtml adds stable classes to GFM tables', async () => {
  const markdown = [
    '| 文件 | 角色 | 谁动它 |',
    '|------|------|--------|',
    '| `prepare.py` | 数据准备 | 固定不变 |',
  ].join('\n');

  const html = await markdownToHtml(markdown, {});

  assert.match(html, /<table[^>]*class="md2rn-table"/);
  assert.match(html, /<thead[^>]*class="md2rn-table-head"/);
  assert.match(html, /<tbody[^>]*class="md2rn-table-body"/);
  assert.match(html, /<tr[^>]*class="md2rn-table-row"/);
  assert.match(html, /<th[^>]*class="md2rn-table-header-cell"[^>]*>文件<\/th>/);
  assert.match(html, /<td[^>]*class="md2rn-table-cell"[^>]*><code>prepare\.py<\/code><\/td>/);
});
