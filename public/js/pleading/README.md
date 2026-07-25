# Pleading paper

Legal pleading layout for the notes editor. The active app uses a **custom contenteditable editor** (`public/js/pleading-editor/`) backed by these modules.

## Page setup (Letter, portrait)

| Setting | Value |
|---------|-------|
| Paper | 8.5" × 11" |
| Top margin | 0.57" |
| Bottom margin | 0.5" |
| Left margin | 0.5" |
| Right margin | 0.9" |
| Lines per page | 28 |
| Line spacing | 1.7 (via computed line height) |

## What is preserved

- `layout-spec.js` — page geometry, margins, line height
- `page-view.js` — editor/export page chrome (line numbers, double rules, footer)
- `document.js` — `PleadingEditorChrome` backdrop sync + export document
- `paginator.js` — content pagination for PDF export
- `stylesheet.js` — export CSS

## Active integration

- `public/js/pleading-editor/editor.js` — custom editor (no Quill)
- `public/js/pleading-editor/layout.js` — page counting for multi-page sync
- `public/js/notes.js` — save/load + formatting toolbar
- `public/css/notes.css` — pleading editor styles
