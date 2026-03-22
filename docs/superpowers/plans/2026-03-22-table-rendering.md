# Table Rendering Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Markdown tables as readable, card-width native tables in both export output and local preview.

**Architecture:** Keep GFM table semantics intact, inject stable `md2rn-*` classes onto table nodes, and style those classes for the 600px card layout. Cover the export-side HTML transformation with a focused regression test before changing renderer or CSS behavior.

**Tech Stack:** Node.js test runner, unified/remark/rehype pipeline, ReactMarkdown, Tailwind source CSS

---

## Chunk 1: Regression Coverage

### Task 1: Lock the export HTML contract

**Files:**
- Create: `tests/exporter/render.test.mjs`
- Test: `tests/exporter/render.test.mjs`

- [ ] **Step 1: Write the failing test**

Assert that `markdownToHtml()` converts a GFM table into HTML with stable `md2rn-*` classes on `table`, `thead`, `tbody`, `tr`, `th`, and `td`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/exporter/render.test.mjs`
Expected: FAIL because the current HTML does not include the new table classes.

## Chunk 2: Renderer And Preview

### Task 2: Add stable table classes

**Files:**
- Create: `markdownTableClasses.js`
- Modify: `exporter/render.mjs`
- Modify: `components/PreviewCard.tsx`
- Test: `tests/exporter/render.test.mjs`

- [ ] **Step 1: Add shared class name constants**

Define one shared source of truth for the table class names used by export and preview rendering.

- [ ] **Step 2: Inject classes in export HTML**

Add a rehype transform that annotates table-related nodes with the shared classes before stringification.

- [ ] **Step 3: Inject classes in React preview**

Extend the existing ReactMarkdown component map so preview tables emit the same classes.

- [ ] **Step 4: Run regression test**

Run: `node --test tests/exporter/render.test.mjs`
Expected: PASS

## Chunk 3: Card Table Styling And Verification

### Task 3: Style tables for the card layout

**Files:**
- Modify: `styles/tailwind.css`
- Modify: `index.css`

- [ ] **Step 1: Add table-specific card styles**

Style the new table classes with full width, readable padding, visible borders, wrapped cell content, and header emphasis. Keep tables intact with `break-inside: avoid`.

- [ ] **Step 2: Rebuild generated CSS**

Run: `npm run tw:build`
Expected: `index.css` is regenerated from `styles/tailwind.css`.

- [ ] **Step 3: Verify the app still builds**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Re-export the target article**

Run: `npm run cli -- export --in '/Users/wukeying/Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian vault/02_area/02_自媒体/20260321-卡帕西播客/20260321-卡帕西播客.md' --out './output/20260321-卡帕西播客-table-fix'`
Expected: PASS with refreshed PNG pages and ZIP output.
