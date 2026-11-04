import { INTEREST_KEYWORDS } from './interest-keywords.mjs';

export function getAdminLoginPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Littlables admin sign in</title>
  <style>
    :root { color-scheme: dark; font: 16px/1.5 system-ui, -apple-system, sans-serif; background: #0b0f19; color: #f8fafc; }
    body { min-height: 100vh; display: grid; place-items: center; margin: 0; padding: 1rem; }
    main { max-width: 28rem; padding: 2rem; background: #1e293b; border: 1px solid #334155; border-radius: 12px; }
    a { display: inline-block; margin-top: 1rem; padding: .7rem 1rem; border-radius: 8px; color: white; background: #4f46e5; font-weight: 700; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <h1>lil dashboard</h1>
    <p>Sign in with the authorized GitHub account to manage stories and providers.</p>
    <a href="/admin/auth/login">Continue with GitHub</a>
  </main>
</body>
</html>`;
}

export function getAdminPage() {
  // Interest keyword options for the validation list picker (id/label/icon/group/excluded).
  const keywordOptionsJson = JSON.stringify(
    INTEREST_KEYWORDS.map((k) => ({ id: k.id, label: k.label, icon: k.icon, group: k.group, excluded: k.excluded === true }))
  );
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>lil dashboard</title>
  <style>
    :root {
      color-scheme: dark;
      font: 15px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0b0f19;
      color: #f8fafc;
      font-variant-numeric: tabular-nums;
    }
    *, *::before, *::after { box-sizing: border-box; }
    html.modal-open,
    body.modal-open,
    html:has(dialog[open]),
    body:has(dialog[open]) {
      overflow: hidden !important;
      overscroll-behavior: none;
    }
    body {
      max-width: 1120px;
      margin: 0 auto;
      padding: .25rem 1rem 3.5rem;
    }
    h1, h2, h3 { line-height: 1.25; margin: 0; }
    h1 { font-size: 1.4rem; }
    h2 { font-size: 1.05rem; }
    a { color: #a5b4fc; }
    .muted { color: #94a3b8; margin: 0; font-size: .86rem; }

    /* Top Toolbar */
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: .75rem;
      flex-wrap: wrap;
      padding-bottom: .35rem;
      margin-bottom: .35rem;
      border-bottom: 1px solid #1e293b;
    }
    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: .45rem;
      flex-wrap: wrap;
    }

    /* Sticky vitals status bar + section nav */
    .admin-sticky {
      position: sticky;
      top: 0;
      z-index: 40;
      background: rgba(2, 6, 23, 0.97);
      padding: .55rem 0 .6rem;
      margin-bottom: .75rem;
      border-bottom: 1px solid #1e293b;
    }
    .vitals-bar {
      display: flex;
      align-items: center;
      gap: .4rem;
      flex-wrap: wrap;
      margin-bottom: .5rem;
    }
    .vital {
      display: inline-flex;
      align-items: center;
      gap: .35rem;
      padding: .3rem .6rem;
      border-radius: 7px;
      background: #1e293b;
      border: 1px solid #334155;
      color: #e2e8f0;
      font-size: .78rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    .vital:hover { border-color: #4f46e5; background: #25324a; }
    .vital .vital-value { color: #a5b4fc; font-variant-numeric: tabular-nums; }
    .vital-ok .vital-value { color: #6ee7b7; }
    .vital-warn .vital-value { color: #fbbf24; }
    .vital-bad .vital-value { color: #f87171; }
    .toolbar-left {
      display: flex;
      align-items: center;
      gap: .6rem;
    }
    #menu-toggle { font-size: 1rem; padding: .35rem .6rem; }
    /* Compact vitals: plain text status, not buttons */
    .vitals-compact {
      gap: .2rem .9rem;
      margin-bottom: 0;
    }
    .vitals-compact .vital {
      background: none;
      border: none;
      padding: .1rem 0;
      font-size: .74rem;
      font-weight: 500;
      color: #94a3b8;
    }
    .vitals-compact .vital:hover { background: none; border: none; color: #e2e8f0; }
    .vitals-compact .vital .vital-value { font-weight: 700; }
    /* Hamburger section menu */
    .section-menu {
      position: absolute;
      top: 100%;
      left: 0;
      min-width: 250px;
      max-height: 70vh;
      overflow-y: auto;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 10px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
      padding: .35rem;
      margin: 0;
      list-style: none;
      z-index: 60;
    }
    .menu-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: .5rem;
      border-radius: 7px;
    }
    .menu-row:hover { background: #1e293b; }
    .section-menu .menu-link {
      flex: 1;
      background: none;
      border: none;
      color: #e2e8f0;
      font-size: .84rem;
      font-weight: 500;
      text-align: left;
      padding: .5rem .6rem;
      cursor: pointer;
      white-space: nowrap;
    }
    .section-menu .menu-link:hover { background: none; border: none; color: #a5b4fc; }
    .section-menu .menu-link .muted { font-size: .76rem; }
    .menu-movers { display: flex; gap: .25rem; padding-right: .35rem; }
    /* Keep jumped-to sections clear of the sticky header. */
    section[data-section-id] { scroll-margin-top: 130px; }

    /* Buttons */
    button {
      border: 1px solid transparent;
      border-radius: 8px;
      padding: .45rem .75rem;
      font: inherit;
      font-size: .84rem;
      font-weight: 600;
      color: #ffffff;
      background: #4f46e5;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
    }
    button:hover:not(:disabled) { background: #4338ca; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    button.secondary { background: #334155; border-color: #475569; color: #f1f5f9; }
    button.secondary:hover:not(:disabled) { background: #475569; }
    button.small-btn { padding: .32rem .6rem; font-size: .78rem; border-radius: 6px; }
    button.icon-btn {
      padding: .28rem .5rem;
      font-size: .78rem;
      line-height: 1;
      background: #0f172a;
      border: 1px solid #334155;
      color: #cbd5e1;
      border-radius: 6px;
    }
    button.icon-btn:hover:not(:disabled) {
      background: #1e293b;
      border-color: #6366f1;
      color: #ffffff;
    }

    /* Collapsible & Reorderable Sections */
    #admin-sections {
      display: flex;
      flex-direction: column;
      gap: .85rem;
    }
    .admin-card-section, .summary {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: .85rem 1rem;
      margin: 0;
      transition: border-color 0.15s ease;
    }
    .admin-card-section.dragging {
      opacity: .6;
      border-color: #818cf8;
    }
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: .5rem;
      flex-wrap: nowrap;
    }
    .section-header h2 {
      flex: 1;
      min-width: 0;
    }
    .section-toggle {
      display: inline-flex;
      align-items: center;
      gap: .45rem;
      width: 100%;
      padding: .15rem 0;
      background: transparent;
      border: 0;
      color: #f8fafc;
      font-size: 1rem;
      font-weight: 700;
      text-align: left;
      white-space: normal;
    }
    .section-toggle:hover:not(:disabled) { background: transparent; color: #c7d2fe; }
    .section-arrow {
      display: inline-block;
      width: 1.1rem;
      text-align: center;
      font-size: .78rem;
      color: #94a3b8;
      flex-shrink: 0;
    }
    .section-controls {
      display: inline-flex;
      align-items: center;
      gap: .35rem;
      flex-shrink: 0;
    }
    .section-body {
      margin-top: .85rem;
      padding-top: .85rem;
      border-top: 1px solid rgba(255, 255, 255, 0.07);
    }
    .section-body[hidden],
    #stories[hidden],
    #banned-stories[hidden],
    #providers[hidden],
    #ads-section[hidden] {
      display: none !important;
    }

    /* Providers Grid */
    .providers {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: .85rem;
    }
    .provider {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: .85rem;
    }
    .provider-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: .5rem;
      margin-bottom: .35rem;
    }
    .provider h2 { font-size: .98rem; }
    .provider p { margin: .3rem 0; font-size: .82rem; color: #cbd5e1; }
    .provider-setup.configured { color: #86efac; }
    .provider-setup.missing { color: #fcd34d; }

    /* Filters & Inputs */
    .awin-panel {
      border: 1px solid #334155;
      border-radius: .6rem;
      padding: .7rem .9rem;
      margin-bottom: .8rem;
      background: #1e293b;
    }
    .awin-panel-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: .8rem;
      flex-wrap: wrap;
    }
    .awin-log {
      margin-top: .6rem;
      font-size: .8rem;
      line-height: 1.5;
      max-height: 12rem;
      overflow-y: auto;
      white-space: pre-wrap;
    }
    .awin-log .ok { color: #15803d; }
    .awin-log .warn { color: #b45309; }
    .awin-log .err { color: #dc2626; }
    .filter-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: .65rem;
      flex-wrap: wrap;
      margin-bottom: .75rem;
    }
    .provider-toolbar {
      display: inline-flex;
      align-items: center;
      gap: .45rem;
      font-size: .82rem;
      color: #cbd5e1;
      flex-wrap: wrap;
    }
    .provider-filter, .page-size-select {
      padding: .35rem .6rem;
      border: 1px solid #475569;
      border-radius: 6px;
      background: #0f172a;
      color: #f8fafc;
      font: inherit;
      font-size: .82rem;
    }
    .custom-input {
      width: 100%;
      padding: .6rem .85rem;
      border: 1px solid #475569;
      border-radius: 8px;
      background: #0f172a;
      color: #f8fafc;
      font: inherit;
      font-size: .9rem;
    }
    .custom-input:focus {
      border-color: #818cf8;
      outline: none;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25);
    }

    /* Category Filter Tabs */
    .category-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: .35rem;
      margin: .5rem 0 .75rem;
    }
    .category-tab {
      padding: .32rem .6rem;
      font-size: .78rem;
      background: #0f172a;
      border: 1px solid #334155;
      color: #cbd5e1;
      border-radius: 6px;
    }
    .category-tab[aria-pressed="true"] {
      background: #4f46e5;
      border-color: #6366f1;
      color: #ffffff;
    }

    /* Story & Ad List Rows */
    #stories, #pending-stories, #banned-stories, #ads-list, #story-search-results {
      display: grid;
      gap: .6rem;
    }
    @keyframes adminImageShimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    .story, .ad-row {
      display: grid;
      align-items: center;
      gap: .75rem;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 10px;
    }
    .story { grid-template-columns: 80px minmax(0, 1fr) auto; }
    .story.story-no-thumb { grid-template-columns: minmax(0, 1fr) auto; }
    .story.ai-pick-row { grid-template-columns: auto 80px minmax(0, 1fr) auto; }
    .ad-row { grid-template-columns: auto 80px minmax(0, 1fr) auto; }
    .ad-select {
      width: 18px;
      height: 18px;
      accent-color: #4f46e5;
      cursor: pointer;
      margin: 0;
    }
      padding: .65rem .75rem;
      cursor: pointer;
      transition: border-color 0.15s ease, background-color 0.15s ease;
    }
    .story:hover, .ad-row:hover {
      border-color: #6366f1;
      background-color: #162033;
    }
    .story:focus-visible, .ad-row:focus-visible {
      outline: 2px solid #a5b4fc;
      outline-offset: 2px;
    }
    .story-main, .story-details, .ad-main, .ad-details { min-width: 0; }
    .story img, .ad-row img {
      width: 80px;
      height: auto;
      aspect-ratio: 16 / 9;
      object-fit: cover;
      border-radius: 6px;
      background: linear-gradient(110deg, #1e293b 25%, #334155 50%, #1e293b 75%);
      background-size: 200% 100%;
      animation: adminImageShimmer 1.6s ease-in-out infinite;
      display: block;
      transition: opacity 0.25s ease;
    }
    .story img.is-loaded, .ad-row img.is-loaded {
      animation: none;
      background: #1e293b;
    }
    .story h3, .ad-row h3 {
      font-size: .92rem;
      font-weight: 600;
      margin: 0 0 .25rem;
      overflow-wrap: anywhere;
    }
    .story h3 a { text-decoration: none; color: #f8fafc; }
    .story h3 a:hover { color: #a5b4fc; }
    .story-meta, .ad-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: .35rem .5rem;
      margin: 0;
    }
    .story-meta span, .ad-meta span { font-size: .75rem; font-weight: 600; }
    .meta-provider { color: #c4b5fd; }
    .meta-domain { color: #fcd34d; }
    .meta-category { color: #7dd3fc; }
    .meta-date { color: #86efac; }
    .meta-network { color: #fbbf24; }
    .meta-badge-status {
      padding: 0.05rem 0.35rem;
      border-radius: 4px;
      font-size: 0.7rem;
      text-transform: uppercase;
      font-weight: 700;
    }
    .meta-approved { background: rgba(16, 185, 129, 0.2); color: #86efac; }
    .meta-pending { background: rgba(245, 158, 11, 0.2); color: #fcd34d; }
    .meta-banned { background: rgba(239, 68, 68, 0.2); color: #fca5a5; }
    .decision-note { margin: .25rem 0 0; color: #94a3b8; font-size: .76rem; }
    .story-actions, .ad-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: .35rem;
    }

    /* Pagination Bar */
    .pagination-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: .6rem;
      flex-wrap: wrap;
      margin-top: .75rem;
      padding-top: .65rem;
      border-top: 1px solid rgba(255, 255, 255, 0.07);
      font-size: .8rem;
      color: #cbd5e1;
    }
    .pagination-bar[hidden] { display: none !important; }
    .pagination-info {
      display: flex;
      align-items: center;
      gap: .5rem;
      flex-wrap: wrap;
    }
    .pagination-controls {
      display: inline-flex;
      align-items: center;
      gap: .35rem;
    }
    .pagination-page-label {
      padding: 0 .35rem;
      font-weight: 600;
      color: #f8fafc;
    }

    /* Preview Modal Dialog - Fixed Top Cut-off & Scroll Lock */
    .preview-dialog {
      width: min(94vw, 480px);
      max-height: calc(100dvh - 1.5rem);
      margin: auto;
      overflow-y: auto;
      overflow-x: hidden;
      overscroll-behavior: contain;
      color: #f8fafc;
      background: #0b0f19;
      border: 1px solid #475569;
      border-radius: 16px;
      padding: 1.1rem;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.8);
    }
    .preview-dialog::backdrop {
      background: rgb(2 6 23 / 82%);
      backdrop-filter: blur(4px);
    }

    /* Homepage Card Replica: .news-card */
    .news-card {
      overflow: hidden;
      display: flex;
      flex-direction: column;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 14px;
      box-shadow: 0 4px 15px rgb(0 0 0 / 25%);
      margin-bottom: .85rem;
    }
    .news-card-image-wrap {
      position: relative;
      width: 100%;
      height: auto;
      aspect-ratio: 16 / 9;
      overflow: hidden;
      background: linear-gradient(110deg, #1e293b 25%, #334155 50%, #1e293b 75%);
      background-size: 200% 100%;
      animation: adminImageShimmer 1.6s ease-in-out infinite;
    }
    .news-card-image-wrap.is-loaded {
      animation: none;
      background: #1e293b;
    }
    .news-card-image {
      display: block;
      width: 100%;
      height: 100%;
      aspect-ratio: 16 / 9;
      object-fit: cover;
      opacity: 0;
      transition: opacity 0.28s ease;
    }
    .news-card-image-wrap.is-loaded .news-card-image,
    .news-card-image.is-loaded {
      opacity: 1;
    }
    .news-card-badge {
      position: absolute;
      top: .75rem;
      left: .75rem;
      padding: .25rem .6rem;
      border-radius: 6px;
      background: #4f46e5;
      color: white;
      font-size: .7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .5px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }
    .news-card-content {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: .7rem;
      padding: 1.1rem;
    }
    .news-card-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: .5rem;
      color: #cbd5e1;
      font-size: .75rem;
      flex-wrap: wrap;
    }
    .news-card-title {
      color: #f8fafc;
      font-size: 1.05rem;
      font-weight: 700;
      line-height: 1.35;
      overflow-wrap: anywhere;
      text-decoration: none;
    }
    .news-card-title:hover { color: #a5b4fc; text-decoration: none; }
    .news-card-desc {
      flex: 1;
      color: #cbd5e1;
      font-size: .85rem;
      line-height: 1.5;
      margin: 0;
    }

    /* AI Summary Callout matching homepage */
    .news-card-ai-summary {
      padding: .65rem .85rem;
      border-left: 3px solid #818cf8;
      border-radius: 0 8px 8px 0;
      background: #172554;
      color: #e0e7ff;
      font-size: .8rem;
      line-height: 1.45;
    }
    .news-card-ai-label {
      margin-bottom: .25rem;
      color: #c7d2fe;
      font-size: .68rem;
      font-weight: 800;
      text-transform: uppercase;
      display: flex;
      align-items: center;
      gap: .35rem;
    }
    .ai-summary-text { color: #e0e7ff; overflow-wrap: anywhere; }
    .preview-ai-actions {
      display: flex;
      align-items: center;
      gap: .45rem;
      flex-wrap: wrap;
    }
    .summary-generate {
      padding: .4rem .7rem;
      background: #3730a3;
      font-size: .8rem;
      border-radius: 6px;
      align-self: flex-start;
    }
    .summary-generate:hover:not(:disabled) { background: #4338ca; }
    .image-generate {
      background: #0f766e;
    }
    .image-generate:hover:not(:disabled) {
      background: #0d9488;
    }
    .preview-image-loading {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      background: rgba(11, 15, 25, 0.72);
      color: #f8fafc;
      font-size: .82rem;
      font-weight: 700;
      z-index: 5;
      text-align: center;
      padding: 1rem;
    }
    .preview-status-msg {
      margin: .65rem 0 0;
      font-size: .8rem;
    }

    /* Card Footer matching homepage */
    .news-card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: .5rem;
      flex-wrap: wrap;
      margin-top: auto;
      padding-top: .65rem;
      border-top: 1px solid rgb(255 255 255 / 8%);
    }
    .news-read-more-btn {
      display: inline-flex;
      align-items: center;
      gap: .35rem;
      font-size: .82rem;
      font-weight: 600;
      color: #a5b4fc;
      text-decoration: none;
    }
    .news-read-more-btn:hover { color: #c7d2fe; }
    .news-card-reactions { display: flex; align-items: center; gap: .3rem; }
    .reaction-pill {
      display: inline-flex;
      align-items: center;
      gap: .2rem;
      padding: .2rem .45rem;
      border-radius: 9999px;
      font-size: .72rem;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #cbd5e1;
      cursor: default;
    }

    /* In-Feed Native Ad Card Replica */
    .news-card-ad {
      border: 1px dashed rgba(245, 158, 11, 0.5);
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.98) 100%);
      position: relative;
    }
    .ad-badge {
      background: #f59e0b !important;
      color: #0b1120 !important;
      font-weight: 800 !important;
      letter-spacing: 0.6px !important;
    }
    .ad-sponsor-label {
      font-size: 0.68rem;
      text-transform: uppercase;
      font-weight: 800;
      color: #f59e0b;
      letter-spacing: 0.8px;
    }
    .ad-network-label { color: #f59e0b; font-size: 0.7rem; font-weight: bold; }
    .ad-card-title { color: #f8fafc; font-size: 1.02rem; }
    .ad-card-description { font-size: 0.84rem; color: #cbd5e1; line-height: 1.5; }
    .ad-cta-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.82rem;
      font-weight: 700;
      color: #fbbf24;
      text-decoration: none;
      background: rgba(245, 158, 11, 0.15);
      border: 1px solid rgba(245, 158, 11, 0.35);
      padding: 0.3rem 0.65rem;
      border-radius: 6px;
      width: fit-content;
    }

    /* Inline Field Editor */
    .preview-editable {
      display: inline-flex;
      align-items: flex-start;
      gap: .35rem;
      min-width: 0;
      width: 100%;
      position: relative;
    }
    .preview-editable.is-editing {
      display: block !important;
      width: 100% !important;
      margin: 0.3rem 0;
    }
    .preview-edit {
      flex: 0 0 auto;
      padding: .15rem .35rem;
      background: rgba(15, 23, 42, 0.75);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 4px;
      font-size: .78rem;
      line-height: 1;
      cursor: pointer;
      color: #cbd5e1;
    }
    .preview-edit:hover { background: #4f46e5; color: white; }
    .preview-value { min-width: 0; overflow-wrap: anywhere; flex: 1; }
    .preview-inline-editor {
      display: flex;
      flex-direction: column;
      width: 100%;
      gap: .4rem;
      margin-top: .15rem;
      background: rgba(15, 23, 42, 0.92);
      padding: .45rem;
      border-radius: 8px;
      border: 1px solid #475569;
    }
    .preview-inline-editor input,
    .preview-inline-editor textarea,
    .preview-inline-editor select {
      width: 100%;
      min-width: 0;
      padding: .55rem .7rem;
      border: 1px solid #6366f1;
      border-radius: 6px;
      background: #0b0f19;
      color: #f8fafc;
      font: inherit;
      font-size: .9rem;
      line-height: 1.4;
      outline: none;
    }
    .preview-inline-editor textarea { min-height: 5.5rem; resize: vertical; }
    .editor-btn-row { display: flex; gap: .4rem; justify-content: flex-end; }
    .editor-btn-row button { padding: .3rem .65rem; font-size: .78rem; }

    .preview-image-edit { position: absolute; top: .6rem; right: .6rem; z-index: 10; width: auto !important; }
    .preview-image-edit.is-editing { left: .6rem; right: .6rem; width: calc(100% - 1.2rem) !important; }
    .preview-category-edit { position: absolute; top: .6rem; left: .6rem; z-index: 10; width: auto !important; }
    .preview-category-edit.is-editing { right: .6rem; width: calc(100% - 1.2rem) !important; }
    .preview-category-edit .news-card-badge { position: static; }
    .preview-actions {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: .5rem;
      flex-wrap: wrap;
      padding-top: .85rem;
      border-top: 1px solid #334155;
      margin-top: .85rem;
    }
    .preview-context {
      color: #cbd5e1;
      font-size: .82rem;
      margin-top: .75rem;
      background: #1e293b;
      border: 1px solid #334155;
      padding: .7rem;
      border-radius: 8px;
    }

    .status { font-weight: 700; text-transform: capitalize; }
    .status-succeeded { color: #86efac; }
    .status-partial { color: #fcd34d; }
    .status-rate_limited { color: #fbbf24; }
    .status-skipped_cooldown { color: #fbbf24; }
    .status-failed { color: #fca5a5; }
    .status-running { color: #7dd3fc; }
    .status-never { color: #cbd5e1; }
    .error { color: #fca5a5 !important; }
    .success { color: #86efac !important; }
    .tabular-nums { font-variant-numeric: tabular-nums; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }

    /* Auto-Sync Control Bar & Provider Cooldown Banner */
    .auto-sync-bar {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: .75rem;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: .75rem .9rem;
      margin-bottom: .25rem;
    }
    .auto-sync-info {
      display: flex;
      flex-direction: column;
      gap: .2rem;
    }
    .auto-sync-title {
      font-size: .88rem;
      font-weight: 700;
      color: #f8fafc;
      display: flex;
      align-items: center;
      gap: .5rem;
      flex-wrap: wrap;
    }
    .auto-sync-meta {
      font-size: .76rem;
      color: #94a3b8;
    }
    .auto-sync-actions {
      display: flex;
      align-items: center;
      gap: .45rem;
      flex-wrap: wrap;
    }
    .cooldown-callout {
      margin-top: .45rem;
      padding: .5rem .65rem;
      background: rgba(217, 119, 6, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.4);
      border-radius: 8px;
      color: #fde68a;
      font-size: .76rem;
      line-height: 1.4;
    }
    .provider-error-box {
      margin-top: .45rem;
      padding: .5rem .65rem;
      background: rgba(248, 113, 113, 0.08);
      border: 1px solid rgba(248, 113, 113, 0.35);
      border-radius: 8px;
      font-size: .76rem;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    .provider-error-title {
      font-weight: 600;
      color: #fca5a5;
      margin-bottom: .2rem;
    }
    .provider-error-row { margin-top: .1rem; }
    .provider-error-key { font-weight: 600; }

    /* Provider Fetch & Rate-Limit Log Viewer */
    .log-summary-strip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: .6rem;
      margin-bottom: .75rem;
    }
    .log-stat-box {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: .55rem .7rem;
    }
    .log-stat-label {
      font-size: .72rem;
      color: #94a3b8;
      margin: 0 0 .15rem;
    }
    .log-stat-value {
      font-size: 1.05rem;
      font-weight: 700;
      color: #f8fafc;
      margin: 0;
    }
    .log-list {
      display: grid;
      gap: .45rem;
    }
    .log-row {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: .55rem .75rem;
      cursor: pointer;
      transition: border-color 0.15s ease, background-color 0.15s ease;
    }
    .log-row:hover {
      border-color: #6366f1;
      background: #162033;
    }
    .log-row-main {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: .65rem;
      flex-wrap: wrap;
      font-size: .8rem;
    }
    .log-row-left {
      display: flex;
      align-items: center;
      gap: .45rem;
      flex-wrap: wrap;
      min-width: 0;
    }
    .log-row-right {
      display: flex;
      align-items: center;
      gap: .5rem;
      flex-wrap: wrap;
      font-size: .75rem;
      color: #cbd5e1;
    }
    .log-error-line {
      margin: .3rem 0 0;
      font-size: .76rem;
      color: #fca5a5;
      overflow-wrap: anywhere;
    }
    .log-drawer {
      margin-top: .5rem;
      padding-top: .5rem;
      border-top: 1px solid #334155;
      font-size: .75rem;
      color: #cbd5e1;
      display: grid;
      gap: .25rem;
      overflow-wrap: anywhere;
    }

    /* AI Daily Story Curation & Staging Queue */
    #ai-staged-stories {
      display: grid;
      gap: .6rem;
    }
    .ai-curation-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: .75rem;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: .75rem .9rem;
      margin-bottom: .65rem;
    }
    .ai-curation-info {
      display: flex;
      flex-direction: column;
      gap: .22rem;
      min-width: 240px;
      flex: 1;
    }
    .ai-curation-title {
      font-size: .9rem;
      font-weight: 700;
      color: #f8fafc;
      display: flex;
      align-items: center;
      gap: .5rem;
      flex-wrap: wrap;
    }
    .ai-curation-meta {
      font-size: .76rem;
      color: #94a3b8;
      line-height: 1.4;
    }
    .ai-curation-actions {
      display: flex;
      align-items: center;
      gap: .45rem;
      flex-wrap: wrap;
    }
    .ai-taste-drawer {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: .85rem .95rem;
      margin-bottom: .75rem;
      display: grid;
      gap: .75rem;
    }
    .ai-taste-drawer[hidden] { display: none !important; }
    .ai-signal-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: .55rem;
    }
    .ai-signal-box {
      background: #131b2e;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: .55rem .7rem;
      font-size: .76rem;
      color: #cbd5e1;
      line-height: 1.4;
    }
    .ai-signal-box strong {
      display: block;
      font-size: .72rem;
      color: #94a3b8;
      margin-bottom: .2rem;
      font-weight: 600;
    }
    .ai-taste-field {
      display: flex;
      flex-direction: column;
      gap: .3rem;
      font-size: .8rem;
      color: #cbd5e1;
    }
    .ai-taste-field label {
      font-weight: 600;
      color: #f8fafc;
    }
    .ai-taste-field textarea,
    .ai-taste-field input {
      width: 100%;
      padding: .55rem .7rem;
      border: 1px solid #334155;
      border-radius: 8px;
      background: #0b0f19;
      color: #f8fafc;
      font: inherit;
      font-size: .84rem;
      line-height: 1.45;
    }
    .ai-taste-field textarea:focus,
    .ai-taste-field input:focus {
      outline: none;
      border-color: #6366f1;
    }
    .ai-taste-two-col {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: .65rem;
    }
    .ai-bulk-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: .55rem;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: .5rem .75rem;
      margin-bottom: .65rem;
      font-size: .8rem;
    }
    .ai-bulk-left, .ai-bulk-right {
      display: flex;
      align-items: center;
      gap: .45rem;
      flex-wrap: wrap;
    }
    .story.ai-pick-row {
      grid-template-columns: auto 80px minmax(0, 1fr) auto;
    }
    .ai-pick-checkbox {
      width: 18px;
      height: 18px;
      accent-color: #4f46e5;
      cursor: pointer;
      margin: 0;
    }
    .ai-pick-reason {
      margin: .28rem 0 0;
      font-size: .77rem;
      color: #a5b4fc;
      line-height: 1.4;
    }
    .meta-slot { color: #38bdf8; }
    .meta-rank { color: #f472b6; font-variant-numeric: tabular-nums; }
    .btn-approve-accent { background: #059669; }
    .btn-approve-accent:hover:not(:disabled) { background: #047857; }
    .btn-danger-outline {
      background: rgba(239, 68, 68, 0.14);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #fca5a5;
    }
    .btn-danger-outline:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.26);
    }

    @media (max-width: 640px) {
      body { padding: .25rem .65rem 2.5rem; }
      h1 { font-size: 1.2rem; }
      .admin-card-section, .summary { padding: .7rem .75rem; }
      .story, .ad-row {
        grid-template-columns: 64px minmax(0, 1fr);
        gap: .55rem;
        padding: .55rem;
      }
      .story.ai-pick-row, .ad-row {
        grid-template-columns: auto 64px minmax(0, 1fr);
      }
      .story img, .ad-row img { width: 64px; height: auto; aspect-ratio: 16 / 9; }
      .story-actions, .ad-actions {
        grid-column: 1 / -1;
        justify-content: flex-start;
        padding-top: .25rem;
        border-top: 1px solid rgba(255,255,255,0.05);
      }
      .preview-dialog {
        width: 96vw;
        max-height: calc(100dvh - 1rem);
        padding: .85rem;
      }
    }
  </style>
</head>
<body>
  <div class="admin-sticky">
    <header class="toolbar">
      <div class="toolbar-left">
        <button id="menu-toggle" class="icon-btn" type="button" aria-expanded="false" aria-controls="section-menu" title="Sections menu">☰</button>
        <div>
          <h1>lil dashboard</h1>
          <p id="identity" class="muted">Verifying GitHub session…</p>
        </div>
      </div>
      <div class="toolbar-actions">
        <button id="refresh" class="small-btn" type="button">Refresh</button>
        <button id="logout" class="secondary small-btn" type="button">Sign out</button>
      </div>
    </header>
    <div id="vitals-bar" class="vitals-bar vitals-compact" aria-label="Site vitals" aria-live="polite"></div>
    <nav id="section-menu" class="section-menu" aria-label="Admin sections" hidden></nav>
  </div>

  <main id="admin-sections">
    <!-- 1. DATABASE SUMMARY SECTION -->
    <section class="summary admin-card-section" data-section-id="summary" aria-live="polite">
      <div class="section-header">
        <h2 id="summary-title">
          <button id="summary-toggle" class="section-toggle" type="button" aria-expanded="true" aria-controls="summary-body" data-section-toggle="summary">
            <span id="summary-arrow" class="section-arrow" aria-hidden="true">▲</span>
            <span>Saved story records: <span id="total">—</span></span>
          </button>
        </h2>
        <div class="section-controls">
          <button type="button" class="icon-btn move-up-btn" aria-label="Move section up" title="Move up">↑</button>
          <button type="button" class="icon-btn move-down-btn" aria-label="Move section down" title="Move down">↓</button>
        </div>
      </div>
      <div id="summary-body" class="section-body">
        <p id="message" class="muted">Loading database status…</p>
      </div>
    </section>

    <!-- 1B. AI CURATED STAGING QUEUE SECTION (5 Stories/Category · 3x/Day) -->
    <section aria-labelledby="ai-staging-title" class="admin-card-section" data-section-id="ai-staging">
      <div class="section-header">
        <h2 id="ai-staging-title">
          <button id="ai-staging-toggle" class="section-toggle" type="button" aria-expanded="true" aria-controls="ai-staging-body" data-section-toggle="ai-staging">
            <span id="ai-staging-arrow" class="section-arrow" aria-hidden="true">▲</span>
            <span>Discovery <span id="ai-staging-count" class="tabular-nums"></span></span>
          </button>
        </h2>
        <div class="section-controls">
          <button id="toggle-taste-drawer-btn" type="button" class="secondary small-btn" aria-expanded="false" aria-controls="ai-taste-drawer">Taste Profile &amp; Schedule</button>
          <button type="button" class="icon-btn move-up-btn" aria-label="Move section up" title="Move up">↑</button>
          <button type="button" class="icon-btn move-down-btn" aria-label="Move section down" title="Move down">↓</button>
        </div>
      </div>
      <div id="ai-staging-body" class="section-body">
        <div id="ai-curation-bar" class="ai-curation-bar"></div>
        <div id="ai-taste-drawer" class="ai-taste-drawer" hidden></div>
        <div class="filter-bar" style="justify-content: space-between;">
          <nav id="ai-edition-tabs" class="category-tabs" aria-label="Filter AI picks by daily edition" style="margin: 0;"></nav>
        </div>
        <nav id="ai-staging-categories" class="category-tabs" aria-label="Filter AI staged stories by category"></nav>
        <div id="ai-bulk-bar" class="ai-bulk-bar"></div>
        <div id="ai-staged-stories" aria-live="polite"></div>
        <div id="ai-staging-pagination" class="pagination-bar"></div>
      </div>
    </section>

    <!-- 1b. EMBEDDING VALIDATION SECTION -->
    <section aria-labelledby="embedding-validation-title" class="admin-card-section" data-section-id="embedding-validation">
      <div class="section-header">
        <h2 id="embedding-validation-title">
          <button id="embedding-validation-toggle" class="section-toggle" type="button" aria-expanded="true" aria-controls="embedding-validation-body" data-section-toggle="embedding-validation">
            <span id="embedding-validation-arrow" class="section-arrow" aria-hidden="true">▲</span>
            <span>Classify <span id="embedding-validation-count"></span></span>
          </button>
        </h2>
      </div>
      <div id="embedding-validation-body" class="section-body">
        <p class="admin-hint">Validates story categories using semantic embeddings. Flags stories where the AI-predicted category disagrees with the query-assigned category.</p>
        <p id="validate-unclassified-count" class="admin-hint" style="margin: 0.75rem 0 0;"></p>
        <div style="display: flex; gap: 0.75rem; align-items: center; margin: 1rem 0; flex-wrap: wrap;">
          <label for="validate-category-filter" class="admin-hint" style="margin: 0;">Old category:</label>
          <select id="validate-category-filter" style="padding: 0.5rem; border-radius: 0.4rem; border: 1px solid var(--news-border, #334155); background: var(--news-card-bg, #1e293b); color: var(--news-text, #f1f5f9);">
            <option value="">All categories</option>
            <option value="childcare">Childcare &amp; Family</option>
            <option value="animals">Animals &amp; Nature</option>
            <option value="arts">Creative Arts</option>
            <option value="tech">Future Tech &amp; AI</option>
            <option value="world">Global Currents</option>
            <option value="uplifting">Uplifting News</option>
            <option value="all">All</option>
          </select>
          <label for="validate-categories-limit" class="admin-hint" style="margin: 0;">Stories to validate:</label>
          <input id="validate-categories-limit" type="number" min="1" max="2000" value="200" style="width: 5rem; padding: 0.5rem; border-radius: 0.4rem; border: 1px solid var(--news-border, #334155); background: var(--news-card-bg, #1e293b); color: var(--news-text, #f1f5f9);" />
          <label for="validate-sort-order" class="admin-hint" style="margin: 0;">Sort:</label>
          <select id="validate-sort-order" style="padding: 0.5rem; border-radius: 0.4rem; border: 1px solid var(--news-border, #334155); background: var(--news-card-bg, #1e293b); color: var(--news-text, #f1f5f9);">
            <option value="matched">Matched first</option>
            <option value="unmatched">Unmatched first</option>
          </select>
          <button id="validate-categories-btn" class="sign-in-button primary-button" type="button" style="width: auto; padding: 0.6rem 1.2rem;">
            Validate Categories
          </button>
          <span id="validate-categories-status" class="admin-hint"></span>
        </div>
        <div id="validate-categories-results" aria-live="polite"></div>
      </div>
    </section>

    <!-- 2. PENDING STORIES SECTION -->
    <section aria-labelledby="pending-title" class="admin-card-section" data-section-id="pending">
      <div class="section-header">
        <h2 id="pending-title">
          <button id="pending-toggle" class="section-toggle" type="button" aria-expanded="true" aria-controls="pending-body" data-section-toggle="pending">
            <span id="pending-arrow" class="section-arrow" aria-hidden="true">▲</span>
            <span>Pending Approval <span id="pending-count"></span></span>
          </button>
        </h2>
        <div class="section-controls">
          <button type="button" class="icon-btn move-up-btn" aria-label="Move section up" title="Move up">↑</button>
          <button type="button" class="icon-btn move-down-btn" aria-label="Move section down" title="Move down">↓</button>
        </div>
      </div>
      <div id="pending-body" class="section-body">
        <nav id="approval-categories" class="category-tabs" aria-label="Filter pending stories by category"></nav>
        <div class="filter-bar">
          <label class="provider-toolbar" for="approval-provider">
            Provider
            <select id="approval-provider" class="provider-filter">
              <option value="all">All providers</option>
            </select>
          </label>
          <button type="button" id="stage-halloween-btn" class="secondary small-btn" title="Stage the one-time kid-safe Halloween batch into Pending Approval">🎃 Stage Halloween batch</button>
          <span id="stage-halloween-status" class="muted" aria-live="polite"></span>
        </div>
        <div id="pending-stories" aria-live="polite"></div>
        <div id="pending-pagination" class="pagination-bar"></div>
      </div>
    </section>

    <!-- 3. SEARCH STORIES SECTION -->
    <section class="admin-card-section" data-section-id="search" aria-labelledby="search-stories-title">
      <div class="section-header">
        <h2 id="search-stories-title">
          <button id="search-toggle" class="section-toggle" type="button" aria-expanded="true" aria-controls="search-body" data-section-toggle="search">
            <span id="search-arrow" class="section-arrow" aria-hidden="true">▲</span>
            <span>Search Stories</span>
          </button>
        </h2>
        <div class="section-controls">
          <button id="clear-story-search" class="secondary small-btn" type="button" style="display: none;">Clear</button>
          <button type="button" class="icon-btn move-up-btn" aria-label="Move section up" title="Move up">↑</button>
          <button type="button" class="icon-btn move-down-btn" aria-label="Move section down" title="Move down">↓</button>
        </div>
      </div>
      <div id="search-body" class="section-body">
        <input id="story-search-input" class="custom-input" type="search" placeholder="Search stories by title, description, domain, provider, category..." aria-label="Search stories">
        <p id="story-search-count" class="muted" style="margin: .5rem 0; display: none;"></p>
        <div id="story-search-results" style="margin-top: .5rem;"></div>
        <div id="search-pagination" class="pagination-bar" hidden></div>
      </div>
    </section>

    <!-- 4. SPONSOR & AFFILIATE ADS SECTION -->
    <section class="admin-card-section" data-section-id="ads" aria-labelledby="ads-title">
      <div class="section-header">
        <h2 id="ads-title">
          <button id="ads-toggle" class="section-toggle" type="button" aria-expanded="true" aria-controls="ads-section" data-section-toggle="ads">
            <span id="ads-arrow" class="section-arrow" aria-hidden="true">▲</span>
            <span>Sponsor & Affiliate Ads <span id="ads-count"></span></span>
          </button>
        </h2>
        <div class="section-controls">
          <button id="create-ad-btn" type="button" class="small-btn">+ New Ad</button>
          <button type="button" class="icon-btn move-up-btn" aria-label="Move section up" title="Move up">↑</button>
          <button type="button" class="icon-btn move-down-btn" aria-label="Move section down" title="Move down">↓</button>
        </div>
      </div>
      <div id="ads-section" class="section-body">
        <div id="awin-panel" class="awin-panel">
          <div class="awin-panel-row">
            <div>
              <strong>Awin affiliate sync</strong>
              <span id="awin-status-line" class="muted"></span>
            </div>
            <button id="awin-sync-btn" type="button" class="small-btn">⟳ Update Awin data</button>
          </div>
          <div id="awin-sync-log" class="awin-log" hidden></div>
        </div>
        <div id="ad-tag-panel" class="awin-panel" style="margin-top: 12px;">
          <div class="awin-panel-row">
            <div>
              <strong>Keyword auto-tag</strong>
              <span id="ad-tag-status" class="muted">Tag ads with interest keywords via embedding classifier</span>
            </div>
            <button id="ad-tag-btn" type="button" class="small-btn">🏷️ Auto-tag new</button>
            <button id="ad-tag-all-btn" type="button" class="small-btn">↻ Rerun all</button>
            <button id="ad-tag-untagged-btn" type="button" class="small-btn">↻ Rerun untagged</button>
            <button id="ad-tag-tagged-btn" type="button" class="small-btn">↻ Rerun tagged</button>
          </div>
          <div id="ad-tag-log" class="awin-log" hidden></div>
          <div id="ad-tag-results" hidden></div>
        </div>
        <div class="filter-bar">
          <input id="ad-search-input" class="custom-input" type="search" placeholder="Search ads by title, sponsor, network, CTA..." aria-label="Search ads" style="flex: 1; min-width: 200px;">
          <label class="provider-toolbar" for="ads-network-filter">
            Network
            <select id="ads-network-filter" class="provider-filter">
              <option value="all">All</option>
              <option value="Amazon">Amazon</option>
              <option value="TikTok">TikTok</option>
              <option value="Gumroad">Gumroad</option>
              <option value="Awin">Awin</option>
              <option value="Partner">Partner</option>
            </select>
          </label>
          <label class="provider-toolbar" for="ads-program-filter" id="ads-program-filter-wrap" hidden>
            Program
            <select id="ads-program-filter" class="provider-filter">
              <option value="all">All programs</option>
            </select>
          </label>
          <label class="provider-toolbar" for="ads-quality-filter">
            Show
            <select id="ads-quality-filter" class="provider-filter">
              <option value="all">All ads</option>
              <option value="needs-category">Needs category</option>
              <option value="no-image">Missing image</option>
              <option value="products">Products only</option>
              <option value="programs">Brand cards only</option>
              <option value="hidden">Hidden only</option>
              <option value="visible">Visible only</option>
            </select>
          </label>
        </div>
        <div id="ads-bulk-bar" class="awin-panel" hidden style="display: flex; gap: .6rem; align-items: center; margin-bottom: .6rem; flex-wrap: wrap;">
          <span id="ads-bulk-count" class="muted"></span>
          <label class="provider-toolbar" for="ads-bulk-category">
            Set category
            <select id="ads-bulk-category" class="provider-filter"></select>
          </label>
          <button id="ads-bulk-apply" type="button" class="small-btn">Apply</button>
          <button id="ads-bulk-hide" type="button" class="secondary small-btn">Hide</button>
          <button id="ads-bulk-show" type="button" class="secondary small-btn">Show</button>
          <button id="ads-bulk-clear" type="button" class="secondary small-btn">Clear</button>
        </div>
        <div style="margin-bottom: .6rem;">
          <button id="ads-select-all" type="button" class="secondary small-btn">Select all on page</button>
        </div>
        <nav id="ads-categories" class="category-tabs" aria-label="Filter ads by category"></nav>
        <p id="ads-results-count" class="muted" style="margin-bottom: .5rem;"></p>
        <div id="ads-list"></div>
        <div id="ads-pagination" class="pagination-bar"></div>
      </div>
    </section>

    <!-- 5. CUSTOM ARTICLE PREVIEW INPUT -->
    <section aria-labelledby="custom-title" class="admin-card-section" data-section-id="custom">
      <div class="section-header">
        <h2 id="custom-title">
          <button id="custom-toggle" class="section-toggle" type="button" aria-expanded="true" aria-controls="custom-body" data-section-toggle="custom">
            <span id="custom-arrow" class="section-arrow" aria-hidden="true">▲</span>
            <span>Custom Story URL</span>
          </button>
        </h2>
        <div class="section-controls">
          <button type="button" class="icon-btn move-up-btn" aria-label="Move section up" title="Move up">↑</button>
          <button type="button" class="icon-btn move-down-btn" aria-label="Move section down" title="Move down">↓</button>
        </div>
      </div>
      <div id="custom-body" class="section-body">
        <input id="custom-link" class="custom-input" type="url" placeholder="Paste an article link to preview its card" aria-label="Paste an article link to preview its card">
      </div>
    </section>

    <!-- 6. PROVIDERS SECTION -->
    <section aria-labelledby="providers-title" class="admin-card-section" data-section-id="providers">
      <div class="section-header">
        <h2 id="providers-title">
          <button id="providers-toggle" class="section-toggle" type="button" aria-expanded="false" aria-controls="providers-body" data-section-toggle="providers">
            <span id="providers-arrow" class="section-arrow" aria-hidden="true">▼</span>
            <span>News providers</span>
          </button>
        </h2>
        <div class="section-controls">
          <button type="button" class="icon-btn move-up-btn" aria-label="Move section up" title="Move up">↑</button>
          <button type="button" class="icon-btn move-down-btn" aria-label="Move section down" title="Move down">↓</button>
        </div>
      </div>
      <div id="providers-body" hidden>
        <div id="providers" class="providers" aria-live="polite" style="margin-top: .85rem;"></div>
        <div class="logs-nested" style="margin-top: 1rem;">
          <div style="display: flex; gap: .5rem; align-items: center; flex-wrap: wrap;">
            <button id="logs-nested-toggle" type="button" class="secondary small-btn" aria-expanded="false" aria-controls="logs-body">Provider fetch logs <span id="logs-count"></span></button>
            <button id="refresh-logs-btn" type="button" class="secondary small-btn">Refresh logs</button>
            <button id="clear-logs-btn" type="button" class="secondary small-btn">Clear logs</button>
          </div>
          <div id="logs-body" class="section-body" hidden>
            <div id="logs-summary" class="log-summary-strip"></div>
            <div class="filter-bar">
              <nav id="logs-status-tabs" class="category-tabs" aria-label="Filter fetch logs by status" style="margin: 0;"></nav>
              <label class="provider-toolbar" for="logs-provider-filter">
                Provider
                <select id="logs-provider-filter" class="provider-filter">
                  <option value="all">All providers</option>
                </select>
              </label>
              <label class="provider-toolbar" for="logs-category-filter">
                Topic
                <select id="logs-category-filter" class="provider-filter">
                  <option value="all">All topics</option>
                </select>
              </label>
            </div>
            <div id="provider-logs-list" class="log-list" aria-live="polite"></div>
            <div id="logs-pagination" class="pagination-bar"></div>
          </div>
        </div>
      </div>
    </section>

    <!-- 7. HISTORY SECTION -->
    <section aria-labelledby="stories-title" class="admin-card-section" data-section-id="decisions">
      <div class="section-header">
        <h2 id="stories-title">
          <button id="decisions-toggle" class="section-toggle" type="button" aria-expanded="false" aria-controls="stories" data-section-toggle="decisions">
            <span id="decisions-arrow" class="section-arrow" aria-hidden="true">▼</span>
            <span>History <span id="history-count"></span></span>
          </button>
        </h2>
        <div class="section-controls">
          <button type="button" class="icon-btn move-up-btn" aria-label="Move section up" title="Move up">↑</button>
          <button type="button" class="icon-btn move-down-btn" aria-label="Move section down" title="Move down">↓</button>
        </div>
      </div>
      <div id="decisions-body" class="section-body" hidden>
        <nav id="history-categories" class="category-tabs" aria-label="Filter history stories by category"></nav>
        <div class="filter-bar">
          <label class="provider-toolbar" for="history-provider">
            Provider
            <select id="history-provider" class="provider-filter">
              <option value="all">All providers</option>
            </select>
          </label>
        </div>
        <div id="stories" aria-controls="stories"></div>
        <div id="decided-pagination" class="pagination-bar"></div>
      </div>
    </section>

    <!-- 8. BANNED STORIES SECTION -->
    <section aria-labelledby="banned-title" class="admin-card-section" data-section-id="banned">
      <div class="section-header">
        <h2 id="banned-title">
          <button id="banned-toggle" class="section-toggle" type="button" aria-expanded="false" aria-controls="banned-stories" data-section-toggle="banned">
            <span id="banned-arrow" class="section-arrow" aria-hidden="true">▼</span>
            <span>Banned stories <span id="banned-count"></span></span>
          </button>
        </h2>
        <div class="section-controls">
          <button type="button" class="icon-btn move-up-btn" aria-label="Move section up" title="Move up">↑</button>
          <button type="button" class="icon-btn move-down-btn" aria-label="Move section down" title="Move down">↓</button>
        </div>
      </div>
      <div id="banned-body" class="section-body" hidden>
        <div id="banned-stories"></div>
        <div id="banned-pagination" class="pagination-bar"></div>
      </div>
    </section>

    <!-- ANALYTICS SECTION -->
    <section aria-labelledby="analytics-title" class="admin-card-section" data-section-id="analytics">
      <div class="section-header">
        <h2 id="analytics-title">
          <button id="analytics-toggle" class="section-toggle" type="button" aria-expanded="false" aria-controls="analytics-body" data-section-toggle="analytics">
            <span id="analytics-arrow" class="section-arrow" aria-hidden="true">▼</span>
            <span>Analytics</span>
          </button>
        </h2>
        <div class="section-controls">
          <button type="button" class="icon-btn move-up-btn" aria-label="Move section up" title="Move up">↑</button>
          <button type="button" class="icon-btn move-down-btn" aria-label="Move section down" title="Move down">↓</button>
        </div>
      </div>
      <div id="analytics-body" class="section-body" hidden>
        <p class="admin-hint">Anonymous audience stats from the last 30 days. Your own testing (admin panel, dev site) is excluded.</p>
        <div style="display: flex; gap: 0.75rem; align-items: center; margin: 1rem 0; flex-wrap: wrap;">
          <label class="admin-hint" style="margin: 0;" for="analytics-region">Region:</label>
          <select id="analytics-region" style="padding: 0.5rem; border-radius: 0.4rem; border: 1px solid var(--news-border, #334155); background: var(--news-card-bg, #1e293b); color: var(--news-text, #f1f5f9);">
            <option value="">All regions</option>
            <option value="north-america">North America</option>
            <option value="europe">Europe</option>
            <option value="asia">Asia</option>
            <option value="oceania">Oceania</option>
            <option value="south-america">South America</option>
            <option value="africa">Africa</option>
            <option value="global">Global / unknown</option>
          </select>
          <label class="admin-hint" style="margin: 0;" for="analytics-country">Country:</label>
          <select id="analytics-country" style="padding: 0.5rem; border-radius: 0.4rem; border: 1px solid var(--news-border, #334155); background: var(--news-card-bg, #1e293b); color: var(--news-text, #f1f5f9);">
            <option value="">All countries</option>
          </select>
          <button id="analytics-refresh" class="sign-in-button primary-button" type="button" style="width: auto; padding: 0.6rem 1.2rem;">Refresh</button>
          <span id="analytics-status" class="admin-hint"></span>
        </div>
        <div id="analytics-tabs" style="display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap;">
          <button type="button" class="analytics-tab sign-in-button" data-analytics-tab="search" style="width: auto; padding: 0.5rem 1rem;">Searches</button>
          <button type="button" class="analytics-tab" data-analytics-tab="search_gaps" style="width: auto; padding: 0.5rem 1rem;">Content gaps</button>
          <button type="button" class="analytics-tab" data-analytics-tab="keywords" style="width: auto; padding: 0.5rem 1rem;">Keyword CTR</button>
          <button type="button" class="analytics-tab" data-analytics-tab="boards" style="width: auto; padding: 0.5rem 1rem;">Spaces</button>
          <button type="button" class="analytics-tab" data-analytics-tab="acquisition" style="width: auto; padding: 0.5rem 1rem;">Traffic</button>
          <button type="button" class="analytics-tab" data-analytics-tab="dwell" style="width: auto; padding: 0.5rem 1rem;">Dwell time</button>
          <button type="button" class="analytics-tab" data-analytics-tab="ads" style="width: auto; padding: 0.5rem 1rem;">Ad CTR</button>
          <button type="button" class="analytics-tab" data-analytics-tab="ad_networks" style="width: auto; padding: 0.5rem 1rem;">Ad networks</button>
        </div>
        <div id="analytics-results" aria-live="polite"></div>
      </div>
    </section>

    <!-- BROKEN IMAGES SECTION -->
    <section aria-labelledby="broken-images-title" class="admin-card-section" data-section-id="broken-images">
      <div class="section-header">
        <h2 id="broken-images-title">
          <button id="broken-images-toggle" class="section-toggle" type="button" aria-expanded="false" aria-controls="broken-images-body" data-section-toggle="broken-images">
            <span id="broken-images-arrow" class="section-arrow" aria-hidden="true">▼</span>
            <span>Broken Images <span id="broken-images-count"></span></span>
          </button>
        </h2>
        <div class="section-controls">
          <button type="button" class="icon-btn move-up-btn" aria-label="Move section up" title="Move up">↑</button>
          <button type="button" class="icon-btn move-down-btn" aria-label="Move section down" title="Move down">↓</button>
        </div>
      </div>
      <div id="broken-images-body" class="section-body" hidden>
        <p class="admin-hint">Scans stories newest-first for missing images and image links that no longer load. Fix a story with Edit (the preview lets you replace the image URL).</p>
        <div style="display: flex; gap: 0.75rem; align-items: center; margin: 1rem 0; flex-wrap: wrap;">
          <button id="check-images-btn" class="small-btn" type="button">Find broken images</button>
          <button id="stop-images-btn" class="secondary small-btn" type="button" hidden>Stop</button>
          <span id="check-images-status" class="muted"></span>
        </div>
        <div id="check-images-results" aria-live="polite"></div>
      </div>
    </section>
    <!-- AI USAGE SECTION -->
    <section aria-labelledby="ai-usage-title" class="admin-card-section" data-section-id="ai-usage">
      <div class="section-header">
        <h2 id="ai-usage-title">
          <button id="ai-usage-toggle" class="section-toggle" type="button" aria-expanded="false" aria-controls="ai-usage-body" data-section-toggle="ai-usage">
            <span id="ai-usage-arrow" class="section-arrow" aria-hidden="true">▼</span>
            <span>🤖 AI usage <span id="ai-usage-count"></span></span>
          </button>
        </h2>
        <div class="section-controls">
          <button type="button" class="icon-btn move-up-btn" aria-label="Move section up" title="Move up">↑</button>
          <button type="button" class="icon-btn move-down-btn" aria-label="Move section down" title="Move down">↓</button>
        </div>
      </div>
      <div id="ai-usage-body" class="section-body" hidden>
        <p class="admin-hint">Every AI model call the site makes, all through Cloudflare Workers AI. Use the filters to narrow by model or by what triggers the call. Live call counts are not tracked yet — this is the catalog of what runs and why.</p>
        <div class="filter-bar">
          <label class="provider-toolbar" for="ai-usage-model-filter">
            Model
            <select id="ai-usage-model-filter" class="provider-filter">
              <option value="all">All models</option>
              <option value="llama">llama-3.2-3b-instruct</option>
              <option value="flux">flux-1-schnell</option>
              <option value="sdxl">stable-diffusion-xl-lightning</option>
              <option value="bge">bge-base-en-v1.5</option>
            </select>
          </label>
          <label class="provider-toolbar" for="ai-usage-trigger-filter">
            Trigger
            <select id="ai-usage-trigger-filter" class="provider-filter">
              <option value="all">All triggers</option>
              <option value="admin">Admin panel</option>
              <option value="auto">Automatic / scheduled</option>
              <option value="visitor">Visitor pages</option>
            </select>
          </label>
        </div>
        <div id="ai-usage-rows" aria-live="polite"></div>
      </div>
    </section>
  </main>

  <!-- UNIFIED PREVIEW DIALOG (Single Close Button inside Preview Actions) -->
  <dialog id="preview-dialog" class="preview-dialog" aria-labelledby="preview-title">
    <div id="preview-card"></div>
  </dialog>

  <script>
    var LITTLABLES_KEYWORDS = ` + keywordOptionsJson + `;
    const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100];
    const STORAGE_ORDER_KEY = 'littlables_admin_section_order_v1';
    const STORAGE_COLLAPSED_KEY = 'littlables_admin_collapsed_v1';
    const STORAGE_PAGE_SIZES_KEY = 'littlables_admin_page_sizes_v1';

    const categories = [
      { id: 'all', label: 'All', icon: '⚡' },
      { id: 'childcare', label: 'Childcare & Family', icon: '👨‍👩‍👧' },
      { id: 'animals', label: 'Animals & Nature', icon: '🐾' },
      { id: 'arts', label: 'Creative Arts', icon: '🎨' },
      { id: 'tech', label: 'Future Tech & AI', icon: '🤖' },
      { id: 'world', label: 'Global Currents', icon: '🌍' },
      { id: 'uplifting', label: 'Uplifting News', icon: '✨' }
    ];

    function loadSavedPageSizes() {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_PAGE_SIZES_KEY) || '{}');
        return {
          aiStaging: PAGE_SIZE_OPTIONS.includes(Number(saved.aiStaging)) ? Number(saved.aiStaging) : 10,
          pending: PAGE_SIZE_OPTIONS.includes(Number(saved.pending)) ? Number(saved.pending) : 10,
          search: PAGE_SIZE_OPTIONS.includes(Number(saved.search)) ? Number(saved.search) : 10,
          ads: PAGE_SIZE_OPTIONS.includes(Number(saved.ads)) ? Number(saved.ads) : 10,
          decided: PAGE_SIZE_OPTIONS.includes(Number(saved.decided)) ? Number(saved.decided) : 10,
          banned: PAGE_SIZE_OPTIONS.includes(Number(saved.banned)) ? Number(saved.banned) : 10,
          logs: PAGE_SIZE_OPTIONS.includes(Number(saved.logs)) ? Number(saved.logs) : 20
        };
      } catch {
        return { aiStaging: 10, pending: 10, search: 10, ads: 10, decided: 10, banned: 10, logs: 20 };
      }
    }

    const state = {
      busy: new Set(),
      syncingAll: false,
      unstickingAll: false,
      syncPollActive: false,
      runs: [],
      togglingAutoSync: false,
      curatingAi: false,
      togglingAiSchedule: false,
      savingTasteProfile: false,
      bulkDecidingAi: false,
      tasteDrawerOpen: false,
      selectedAiStoryIds: new Set(),
      activeAiCategory: 'all_categories',
      activeAiSlot: 'all',
      selectedRunSlot: 'auto',
      approving: new Set(),
      banning: new Set(),
      unapproving: new Set(),
      undoing: new Set(),
      ignored: new Set(),
      expandedLogs: new Set(),
      previewTimer: null,
      previewType: 'story',
      previewDraft: null,
      previewStoryId: null,
      previewOrigKeywords: [],
      previewOrigCats: null,
      previewAdDraft: null,
      previewAdId: null,
      generatingSummary: false,
      generatingImage: false,
      previewStatusMessage: '',
      previewStatusType: 'muted',
      activeCategory: 'all',
      activeProvider: 'all',
      activeHistoryCategory: 'all',
      activeHistoryProvider: 'all',
      activeAdCategory: 'all',
      activeAdNetwork: 'all',
      activeAdProgram: 'all',
      activeAdQuality: 'all',
      selectedAdIds: new Set(),
      activeLogStatus: 'all',
      activeLogProvider: 'all',
      activeLogCategory: 'all',
      adSearchQuery: '',
      storySearchQuery: '',
      storySearchTimer: null,
      providers: [],
      autoSync: {
        enabled: true,
        intervalMs: 3600000,
        lastRunAt: null,
        nextRunAt: null,
        lastTrigger: null,
        lastStatus: 'never',
        lastSummary: null,
        isStale: false
      },
      aiCuration: {
        enabled: true,
        picksPerCategory: 5,
        currentSlot: 'morning',
        currentSlotLabel: 'Morning Edition (08:00)',
        isSlotDue: false,
        lastRunAt: null,
        lastSlot: null,
        lastBatchId: null,
        lastTrigger: null,
        lastStatus: 'never',
        lastSummary: null,
        nextSlot: 'morning',
        nextRunAt: null,
        completedSlotsToday: [],
        tasteProfile: {
          customInstructions: '',
          preferredKeywords: '',
          mutedKeywords: ''
        },
        learnedSignals: {
          approvedCount: 0,
          rejectedCount: 0,
          topApprovedSources: [],
          topApprovedCategories: [],
          topApprovedTerms: [],
          avoidedSources: [],
          avoidedTerms: []
        },
        stagedPicks: [],
        categoryCounts: {}
      },
      providerLogs: [],
      providerLogsSummary: {
        totalRequests: 0,
        rateLimitedCount: 0,
        failedCount: 0,
        failoverCount: 0,
        averageLatencyMs: 0
      },
      pendingStories: [],
      decidedStories: [],
      bannedStories: [],
      searchResults: [],
      ads: [],
      pages: {
        aiStaging: 1,
        pending: 1,
        search: 1,
        ads: 1,
        decided: 1,
        banned: 1,
        logs: 1
      },
      pageSizes: loadSavedPageSizes()
    };

    const adminSectionsEl = document.getElementById('admin-sections');
    const providersEl = document.getElementById('providers');
    const messageEl = document.getElementById('message');
    const categoryEl = document.getElementById('approval-categories');
    const providerFilterEl = document.getElementById('approval-provider');
    const historyCategoryEl = document.getElementById('history-categories');
    const historyProviderFilterEl = document.getElementById('history-provider');
    const adsCategoriesEl = document.getElementById('ads-categories');
    const adsNetworkFilterEl = document.getElementById('ads-network-filter');
    const adsListEl = document.getElementById('ads-list');
    const adSearchInput = document.getElementById('ad-search-input');
    const storySearchInput = document.getElementById('story-search-input');
    const storySearchResultsEl = document.getElementById('story-search-results');
    const storySearchCountEl = document.getElementById('story-search-count');
    const clearStorySearchBtn = document.getElementById('clear-story-search');
    const previewDialog = document.getElementById('preview-dialog');

    /* Lock background scroll when preview modal is open */
    function lockModalScroll() {
      document.documentElement.classList.add('modal-open');
      document.body.classList.add('modal-open');
    }
    function unlockModalScroll() {
      document.documentElement.classList.remove('modal-open');
      document.body.classList.remove('modal-open');
    }
    previewDialog.addEventListener('close', unlockModalScroll);
    previewDialog.addEventListener('click', (event) => {
      if (event.target === previewDialog) previewDialog.close();
    });

    /* ── Section registry ──────────────────────────────────────────────
       ADDING A NEW SECTION (prototype):
       1. Add the <section data-section-id="your-id"> markup in the HTML above,
          with a header toggle button id="your-id-toggle", an arrow span
          id="your-id-arrow", and a body div (pass its id as body: if it does
          not follow the your-id-body pattern).
       2. Add ONE line to SECTIONS below. That is the whole job — toggle
          wiring, the sticky section nav, collapse persistence, move buttons,
          and Reset layout all derive from this list automatically.
    ─────────────────────────────────────────────────────────────────── */
    const SECTIONS = [
      { id: 'summary', label: 'Summary', body: 'summary-body', defaultOpen: true },
      { id: 'ai-staging', label: 'Discovery', body: 'ai-staging-body', defaultOpen: true },
      { id: 'embedding-validation', label: 'Classify', body: 'embedding-validation-body', defaultOpen: true },
      { id: 'pending', label: 'Pending', body: 'pending-body', defaultOpen: true },
      { id: 'search', label: 'Search', body: 'search-body', defaultOpen: true },
      { id: 'ads', label: 'Ads', body: 'ads-section', defaultOpen: true },
      { id: 'custom', label: 'Custom', body: 'custom-body', defaultOpen: true },
      { id: 'providers', label: 'Providers', body: 'providers-body', defaultOpen: false },
      { id: 'decisions', label: 'History', body: 'decisions-body', defaultOpen: false },
      { id: 'banned', label: 'Banned', body: 'banned-body', defaultOpen: false },
      { id: 'analytics', label: 'Analytics', body: 'analytics-body', defaultOpen: false },
      { id: 'broken-images', label: 'Broken Images', body: 'broken-images-body', defaultOpen: false },
      { id: 'ai-usage', label: 'AI usage', body: 'ai-usage-body', defaultOpen: false },
    ];
    const sectionTargets = Object.fromEntries(
      SECTIONS.map((s) => [s.id, {
        toggle: s.id + '-toggle',
        arrow: s.id + '-arrow',
        body: s.body,
        defaultOpen: s.defaultOpen,
      }])
    );


    /* ── AI usage catalog ──────────────────────────────────────────────
       One entry per AI model call the site makes. The dashboard renders
       this list and filters it; the README "AI / LLM usage" section
       documents the same calls for contributors. Keep both in sync. */
    const AI_USAGE_MODELS = {
      llama: '@cf/meta/llama-3.2-3b-instruct',
      flux: '@cf/black-forest-labs/flux-1-schnell',
      sdxl: '@cf/bytedance/stable-diffusion-xl-lightning',
      bge: '@cf/baai/bge-base-en-v1.5'
    };
    const AI_USAGE_ROWS = [
      { id: 'curation', name: 'Story curation', models: ['llama'], triggers: ['auto', 'admin'], what: 'Picks up to 5 stories per category for the editor to approve, based on the taste profile and approval history. Recommendations to the editor, never shown to visitors.', cost: '1 call per category, up to 7 per run · 3 slots a day (08:00, 13:00, 18:00) plus manual Curate buttons' },
      { id: 'summaries', name: 'Admin story summaries', models: ['llama'], triggers: ['admin'], what: 'Writes one accurate paragraph summarizing a story for the admin review workflow. May scrape the article text first.', cost: '1 call per click · rate-limited per GitHub user' },
      { id: 'scene', name: 'Image scene description', models: ['llama'], triggers: ['admin'], what: 'Writes the 1-2 sentence scene prompt used to render an AI image. If it fails, the image still renders from the story details.', cost: '1 call per image created · 0 calls on failure' },
      { id: 'image', name: 'Image rendering', models: ['flux', 'sdxl'], triggers: ['admin', 'visitor'], what: 'Renders the AI image. Created from the admin panel; served publicly by /ai-image, which is edge and memory cached.', cost: '1 image call per unique prompt and seed · fallback model only when FLUX fails · repeat loads cost 0 calls' },
      { id: 'ai-tags', name: 'AI tags keyword correction', models: ['llama'], triggers: ['admin'], what: 'Reads a story title and description and picks up to 3 keywords by meaning, correcting embedding misfires. The button on each validation row.', cost: '1 call per click' },
      { id: 'validation', name: 'Category validation', models: ['bge'], triggers: ['admin'], what: 'Batch-embeds unapproved stories and flags where the embedding-predicted category disagrees with the query-assigned category.', cost: '1 batch call per group of stories' },
      { id: 'tagging', name: 'Interest keyword tagging', models: ['bge'], triggers: ['admin'], what: 'Tags stories with up to 3 interest keywords. Runs inside the validation run, reusing the story embedding, so it adds no extra calls. Single-story auto-tag is also available.', cost: '0 extra calls inside validation · 1 embed per auto-tag click' },
      { id: 'warmup', name: 'Keyword vector warmup', models: ['bge'], triggers: ['admin'], what: 'Warms up keyword vectors for all embedding features: the stored backfill (25 per round, inside the Validate flow) plus the in-memory cache on cold starts.', cost: 'Batch embeds, 25 vectors per round · status check costs 0 calls' },
      { id: 'ad-auto-tag', name: 'Ad auto-tag', models: ['bge'], triggers: ['admin'], what: 'Tags ads with interest keywords so they can match stories.', cost: '15 ads per click, loops until done' },
      { id: 'ad-match', name: 'Ad matching', models: ['bge'], triggers: ['visitor'], what: 'Matches ads to stories on the public site. The frontend sends untagged stories from the current feed and gets ranked ad IDs back.', cost: 'Batch embeds per feed load that has untagged stories, up to 20 stories' },
      { id: 'playroom-fallback', name: 'Playroom description fallback', models: ['bge'], triggers: ['visitor'], what: 'When a playroom has no pills selected, embeds the playroom description to find the most similar interests.', cost: '1 embed per playroom or space load with no pills' }
    ];
    let aiUsageCounts = null;
    function aiUsageTotals(rows) {
      const today = new Date().toISOString().slice(0, 10);
      const weekStart = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
      let todayCalls = 0;
      let weekCalls = 0;
      let weekErrors = 0;
      rows.forEach(function (r) {
        if (r.usage_date >= weekStart) {
          weekCalls += r.calls || 0;
          weekErrors += r.errors || 0;
          if (r.usage_date === today) todayCalls += r.calls || 0;
        }
      });
      return { today: todayCalls, week: weekCalls, errorsWeek: weekErrors };
    }
    function renderAiUsage() {
      const container = document.getElementById('ai-usage-rows');
      const countEl = document.getElementById('ai-usage-count');
      if (!container) return;
      const modelFilter = document.getElementById('ai-usage-model-filter');
      const triggerFilter = document.getElementById('ai-usage-trigger-filter');
      const model = modelFilter ? modelFilter.value : 'all';
      const trigger = triggerFilter ? triggerFilter.value : 'all';
      const visible = AI_USAGE_ROWS.filter(function (row) {
        const modelOk = model === 'all' || row.models.indexOf(model) !== -1;
        const triggerOk = trigger === 'all' || row.triggers.indexOf(trigger) !== -1;
        return modelOk && triggerOk;
      });
      container.replaceChildren();
      if (aiUsageCounts) {
        let totalToday = 0;
        let totalWeek = 0;
        visible.forEach(function (row) {
          const totals = aiUsageTotals(aiUsageCounts.filter(function (r) { return r.usage_key === row.id; }));
          totalToday += totals.today;
          totalWeek += totals.week;
        });
        const totalsLine = document.createElement('p');
        totalsLine.className = 'muted';
        totalsLine.textContent = 'Live counts for the visible rows — Today: ' + totalToday + ' calls · Last 7 days: ' + totalWeek + ' calls.';
        container.appendChild(totalsLine);
      }
      visible.forEach(function (row) {
        const div = document.createElement('div');
        div.style.padding = '0.6rem 0';
        div.style.borderTop = '1px solid var(--news-border, #334155)';
        const title = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = row.name;
        title.appendChild(name);
        const badge = document.createElement('span');
        badge.className = 'muted';
        badge.textContent = ' · ' + row.models.map(function (m) { return AI_USAGE_MODELS[m]; }).join(', ');
        title.appendChild(badge);
        const what = document.createElement('div');
        what.textContent = row.what;
        const cost = document.createElement('div');
        cost.className = 'muted';
        cost.textContent = row.cost;
        div.appendChild(title);
        div.appendChild(what);
        div.appendChild(cost);
        if (aiUsageCounts) {
          const totals = aiUsageTotals(aiUsageCounts.filter(function (r) { return r.usage_key === row.id; }));
          const counts = document.createElement('div');
          counts.className = 'muted';
          counts.textContent = 'Today: ' + totals.today + ' calls · Last 7 days: ' + totals.week + ' calls' + (totals.errorsWeek > 0 ? ' · ' + totals.errorsWeek + ' failed (7d)' : '');
          div.appendChild(counts);
        }
        container.appendChild(div);
      });
      if (visible.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'admin-hint';
        empty.textContent = 'No AI calls match these filters.';
        container.appendChild(empty);
      }
      if (countEl) countEl.textContent = '(' + visible.length + ' of ' + AI_USAGE_ROWS.length + ')';
    }
    (function initAiUsageFilters() {
      const modelFilter = document.getElementById('ai-usage-model-filter');
      const triggerFilter = document.getElementById('ai-usage-trigger-filter');
      if (modelFilter) modelFilter.addEventListener('change', renderAiUsage);
      if (triggerFilter) triggerFilter.addEventListener('change', renderAiUsage);
      renderAiUsage();
      fetch('/admin/api/ai-usage?days=30', { credentials: 'same-origin' }).then(function (res) {
        if (!res.ok) return null;
        return res.json();
      }).then(function (data) {
        if (data && Array.isArray(data.rows)) {
          aiUsageCounts = data.rows;
          renderAiUsage();
        }
      }).catch(function () { /* counts stay hidden when the endpoint is unavailable */ });
    })();

    function sectionById(id) {
      return adminSectionsEl.querySelector(':scope > section[data-section-id="' + id + '"]');
    }

    function jumpToSection(id) {
      setSectionExpanded(id, true, true);
      const sec = sectionById(id);
      if (!sec) return;
      // Account for the sticky header so the section top isn't cut off.
      const sticky = document.querySelector('.admin-sticky');
      const offset = (sticky ? sticky.getBoundingClientRect().height : 120) + 12;
      const top = sec.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }

    function timeAgo(ts) {
      const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
      if (s < 60) return 'just now';
      const m = Math.floor(s / 60);
      if (m < 60) return m + 'm ago';
      const h = Math.floor(m / 60);
      if (h < 24) return h + 'h ago';
      return Math.floor(h / 24) + 'd ago';
    }

    function fmtNum(n) {
      return typeof n === 'number' && isFinite(n) ? n.toLocaleString() : '—';
    }

    /* Sticky section nav: jump links in current DOM order, with live counts
       pulled from the section headers so they never drift out of sync. */
    const NAV_COUNTS = {
      summary: () => document.getElementById('total')?.textContent?.trim(),
      'ai-staging': () => document.getElementById('ai-staging-count')?.textContent?.trim(),
      'embedding-validation': () => document.getElementById('embedding-validation-count')?.textContent?.trim(),
      pending: () => document.getElementById('pending-count')?.textContent?.trim(),
      ads: () => document.getElementById('ads-count')?.textContent?.trim(),
      logs: () => document.getElementById('logs-count')?.textContent?.trim(),
      decisions: () => document.getElementById('history-count')?.textContent?.trim(),
      banned: () => document.getElementById('banned-count')?.textContent?.trim(),
      'ai-usage': () => document.getElementById('ai-usage-count')?.textContent?.trim(),
    };
    /* Hamburger section menu: vertical list in current DOM order, with live
       counts pulled from the section headers so they never drift out of sync.
       The ↑/↓ movers move the actual page sections, so menu order and page
       order share one source of truth. */
    function renderSectionMenu() {
      const menu = document.getElementById('section-menu');
      if (!menu) return;
      const ordered = Array.from(adminSectionsEl.querySelectorAll(':scope > section[data-section-id]'))
        .map((sec) => sec.dataset.sectionId)
        .filter((id) => sectionTargets[id]);
      menu.replaceChildren();
      ordered.forEach((id, idx) => {
        const def = SECTIONS.find((s) => s.id === id) || {};
        const label = def.label || id;
        const li = document.createElement('li');
        li.className = 'menu-row';
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'menu-link';
        link.dataset.menuJump = id;
        link.setAttribute('aria-label', 'Jump to ' + label + ' section');
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label + ' ';
        link.appendChild(labelSpan);
        const count = NAV_COUNTS[id] ? (NAV_COUNTS[id]() || '') : '';
        if (count) {
          const countSpan = document.createElement('span');
          countSpan.className = 'muted';
          countSpan.textContent = count;
          link.appendChild(countSpan);
        }
        const movers = document.createElement('span');
        movers.className = 'menu-movers';
        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'icon-btn';
        up.textContent = '↑';
        up.title = 'Move ' + label + ' up';
        up.setAttribute('aria-label', 'Move ' + label + ' up');
        up.dataset.menuMove = 'up';
        up.dataset.sectionId = id;
        up.disabled = idx === 0;
        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'icon-btn';
        down.textContent = '↓';
        down.title = 'Move ' + label + ' down';
        down.setAttribute('aria-label', 'Move ' + label + ' down');
        down.dataset.menuMove = 'down';
        down.dataset.sectionId = id;
        down.disabled = idx === ordered.length - 1;
        movers.append(up, down);
        li.append(link, movers);
        menu.appendChild(li);
      });
    }

    /* Hamburger open/close + menu interactions (jump links and movers). */
    const menuToggleBtn = document.getElementById('menu-toggle');
    const sectionMenuEl = document.getElementById('section-menu');
    function setMenuOpen(open) {
      if (!sectionMenuEl || !menuToggleBtn) return;
      sectionMenuEl.hidden = !open;
      menuToggleBtn.setAttribute('aria-expanded', String(open));
    }
    if (menuToggleBtn) {
      menuToggleBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        renderSectionMenu();
        setMenuOpen(sectionMenuEl.hidden);
      });
    }
    document.addEventListener('click', (event) => {
      if (!sectionMenuEl || sectionMenuEl.hidden) return;
      if (event.target.closest('#section-menu') || event.target.closest('#menu-toggle')) return;
      setMenuOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    });
    if (sectionMenuEl) {
      sectionMenuEl.addEventListener('click', (event) => {
        const moveBtn = event.target.closest('[data-menu-move]');
        if (moveBtn) {
          const sec = sectionById(moveBtn.dataset.sectionId);
          if (sec) {
            if (moveBtn.dataset.menuMove === 'up' && sec.previousElementSibling) {
              adminSectionsEl.insertBefore(sec, sec.previousElementSibling);
            } else if (moveBtn.dataset.menuMove === 'down' && sec.nextElementSibling) {
              adminSectionsEl.insertBefore(sec.nextElementSibling, sec);
            }
            saveSectionOrder();
          }
          return;
        }
        const jumpBtn = event.target.closest('[data-menu-jump]');
        if (jumpBtn) {
          setMenuOpen(false);
          jumpToSection(jumpBtn.dataset.menuJump);
        }
      });
    }

    /* Vitals status bar. Reads from the already-loaded /admin/api/status
       snapshot plus the ads/tags and analytics extras — no new worker
       endpoints, everything is client-side. */
    function renderVitals() {
      const bar = document.getElementById('vitals-bar');
      if (!bar) return;
      const d = state.lastStatus || {};
      const providers = state.providers || [];
      const now = Date.now();
      let cooling = 0, failed = 0, lastSuccess = 0;
      providers.forEach((p) => {
        const ls = p.last_success_at ? Date.parse(p.last_success_at) : 0;
        if (ls > lastSuccess) lastSuccess = ls;
        const cd = p.cooldown_until ? Date.parse(p.cooldown_until) : 0;
        if (cd > now) cooling++;
        else if (p.last_failed_call || p.last_error) failed++;
      });
      const healthy = providers.length - cooling - failed;
      const staged = state.aiCuration && Array.isArray(state.aiCuration.stagedPicks)
        ? state.aiCuration.stagedPicks.length : null;
      const pendingN = (state.pendingStories || []).length;
      const adsTotal = Array.isArray(state.ads) ? state.ads.length : null;
      const tagPct = (adsTotal && state.adTagCount != null)
        ? Math.round((100 * state.adTagCount) / adsTotal) : null;
      const engV = state.engagementViews, engC = state.engagementClicks;
      const engCtr = (engV > 0 && engC != null) ? (100 * engC / engV).toFixed(1) + '% CTR' : null;

      const vitals = [
        { icon: '📚', label: 'Stories', value: fmtNum(d.totalStories), target: 'summary' },
        { icon: '⏳', label: 'Pending', value: fmtNum(pendingN), target: 'pending', tone: pendingN ? 'warn' : 'ok' },
        { icon: '🤖', label: 'Discovery', value: staged != null ? fmtNum(staged) : '—', target: 'ai-staging' },
        {
          icon: '📡', label: 'Providers',
          value: providers.length ? healthy + '/' + providers.length + ' ok' : '—',
          target: 'providers', tone: failed ? 'bad' : cooling ? 'warn' : 'ok',
          title: cooling ? cooling + ' cooling down' : (failed ? failed + ' with errors — see Providers' : ''),
        },
        {
          icon: '🎯', label: 'Ads',
          value: adsTotal != null ? fmtNum(adsTotal) + (tagPct != null ? ' · ' + tagPct + '% tagged' : '') : '—',
          target: 'ads',
        },
        {
          icon: '👁️', label: 'Engagement',
          value: engV != null ? fmtNum(engV) + ' views' + (engCtr ? ' · ' + engCtr : '') + ' (30d)' : '—',
          target: 'analytics',
        },
        { icon: '🔄', label: 'Synced', value: lastSuccess ? timeAgo(lastSuccess) : '—', target: 'providers' },
        {
          icon: '🔁', label: 'Auto-sync',
          value: state.autoSync ? (state.autoSync.enabled ? 'on' : 'paused') : '—',
          target: 'providers', tone: state.autoSync && state.autoSync.enabled ? 'ok' : 'warn',
        },
      ];
      bar.replaceChildren();
      vitals.forEach((v) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'vital' + (v.tone ? ' vital-' + v.tone : '');
        if (v.title) b.title = v.title;
        const labelEl = document.createElement('span');
        labelEl.textContent = v.icon + ' ' + v.label;
        const valEl = document.createElement('span');
        valEl.className = 'vital-value';
        valEl.textContent = v.value;
        b.append(labelEl, valEl);
        b.setAttribute('aria-label', v.label + ': ' + v.value + ' — jump to section');
        b.addEventListener('click', () => jumpToSection(v.target));
        bar.appendChild(b);
      });
    }

    /* Lightweight extras for the vitals bar. Runs after ads load; failures
       leave "—" placeholders rather than breaking the bar. */
    async function refreshVitalsExtras() {
      try {
        const t = await request('/ads/tags');
        state.adTagCount = typeof t.count === 'number' ? t.count : Object.keys(t.tags || {}).length;
      } catch { state.adTagCount = null; }
      try {
        const a = await request('/admin/api/analytics?type=keywords&limit=200');
        if (a && a.ok && Array.isArray(a.rows)) {
          let v = 0, c = 0;
          a.rows.forEach((r) => { v += Number(r.views) || 0; c += Number(r.clicks) || 0; });
          state.engagementViews = v;
          state.engagementClicks = c;
        } else {
          state.engagementViews = null;
        }
      } catch { state.engagementViews = null; }
      renderVitals();
      renderSectionMenu();
    }

    function setSectionExpanded(sectionId, expanded, persist = true) {
      const cfg = sectionTargets[sectionId];
      if (!cfg) return;
      const toggleBtn = document.getElementById(cfg.toggle);
      const arrowEl = document.getElementById(cfg.arrow);
      const bodyEl = document.getElementById(cfg.body);
      if (!toggleBtn || !arrowEl || !bodyEl) return;
      toggleBtn.setAttribute('aria-expanded', String(expanded));
      arrowEl.textContent = expanded ? '▲' : '▼';
      bodyEl.hidden = !expanded;
      if (persist) {
        try {
          const saved = JSON.parse(localStorage.getItem(STORAGE_COLLAPSED_KEY) || '{}');
          saved[sectionId] = expanded;
          localStorage.setItem(STORAGE_COLLAPSED_KEY, JSON.stringify(saved));
        } catch {}
      }
    }

    function updateSectionMoveButtons() {
      const sections = Array.from(adminSectionsEl.querySelectorAll(':scope > section[data-section-id]'));
      sections.forEach((sec, idx) => {
        const upBtn = sec.querySelector('.move-up-btn');
        const downBtn = sec.querySelector('.move-down-btn');
        if (upBtn) upBtn.disabled = idx === 0;
        if (downBtn) downBtn.disabled = idx === sections.length - 1;
      });
    }

    function saveSectionOrder() {
      try {
        const order = Array.from(adminSectionsEl.querySelectorAll(':scope > section[data-section-id]'))
          .map(sec => sec.dataset.sectionId);
        localStorage.setItem(STORAGE_ORDER_KEY, JSON.stringify(order));
      } catch {}
      updateSectionMoveButtons();
      renderSectionMenu();
    }

    function restoreSectionLayout() {
      try {
        const savedOrder = JSON.parse(localStorage.getItem(STORAGE_ORDER_KEY) || 'null');
        if (Array.isArray(savedOrder) && savedOrder.length) {
          savedOrder.forEach((id) => {
            const sec = adminSectionsEl.querySelector(':scope > section[data-section-id="' + id + '"]');
            if (sec) adminSectionsEl.append(sec);
          });
        }
      } catch {}
      try {
        const savedCollapsed = JSON.parse(localStorage.getItem(STORAGE_COLLAPSED_KEY) || '{}');
        Object.keys(sectionTargets).forEach((id) => {
          const expanded = typeof savedCollapsed[id] === 'boolean'
            ? savedCollapsed[id]
            : sectionTargets[id].defaultOpen;
          setSectionExpanded(id, expanded, false);
        });
      } catch {}
      updateSectionMoveButtons();
      renderSectionMenu();
    }

    Object.keys(sectionTargets).forEach((sectionId) => {
      const cfg = sectionTargets[sectionId];
      const toggleBtn = document.getElementById(cfg.toggle);
      if (toggleBtn) {
        toggleBtn.addEventListener('click', (event) => {
          const button = event.currentTarget;
          const expanded = button.getAttribute('aria-expanded') !== 'true';
          setSectionExpanded(sectionId, expanded, true);
        });
      }
    });

    adminSectionsEl.addEventListener('click', (event) => {
      const upBtn = event.target.closest('.move-up-btn');
      const downBtn = event.target.closest('.move-down-btn');
      if (!upBtn && !downBtn) return;
      const section = event.target.closest('section[data-section-id]');
      if (!section) return;
      if (upBtn && section.previousElementSibling) {
        adminSectionsEl.insertBefore(section, section.previousElementSibling);
        saveSectionOrder();
      } else if (downBtn && section.nextElementSibling) {
        adminSectionsEl.insertBefore(section.nextElementSibling, section);
        saveSectionOrder();
      }
    });

    const resetBtn = document.getElementById('reset-layout');
    if (resetBtn) resetBtn.addEventListener('click', () => {
      try {
        localStorage.removeItem(STORAGE_ORDER_KEY);
        localStorage.removeItem(STORAGE_COLLAPSED_KEY);
      } catch {}
      SECTIONS.map((s) => s.id).forEach((id) => {
        const sec = adminSectionsEl.querySelector(':scope > section[data-section-id="' + id + '"]');
        if (sec) adminSectionsEl.append(sec);
        setSectionExpanded(id, sectionTargets[id].defaultOpen, false);
      });
      updateSectionMoveButtons();
    });

    /* Reusable Pagination Renderer */
    function renderPaginationBar(containerId, listKey, totalItems, onRender) {
      const bar = document.getElementById(containerId);
      if (!bar) return { slice: (items) => items };
      const pageSize = state.pageSizes[listKey] || 10;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      if (state.pages[listKey] > totalPages) state.pages[listKey] = totalPages;
      if (state.pages[listKey] < 1) state.pages[listKey] = 1;
      const currentPage = state.pages[listKey];

      bar.replaceChildren();
      if (totalItems === 0) {
        bar.hidden = true;
        return { slice: () => [] };
      }
      bar.hidden = false;

      const startIdx = (currentPage - 1) * pageSize;
      const endIdx = Math.min(totalItems, startIdx + pageSize);

      const info = document.createElement('div');
      info.className = 'pagination-info';

      const perPageLabel = document.createElement('label');
      perPageLabel.className = 'provider-toolbar';
      perPageLabel.textContent = 'Show ';
      const select = document.createElement('select');
      select.className = 'page-size-select';
      select.setAttribute('aria-label', 'Results per page');
      PAGE_SIZE_OPTIONS.forEach((size) => {
        const opt = document.createElement('option');
        opt.value = String(size);
        opt.textContent = String(size);
        select.append(opt);
      });
      select.value = String(pageSize);
      select.addEventListener('change', () => {
        state.pageSizes[listKey] = Number(select.value);
        state.pages[listKey] = 1;
        try {
          localStorage.setItem(STORAGE_PAGE_SIZES_KEY, JSON.stringify(state.pageSizes));
        } catch {}
        onRender();
      });
      perPageLabel.append(select);

      const rangeText = document.createElement('span');
      rangeText.className = 'muted';
      rangeText.textContent = (startIdx + 1) + '–' + endIdx + ' of ' + totalItems;
      info.append(perPageLabel, rangeText);

      const controls = document.createElement('div');
      controls.className = 'pagination-controls';

      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'secondary small-btn';
      prevBtn.textContent = '‹ Prev';
      prevBtn.disabled = currentPage <= 1;
      prevBtn.addEventListener('click', () => {
        if (state.pages[listKey] > 1) {
          state.pages[listKey]--;
          onRender();
        }
      });

      const pageIndicator = document.createElement('span');
      pageIndicator.className = 'pagination-page-label';
      pageIndicator.textContent = currentPage + ' / ' + totalPages;

      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'secondary small-btn';
      nextBtn.textContent = 'Next ›';
      nextBtn.disabled = currentPage >= totalPages;
      nextBtn.addEventListener('click', () => {
        if (state.pages[listKey] < totalPages) {
          state.pages[listKey]++;
          onRender();
        }
      });

      controls.append(prevBtn, pageIndicator, nextBtn);
      bar.append(info, controls);

      return {
        slice: (items) => items.slice(startIdx, endIdx)
      };
    }

    const text = (value) => value == null || value === '' ? '—' : String(value);
    const formatDateTime = (date) => date.toLocaleDateString() + ' ' + date.toLocaleTimeString();

    function decodeHtmlEntities(value) {
      const textarea = document.createElement('textarea');
      textarea.innerHTML = String(value ?? '').replace(/[<>]/g, character => (
        character === '<' ? '&lt;' : '&gt;'
      ));
      return textarea.value;
    }

    function getStoryDomain(link) {
      try {
        return new URL(link).hostname.replace(/^www\\./i, '');
      } catch {
        return 'Unknown domain';
      }
    }

    /* Frontpage story links: mirrors getStoryId (src/services/supabaseService.ts)
       and getStorySlug (src/services/urlService.ts) in the frontend, so the
       dashboard builds the exact same expanded-view URL the frontpage opens.
       Links point at prod (littlables.com) per Katie's call. */
    const FRONTPAGE_ORIGIN = 'https://littlables.com';
    function getFrontpageStoryId(title, link) {
      const str = ((link || '') + (title || '')).toLowerCase().trim();
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
      }
      return 's_' + Math.abs(hash).toString(36).slice(0, 10);
    }
    function getFrontpageStorySlug(story) {
      const storyId = getFrontpageStoryId(story.title, story.link);
      const titleSlug = (story.title || '')
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 56)
        .replace(/-+$/g, '');
      return titleSlug ? storyId + '-' + titleSlug : storyId;
    }
    function getFrontpageStoryUrl(story) {
      const category = story.category || 'all';
      return FRONTPAGE_ORIGIN + '/?interest=' + encodeURIComponent(category) +
        '&balloon=' + encodeURIComponent(getFrontpageStorySlug(story));
    }
    async function copyFrontpageStoryLink(button, story) {
      const url = getFrontpageStoryUrl(story);
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // Fallback for browsers without async clipboard access
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch {}
        ta.remove();
      }
      const original = button.textContent;
      button.textContent = '✓ Copied';
      setTimeout(() => { button.textContent = original; }, 2000);
    }

    function formatElapsed(timestamp) {
      const elapsed = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
      const days = Math.floor(elapsed / 86400);
      const hours = Math.floor((elapsed % 86400) / 3600);
      const minutes = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
      const seconds = String(elapsed % 60).padStart(2, '0');
      if (days) return days + 'd' + String(hours).padStart(2, '0') + 'h' + minutes + 'm' + seconds + 's ago';
      if (hours) return hours + 'h' + minutes + 'm' + seconds + 's ago';
      return minutes + 'm' + seconds + 's ago';
    }

    function formatCountdown(targetIso) {
      const targetMs = Date.parse(targetIso || '');
      if (!Number.isFinite(targetMs)) return 'Ready now';
      const remainingSec = Math.max(0, Math.floor((targetMs - Date.now()) / 1000));
      if (remainingSec <= 0) return 'Due now';
      const hrs = Math.floor(remainingSec / 3600);
      const mins = String(Math.floor((remainingSec % 3600) / 60)).padStart(2, '0');
      const secs = String(remainingSec % 60).padStart(2, '0');
      return (hrs > 0 ? hrs + 'h ' : '') + mins + 'm ' + secs + 's';
    }

    function refreshStoryAges() {
      document.querySelectorAll('[data-updated-at]').forEach((element) => {
        const timestamp = Date.parse(element.dataset.updatedAt);
        if (!Number.isFinite(timestamp)) {
          element.textContent = element.dataset.updatedPrefix + 'Never';
          return;
        }
        element.textContent = element.dataset.updatedPrefix + formatDateTime(new Date(timestamp)) +
          '; ' + formatElapsed(timestamp);
      });
      let cooldownExpired = false;
      document.querySelectorAll('[data-countdown-to]').forEach((element) => {
        const wasDue = element.dataset.wasDue === '1';
        const label = formatCountdown(element.dataset.countdownTo);
        element.textContent = (element.dataset.countdownPrefix || '') + label;
        const isDue = label === 'Due now' || label === 'Ready now';
        // If a rate-limit cooldown just expired, refresh so the stale box clears
        if (isDue && !wasDue && (element.dataset.countdownPrefix || '').includes('cooldown')) {
          cooldownExpired = true;
        }
        element.dataset.wasDue = isDue ? '1' : '';
      });
      if (cooldownExpired && !state.cooldownRefreshPending) {
        state.cooldownRefreshPending = true;
        refreshData().finally(() => { state.cooldownRefreshPending = false; });
      }
    }

    async function request(path, options) {
      const response = await fetch(path, options);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Request failed (HTTP ' + response.status + ')');
      return body;
    }

    function runTriggerLabel(run) {
      return {
        cron: 'Hourly cron',
        admin_sync_all: 'Sync all',
        stale_check: 'Stale check',
        manual: 'Single update'
      }[run.trigger] || run.trigger || 'Sync';
    }

    function runProviderName(providerId) {
      return state.providers.find((p) => p.id === providerId)?.name || providerId;
    }

    function buildRunProviderList(run) {
      const entries = run.summary?.providers;
      if (!Array.isArray(entries) || !entries.length) return null;
      const list = document.createElement('div');
      list.className = 'auto-sync-meta';
      entries.forEach((entry) => {
        const line = document.createElement('div');
        if (run.status === 'running') {
          const catLabel = entry.lastCategory ? (categories.find((c) => c.id === entry.lastCategory)?.label || entry.lastCategory) : '';
          line.textContent = runProviderName(entry.provider) + ' ' + entry.pairs + '/' + categories.length +
            (entry.lastStatus ? ' · last: ' + entry.lastStatus + (catLabel ? ' (' + catLabel + ')' : '') : '');
        } else {
          // Runs closed mid-flight (e.g. by Unstick-all) keep the
          // in-progress summary shape, which has lastStatus instead of
          // status and no storiesSaved — fall back so they never render
          // as "undefined".
          line.textContent = runProviderName(entry.provider) + ' ' + (entry.status ?? entry.lastStatus ?? 'unknown') +
            (entry.storiesSaved != null ? ' · ' + entry.storiesSaved + ' saved' : '');
        }
        list.append(line);
      });
      return list;
    }

    function buildRunStrip() {
      const runs = state.runs || [];
      if (!runs.length) return null;
      const active = runs.find((r) => r.status === 'running');
      const strip = document.createElement('div');
      strip.className = 'auto-sync-bar';
      const info = document.createElement('div');
      info.className = 'auto-sync-info';
      const title = document.createElement('div');
      title.className = 'auto-sync-title';
      const meta = document.createElement('div');
      meta.className = 'auto-sync-meta tabular-nums';
      if (active) {
        title.textContent = '🔄 Live run: ' + runTriggerLabel(active) + (active.provider ? ' · ' + runProviderName(active.provider) : '');
        const parts = [];
        if (active.pairs_total) parts.push(active.pairs_done + '/' + active.pairs_total + ' pairs');
        if (active.current_provider) {
          const catLabel = categories.find((c) => c.id === active.current_category)?.label || active.current_category || '';
          parts.push('now: ' + runProviderName(active.current_provider) + (catLabel ? ' / ' + catLabel : ''));
        }
        if (active.last_activity_at) parts.push('last activity ' + formatElapsed(Date.parse(active.last_activity_at)));
        const t = active.last_telemetry || {};
        if (t.rateLimitRemaining != null) parts.push('remaining: ' + t.rateLimitRemaining);
        if (t.rateLimitReset) parts.push('reset: ' + formatDateTime(new Date(t.rateLimitReset)));
        meta.textContent = parts.join(' · ') || 'Starting…';
      } else {
        const last = runs[0];
        title.textContent = 'Last run: ' + runTriggerLabel(last) + (last.provider ? ' · ' + runProviderName(last.provider) : '') + ' · ' + last.status;
        const saved = last.summary?.totalStoriesSaved ?? last.summary?.storiesSaved ?? null;
        meta.textContent = (saved !== null ? saved + ' stories saved · ' : '') +
          formatDateTime(new Date(last.finished_at || last.started_at));
      }
      info.append(title, meta);
      const providerList = buildRunProviderList(active || runs[0]);
      if (providerList) info.append(providerList);
      strip.append(info);
      return strip;
    }

    function openProviderProfile(providerId) {
      state.providerProfileId = providerId;
      state.providerProfile = { status: 'loading' };
      renderProviders(state.providers || []);
      request('/admin/api/providers/' + encodeURIComponent(providerId) + '/profile')
        .then((data) => {
          if (state.providerProfileId !== providerId) return;
          state.providerProfile = { status: 'ready', data: data };
          renderProviders(state.providers || []);
        })
        .catch(() => {
          if (state.providerProfileId !== providerId) return;
          state.providerProfile = { status: 'error' };
          renderProviders(state.providers || []);
        });
    }

    function closeProviderProfile() {
      state.providerProfileId = null;
      state.providerProfile = null;
      renderProviders(state.providers || []);
    }

    function buildProviderProfileView() {
      const wrap = document.createElement('div');
      wrap.className = 'provider-profile';
      const backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.className = 'secondary small-btn';
      backBtn.textContent = '← Providers';
      backBtn.addEventListener('click', closeProviderProfile);
      wrap.append(backBtn);
      const profile = state.providerProfile || { status: 'loading' };
      if (profile.status === 'loading') {
        const loading = document.createElement('p');
        loading.className = 'muted';
        loading.textContent = 'Loading profile…';
        wrap.append(loading);
        return wrap;
      }
      if (profile.status !== 'ready' || !profile.data) {
        const err = document.createElement('p');
        err.className = 'muted';
        err.textContent = 'Could not load this provider profile.';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'secondary small-btn';
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => openProviderProfile(state.providerProfileId));
        wrap.append(err, retry);
        return wrap;
      }
      const data = profile.data;
      const p = data.provider;
      const title = document.createElement('h2');
      title.textContent = p.label || p.id;
      wrap.append(title);
      const refreshBtn = document.createElement('button');
      refreshBtn.type = 'button';
      refreshBtn.className = 'secondary small-btn';
      refreshBtn.textContent = 'Refresh';
      refreshBtn.addEventListener('click', () => openProviderProfile(p.id));
      wrap.append(refreshBtn);
      const addSection = (heading) => {
        const h = document.createElement('h3');
        h.textContent = heading;
        wrap.append(h);
      };
      const addLine = (label, value) => {
        if (value == null || value === '') return;
        const line = document.createElement('p');
        line.className = 'provider-profile-line';
        line.textContent = label + ': ' + value;
        wrap.append(line);
      };
      const catLabel = (id) => categories.find((c) => c.id === id)?.label || id;
      addSection('Info');
      addLine('Adapter', p.adapter);
      addLine('Endpoint', p.endpoint);
      addLine('Categories', (p.categories || []).map(catLabel).join(', '));
      addLine('API key', p.credentialName
        ? (p.credentialConfigured ? 'Configured' : 'Set Worker secret: ' + p.credentialName)
        : 'No API key required');
      if (p.updatePauseMs > 0) addLine('Pause between topics', (p.updatePauseMs / 1000) + 's');
      addLine('Status', p.status);
      addLine('Last success', p.lastSuccessAt ? formatDateTime(new Date(p.lastSuccessAt)) : '');
      addLine('Last error', p.lastError);
      addLine('Cooldown until', p.cooldownUntil ? formatDateTime(new Date(p.cooldownUntil)) : '');
      addLine('Rate-limit reset', p.rateLimitResetAt ? formatDateTime(new Date(p.rateLimitResetAt)) : '');
      addLine('Stories saved last run', p.storiesSavedLastRun);
      addSection('Live status');
      const live = data.live || {};
      addLine('Running', live.running ? 'Yes' : 'No');
      if (live.activeRun) {
        if (live.isCurrentPair && live.activeRun.currentCategory) {
          addLine('Current pair', catLabel(live.activeRun.currentCategory));
        }
        addLine('Pairs done', live.pairsDone + '/' + live.pairsTotal);
        addLine('Run started', live.activeRun.startedAt ? formatDateTime(new Date(live.activeRun.startedAt)) : '');
        addLine('Last activity', live.activeRun.lastActivityAt ? formatDateTime(new Date(live.activeRun.lastActivityAt)) : '');
      } else if (live.running) {
        addLine('Note', 'Claim held but no live run row — possibly stuck');
      }
      addSection('Last runs');
      if (!data.lastRuns || !data.lastRuns.length) {
        const none = document.createElement('p');
        none.className = 'muted';
        none.textContent = 'No runs recorded yet.';
        wrap.append(none);
      } else {
        data.lastRuns.forEach((run) => {
          const line = document.createElement('p');
          line.className = 'provider-profile-line';
          line.textContent = formatDateTime(new Date(run.finishedAt || run.startedAt)) + ' · ' +
            runTriggerLabel(run) + ' · ' + (run.providerStatus || 'unknown') +
            (run.storiesSaved != null ? ' · ' + run.storiesSaved + ' saved' : '') +
            (run.lastCategory ? ' (' + catLabel(run.lastCategory) + ')' : '');
          wrap.append(line);
        });
      }
      addSection('Lifetime totals (last 30 days)');
      if (!data.lifetime) {
        const none = document.createElement('p');
        none.className = 'muted';
        none.textContent = 'Lifetime totals unavailable.';
        wrap.append(none);
      } else {
        addLine('Requests', data.lifetime.totalRequests);
        addLine('Fetched', data.lifetime.fetched);
        addLine('Saved', data.lifetime.saved);
        addLine('Succeeded', data.lifetime.succeeded);
        addLine('Failed', data.lifetime.failed);
        addLine('Rate-limited', data.lifetime.rateLimited);
        addLine('Last success', data.lifetime.lastSuccessAt ? formatDateTime(new Date(data.lifetime.lastSuccessAt)) : '');
        if (data.lifetime.truncated) {
          const note = document.createElement('p');
          note.className = 'muted';
          note.textContent = 'Totals capped at 10,000 requests — counts may be incomplete.';
          wrap.append(note);
        }
      }
      addSection('Recent requests');
      if (!data.recentLogs || !data.recentLogs.length) {
        const none = document.createElement('p');
        none.className = 'muted';
        none.textContent = 'No recent requests.';
        wrap.append(none);
      } else {
        data.recentLogs.forEach((log) => {
          const line = document.createElement('p');
          line.className = 'provider-profile-line tabular-nums';
          line.textContent = formatDateTime(new Date(log.created_at)) + ' · ' + catLabel(log.category || 'all') +
            ' · ' + (log.trigger_source || '') + ' · ' + log.status +
            ' · fetched ' + (log.items_fetched || 0) + ', saved ' + (log.stories_saved || 0) +
            (log.error_message ? ' · ' + log.error_message : '');
          wrap.append(line);
        });
      }
      return wrap;
    }

    function renderProviders(providers) {
      providersEl.replaceChildren();

      const runStrip = buildRunStrip();
      if (runStrip) providersEl.append(runStrip);

      const autoBar = document.createElement('div');
      autoBar.className = 'auto-sync-bar';
      const autoInfo = document.createElement('div');
      autoInfo.className = 'auto-sync-info';
      const autoTitle = document.createElement('div');
      autoTitle.className = 'auto-sync-title';
      autoTitle.textContent = 'Hourly Auto-Querying: ';
      const autoBadge = document.createElement('span');
      autoBadge.className = 'status ' + (state.autoSync?.enabled ? 'status-succeeded' : 'status-partial');
      autoBadge.textContent = state.autoSync?.enabled ? 'Active · Every 1 hour' : 'Paused';
      autoTitle.append(autoBadge);

      const autoMeta = document.createElement('div');
      autoMeta.className = 'auto-sync-meta tabular-nums';
      const lastRunStr = state.autoSync?.lastRunAt
        ? formatDateTime(new Date(state.autoSync.lastRunAt)) + ' (' + (state.autoSync.lastTrigger || 'auto') + ')'
        : 'Never';
      autoMeta.textContent = 'Cron: 0 * * * * · Last cycle: ' + lastRunStr + ' · ';
      if (state.autoSync?.enabled) {
        const nextSpan = document.createElement('span');
        nextSpan.dataset.countdownPrefix = 'Next cycle in ';
        nextSpan.dataset.countdownTo = state.autoSync.nextRunAt || '';
        nextSpan.textContent = 'Next cycle in ' + formatCountdown(state.autoSync.nextRunAt);
        autoMeta.append(nextSpan);
      } else {
        autoMeta.append('Auto-sync paused');
      }
      if (state.autoSync?.lastSummary) {
        const sumLine = document.createElement('div');
        sumLine.className = 'auto-sync-meta';
        sumLine.textContent = state.autoSync.lastSummary;
        autoInfo.append(autoTitle, autoMeta, sumLine);
      } else {
        autoInfo.append(autoTitle, autoMeta);
      }

      const autoActions = document.createElement('div');
      autoActions.className = 'auto-sync-actions';
      const toggleAutoBtn = document.createElement('button');
      toggleAutoBtn.id = 'toggle-auto-sync';
      toggleAutoBtn.type = 'button';
      toggleAutoBtn.className = 'secondary small-btn';
      toggleAutoBtn.disabled = state.togglingAutoSync;
      toggleAutoBtn.textContent = state.autoSync?.enabled ? 'Pause hourly sync' : 'Enable hourly sync';
      toggleAutoBtn.addEventListener('click', toggleHourlyAutoSync);

      const syncAllBtn = document.createElement('button');
      syncAllBtn.id = 'sync-all-providers';
      syncAllBtn.type = 'button';
      syncAllBtn.className = 'small-btn';
      syncAllBtn.disabled = state.syncingAll;
      syncAllBtn.textContent = state.syncingAll ? 'Syncing all…' : 'Sync all providers now';
      syncAllBtn.addEventListener('click', syncAllProvidersNow);

      const unstickAllBtn = document.createElement('button');
      unstickAllBtn.id = 'unstick-all-providers';
      unstickAllBtn.type = 'button';
      unstickAllBtn.className = 'secondary small-btn';
      unstickAllBtn.disabled = state.unstickingAll || (!state.providers.some((p) => p.status === 'running') && !(state.runs || []).some((r) => r.status === 'running'));
      unstickAllBtn.textContent = state.unstickingAll ? 'Unsticking…' : 'Unstick all';
      unstickAllBtn.addEventListener('click', unstickAllProviders);

      autoActions.append(toggleAutoBtn, syncAllBtn, unstickAllBtn);
      autoBar.append(autoInfo, autoActions);
      providersEl.append(autoBar);

      if (state.providerProfileId) {
        providersEl.append(buildProviderProfileView());
        return;
      }

      providers.forEach((provider) => {
        const card = document.createElement('article');
        card.className = 'provider';
        const head = document.createElement('div');
        head.className = 'provider-head';
        const title = document.createElement('h2');
        title.textContent = provider.name;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'small-btn';
        button.textContent = state.busy.has(provider.id) ? 'Updating…' : 'Update';
        button.disabled = state.busy.has(provider.id) || provider.status === 'running' || !provider.configured;
        button.addEventListener('click', () => updateProvider(provider.id));
        const profileButton = document.createElement('button');
        profileButton.type = 'button';
        profileButton.className = 'secondary small-btn';
        profileButton.textContent = 'Profile';
        profileButton.addEventListener('click', () => openProviderProfile(provider.id));
        head.append(title, button, profileButton);
        if (provider.status === 'running') {
          const resetButton = document.createElement('button');
          resetButton.type = 'button';
          resetButton.className = 'small-btn';
          resetButton.textContent = 'Reset stuck run';
          resetButton.disabled = state.busy.has(provider.id);
          resetButton.addEventListener('click', () => resetProviderSync(provider.id));
          head.append(resetButton);
        }
        const description = document.createElement('p');
        description.className = 'provider-description muted';
        description.textContent = provider.description || '';
        const coverage = document.createElement('p');
        coverage.className = 'provider-coverage muted';
        const topics = (provider.categories || []).map((id) => (
          categories.find((category) => category.id === id)?.label || id
        ));
        const pauseSeconds = Number(provider.update_pause_ms) / 1000;
        coverage.textContent = 'Topics: ' + topics.join(', ') +
          (Number.isFinite(pauseSeconds) && pauseSeconds > 0
            ? ' · ' + pauseSeconds + 's between topic requests'
            : '');
        const setup = document.createElement('p');
        setup.className = 'provider-setup ' + (provider.configured ? 'configured' : 'missing');
        setup.textContent = provider.credential_name
          ? provider.configured
            ? 'API key configured'
            : 'Set Worker secret: ' + provider.credential_name
          : 'No API key required';
        const status = document.createElement('p');
        status.append('Status: ');
        const statusValue = document.createElement('span');
        statusValue.className = 'status status-' + String(provider.status).toLowerCase();
        statusValue.textContent = text(provider.status);
        status.append(statusValue);
        // A stuck run and a healthy in-progress run used to look identical
        // (both just "running"). Surface when the run started and the last
        // recorded error so a wedged provider is visible, not silent.
        const statusExtras = [];
        if (provider.status === 'running' && provider.started_at) {
          const startedMs = Date.parse(provider.started_at);
          const runningSince = document.createElement('p');
          runningSince.className = 'provider-running-since muted';
          runningSince.textContent = 'Running since: ' + (Number.isFinite(startedMs)
            ? formatDateTime(new Date(startedMs)) + '; ' + formatElapsed(startedMs)
            : provider.started_at);
          statusExtras.push(runningSince);
        }
        const activeRunForCard = (state.runs || []).find((r) => r.status === 'running' && r.current_provider === provider.id);
        if (activeRunForCard?.current_category) {
          const fetching = document.createElement('p');
          fetching.className = 'provider-running-since muted';
          fetching.textContent = 'Fetching: ' + (categories.find((c) => c.id === activeRunForCard.current_category)?.label || activeRunForCard.current_category);
          statusExtras.push(fetching);
        }
        if (provider.last_error) {
          const lastError = document.createElement('p');
          lastError.className = 'provider-last-error muted';
          lastError.textContent = 'Last error: ' + provider.last_error;
          statusExtras.push(lastError);
        }
        const updated = document.createElement('p');
        updated.className = 'provider-updated';
        updated.dataset.updatedPrefix = 'Last updated: ';
        updated.dataset.updatedAt = provider.last_success_at || '';
        const saved = document.createElement('p');
        saved.textContent = 'Stories saved last run: ' + text(provider.stories_saved);
        const totalSaved = document.createElement('p');
        totalSaved.textContent = 'Total stories saved: ' + text(provider.total_stories_saved);
        card.append(head, description, coverage, setup, status, updated, saved, totalSaved);
        if (statusExtras.length) status.after(...statusExtras);

        if (provider.cooldown_until && Date.parse(provider.cooldown_until) > Date.now()) {
          const cooldownBox = document.createElement('div');
          cooldownBox.className = 'cooldown-callout tabular-nums';
          const timerLine = document.createElement('div');
          timerLine.dataset.countdownPrefix = 'Rate-limit cooldown active · Resets in ';
          timerLine.dataset.countdownTo = provider.cooldown_until;
          timerLine.textContent = 'Rate-limit cooldown active · Resets in ' + formatCountdown(provider.cooldown_until);
          cooldownBox.append(timerLine);
          if (provider.failover_provider) {
            const foLine = document.createElement('div');
            foLine.textContent = 'Failover active: remaining topics routed to ' + provider.failover_provider +
              (Array.isArray(provider.failover_categories) && provider.failover_categories.length
                ? ' (' + provider.failover_categories.join(', ') + ')'
                : '');
            cooldownBox.append(foLine);
          }
          const forceBtn = document.createElement('button');
          forceBtn.type = 'button';
          forceBtn.className = 'secondary small-btn';
          forceBtn.style.marginTop = '.35rem';
          forceBtn.textContent = 'Force retry now';
          forceBtn.disabled = state.busy.has(provider.id);
          forceBtn.addEventListener('click', () => updateProvider(provider.id, true));
          cooldownBox.append(forceBtn);
          card.append(cooldownBox);
        }

        if (provider.last_failed_call || provider.last_error) {
          const errBox = document.createElement('div');
          errBox.className = 'provider-error-box';
          const failed = provider.last_failed_call || {};

          const errTitle = document.createElement('div');
          errTitle.className = 'provider-error-title';
          errTitle.textContent = failed.status === 'rate_limited'
            ? '⚠ Rate limited'
            : failed.status === 'skipped_cooldown'
              ? '⏸ Skipped (cooldown)'
              : '⚠ Last error';
          errBox.append(errTitle);

          const addErrRow = (label, value) => {
            if (value == null || value === '') return;
            const row = document.createElement('div');
            row.className = 'provider-error-row tabular-nums';
            const k = document.createElement('span');
            k.className = 'provider-error-key muted';
            k.textContent = label + ': ';
            const v = document.createElement('span');
            v.textContent = String(value);
            row.append(k, v);
            errBox.append(row);
          };

          addErrRow('Provider', provider.name || provider.id);
          addErrRow('Interest', failed.category || 'all');
          if (failed.requestUrl) {
            // Split endpoint from query string for readability
            let endpoint = failed.requestUrl;
            let query = '';
            try {
              const u = new URL(failed.requestUrl);
              endpoint = u.origin + u.pathname;
              query = u.search ? u.search.slice(1) : '';
            } catch { /* not a valid URL, show as-is */ }
            addErrRow('API call', endpoint);
            if (query) addErrRow('Query', decodeURIComponent(query).slice(0, 300));
          }
          if (failed.httpStatus) addErrRow('HTTP', failed.httpStatus);
          const rlBits = [];
          if (failed.retryAfterSeconds != null) rlBits.push('retry-after ' + failed.retryAfterSeconds + 's');
          if (failed.rateLimitRemaining != null) rlBits.push('remaining ' + failed.rateLimitRemaining);
          if (failed.rateLimitReset) rlBits.push('resets ' + failed.rateLimitReset);
          if (rlBits.length) addErrRow('Rate limit', rlBits.join(' · '));
          if (failed.failoverProvider) {
            addErrRow('Failover', 'remaining topics routed to ' + failed.failoverProvider);
          }
          if (failed.errorMessage && failed.errorMessage !== provider.last_error) {
            addErrRow('Detail', failed.errorMessage.slice(0, 300));
          } else if (provider.last_error) {
            addErrRow('Detail', String(provider.last_error).slice(0, 300));
          }
          if (failed.createdAt) {
            addErrRow('When', formatElapsed(Date.parse(failed.createdAt)) + ' ago');
          }
          card.append(errBox);
        }
        providersEl.append(card);
      });
    }

    function renderCategoryTabs() {
      categoryEl.replaceChildren();
      categories.forEach((category) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'category-tab';
        button.setAttribute('aria-pressed', String(state.activeCategory === category.id));
        button.textContent = category.icon + ' ' + category.label;
        button.addEventListener('click', () => {
          state.activeCategory = category.id;
          state.pages.pending = 1;
          renderCategoryTabs();
          renderStories(state.pendingStories, { pending: true });
        });
        categoryEl.append(button);
      });
    }

    function renderHistoryCategoryTabs() {
      historyCategoryEl.replaceChildren();
      categories.forEach((category) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'category-tab';
        button.setAttribute('aria-pressed', String(state.activeHistoryCategory === category.id));
        button.textContent = category.icon + ' ' + category.label;
        button.addEventListener('click', () => {
          state.activeHistoryCategory = category.id;
          state.pages.decided = 1;
          renderHistoryCategoryTabs();
          renderStories(state.decidedStories, { decided: true });
        });
        historyCategoryEl.append(button);
      });
    }

    function renderAdsCategoryTabs() {
      adsCategoriesEl.replaceChildren();
      categories.forEach((category) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'category-tab';
        button.setAttribute('aria-pressed', String(state.activeAdCategory === category.id));
        button.textContent = category.icon + ' ' + category.label;
        button.addEventListener('click', () => {
          state.activeAdCategory = category.id;
          state.pages.ads = 1;
          renderAdsCategoryTabs();
          filterAndRenderAds();
        });
        adsCategoriesEl.append(button);
      });
    }

    function renderProviderFilter() {
      const selectedProvider = state.activeProvider;
      providerFilterEl.replaceChildren();
      const allOption = document.createElement('option');
      allOption.value = 'all';
      allOption.textContent = 'All providers';
      providerFilterEl.append(allOption);
      state.providers.forEach((provider) => {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.name;
        providerFilterEl.append(option);
      });
      state.activeProvider = state.providers.some(provider => provider.id === selectedProvider)
        ? selectedProvider
        : 'all';
      providerFilterEl.value = state.activeProvider;

      const selectedHistoryProvider = state.activeHistoryProvider;
      historyProviderFilterEl.replaceChildren();
      const allHistOption = document.createElement('option');
      allHistOption.value = 'all';
      allHistOption.textContent = 'All providers';
      historyProviderFilterEl.append(allHistOption);
      state.providers.forEach((provider) => {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.name;
        historyProviderFilterEl.append(option);
      });
      state.activeHistoryProvider = state.providers.some(provider => provider.id === selectedHistoryProvider)
        ? selectedHistoryProvider
        : 'all';
      historyProviderFilterEl.value = state.activeHistoryProvider;
    }

    function attachSmoothImageLoader(imgEl, wrapEl = null, fallbackSrc = '') {
      imgEl.decoding = 'async';
      const markLoaded = () => {
        imgEl.classList.add('is-loaded');
        if (wrapEl) wrapEl.classList.add('is-loaded');
      };
      imgEl.addEventListener('load', markLoaded);
      imgEl.addEventListener('error', () => {
        if (fallbackSrc && imgEl.src !== fallbackSrc && !imgEl.src.endsWith(fallbackSrc)) {
          imgEl.src = fallbackSrc;
        } else {
          markLoaded();
        }
      });
      if (imgEl.complete && imgEl.naturalWidth > 0) {
        markLoaded();
      }
    }

    function createStoryCardRow(story, { pending = false, decided = false, banned = false, isSearch = false } = {}) {
      const row = document.createElement('article');
      row.className = 'story';
      row.tabIndex = 0;
      row.setAttribute('aria-label', 'Edit story: ' + decodeHtmlEntities(story.title));
      row.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        openStoryPreview(story);
      });
      row.addEventListener('keydown', (event) => {
        if (event.target === row && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          openStoryPreview(story);
        }
      });
      const fallbackImg = 'img/' + (story.category || 'all') + '_1.jpg';
      const image = document.createElement('img');
      image.src = story.image || fallbackImg;
      image.alt = '';
      image.loading = 'lazy';
      attachSmoothImageLoader(image, null, fallbackImg);
      row.append(image);
      const title = document.createElement('h3');
      const link = document.createElement('a');
      link.href = decodeHtmlEntities(story.link);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = decodeHtmlEntities(story.title);
      link.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openStoryPreview(story);
      });
      title.append(link);
      const meta = document.createElement('p');
      meta.className = 'story-meta';
      [
        ['meta-provider', story.provider || 'unknown'],
        ['meta-domain', getStoryDomain(story.link)],
        ['meta-category', categories.find((category) => category.id === story.category)?.label || story.category],
      ].forEach(([className, value]) => {
        const item = document.createElement('span');
        item.className = className;
        item.textContent = value;
        meta.append(item);
      });
      const updated = document.createElement('span');
      updated.className = 'meta-date';
      updated.dataset.updatedPrefix = 'Last updated: ';
      updated.dataset.updatedAt = story.updatedAt || story.pubDate || '';
      meta.append(updated);

      if (isSearch || decided) {
        const statusSpan = document.createElement('span');
        statusSpan.className = 'meta-badge-status ' + (story.removed ? 'meta-banned' : story.approved ? 'meta-approved' : 'meta-pending');
        statusSpan.textContent = story.removed ? 'Banned' : story.approved ? 'Approved' : 'Pending';
        meta.append(statusSpan);
      }

      // Content keywords badge (interest tags)
      const storyKws = story.interest_keywords || story.interestKeywords || [];
      if (Array.isArray(storyKws) && storyKws.length > 0) {
        const kwSpan = document.createElement('span');
        kwSpan.className = 'meta-badge-status meta-approved';
        kwSpan.setAttribute('data-kw-badge', '1');
        kwSpan.textContent = '🔖 ' + storyKws.join(', ');
        kwSpan.title = 'Content keywords';
        meta.append(kwSpan);
      }

      const details = document.createElement('div');
      details.className = 'story-details';
      details.append(title, meta);
      if (decided) {
        const decision = document.createElement('p');
        decision.className = 'decision-note';
        const actionLabels = {
          approve: 'Approved',
          disapprove: 'Disapproved',
          unapprove: 'Disapproved',
          ban: 'Banned from the site',
          undo: 'Undid the previous decision'
        };
        decision.textContent = (actionLabels[story.decisionAction] || 'Decision updated') +
          ' · ' + (story.decisionBy ? '@' + story.decisionBy : 'admin');
        details.append(decision);
      }
      const main = document.createElement('div');
      main.className = 'story-main';
      main.append(details);
      row.append(main);

      const actions = document.createElement('div');
      actions.className = 'story-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'secondary small-btn';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openStoryPreview(story);
      });
      actions.append(editBtn);

      const linkBtn = document.createElement('button');
      linkBtn.type = 'button';
      linkBtn.className = 'secondary small-btn';
      linkBtn.textContent = '🔗 Copy link';
      linkBtn.title = 'Copy the frontpage expanded-view link for this story';
      linkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyFrontpageStoryLink(linkBtn, story);
      });
      actions.append(linkBtn);

      // Auto-tag button (search results): classify on-demand, save, update live
      if (isSearch) {
        const tagBtn = document.createElement('button');
        tagBtn.type = 'button';
        tagBtn.className = 'secondary small-btn';
        tagBtn.textContent = '🏷️ Tag';
        tagBtn.title = 'Auto-tag with interest keywords';
        tagBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          tagBtn.disabled = true;
          tagBtn.textContent = 'Tagging...';
          try {
            const res = await fetch('/admin/api/stories/auto-tag', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: story.id })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Tag failed');
            // Update story object and refresh the keywords badge live
            const kws = data.keywords || [];
            story.interest_keywords = kws;
            story.interestKeywords = kws;
            // Remove old badge if present, add new one
            const oldBadge = meta.querySelector('[data-kw-badge]');
            if (oldBadge) oldBadge.remove();
            if (kws.length > 0) {
              const kwSpan = document.createElement('span');
              kwSpan.className = 'meta-badge-status meta-approved';
              kwSpan.setAttribute('data-kw-badge', '1');
              kwSpan.textContent = '🔖 ' + kws.join(', ');
              kwSpan.title = 'Content keywords';
              meta.append(kwSpan);
              tagBtn.textContent = '✓ Tagged';
            } else {
              // No matches — show diagnostic
              const diag = data.diagnostic || {};
              tagBtn.textContent = 'No match';
              tagBtn.title = 'Text: ' + (diag.textLength || 0) + ' chars, Vectors: ' + (diag.keywordVectorsCount || 0);
            }
            setTimeout(() => { tagBtn.textContent = '🏷️ Tag'; tagBtn.disabled = false; }, 3000);
          } catch (err) {
            tagBtn.textContent = 'Error';
            setTimeout(() => { tagBtn.textContent = '🏷️ Tag'; tagBtn.disabled = false; }, 2000);
          }
        });
        actions.append(tagBtn);
      }

      if (pending) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'small-btn';
        button.textContent = state.approving.has(story.id) ? 'Approving…' : 'Approve';
        button.disabled = state.approving.has(story.id);
        button.addEventListener('click', () => approveStory(story.id));
        const disapproveButton = document.createElement('button');
        disapproveButton.type = 'button';
        disapproveButton.className = 'secondary small-btn';
        disapproveButton.textContent = state.unapproving.has(story.id) ? 'Disapproving…' : 'Disapprove';
        disapproveButton.disabled = state.unapproving.has(story.id);
        disapproveButton.addEventListener('click', () => disapproveStory(story.id));
        const ignoreButton = document.createElement('button');
        ignoreButton.type = 'button';
        ignoreButton.className = 'secondary small-btn';
        ignoreButton.textContent = 'Ignore';
        ignoreButton.addEventListener('click', () => {
          state.ignored.add(story.id);
          renderStories(state.pendingStories, { pending: true });
        });
        const banButton = document.createElement('button');
        banButton.type = 'button';
        banButton.className = 'secondary small-btn';
        banButton.textContent = state.banning.has(story.id) ? 'Banning…' : 'Ban';
        banButton.disabled = state.banning.has(story.id);
        banButton.addEventListener('click', () => banStory(story.id));
        actions.append(button, disapproveButton, ignoreButton, banButton);
      } else {
        if (!story.approved && !story.removed) {
          const approveBtn = document.createElement('button');
          approveBtn.type = 'button';
          approveBtn.className = 'small-btn';
          approveBtn.textContent = state.approving.has(story.id) ? 'Approving…' : 'Approve';
          approveBtn.disabled = state.approving.has(story.id);
          approveBtn.addEventListener('click', () => approveStory(story.id));
          actions.append(approveBtn);
        }
        if (story.approved && !story.removed) {
          const disapproveButton = document.createElement('button');
          disapproveButton.type = 'button';
          disapproveButton.className = 'secondary small-btn';
          disapproveButton.textContent = state.unapproving.has(story.id) ? 'Disapproving…' : 'Disapprove';
          disapproveButton.disabled = state.unapproving.has(story.id);
          disapproveButton.addEventListener('click', () => disapproveStory(story.id));
          actions.append(disapproveButton);
        }
        if (!story.removed) {
          const banButton = document.createElement('button');
          banButton.type = 'button';
          banButton.className = 'secondary small-btn';
          banButton.textContent = state.banning.has(story.id) ? 'Banning…' : 'Ban';
          banButton.disabled = state.banning.has(story.id);
          banButton.addEventListener('click', () => banStory(story.id));
          actions.append(banButton);
        }
      }
      if (
        (decided || banned) &&
        typeof story.previousApproved === 'boolean' &&
        typeof story.previousRemoved === 'boolean' &&
        !state.undoing.has(story.id)
      ) {
        const undoButton = document.createElement('button');
        undoButton.type = 'button';
        undoButton.className = 'secondary small-btn';
        undoButton.textContent = 'Undo';
        undoButton.addEventListener('click', () => undoDecision(story.id));
        actions.append(undoButton);
      } else if ((decided || banned) && state.undoing.has(story.id)) {
        const undoButton = document.createElement('button');
        undoButton.type = 'button';
        undoButton.className = 'secondary small-btn';
        undoButton.textContent = 'Undoing…';
        undoButton.disabled = true;
        actions.append(undoButton);
      }
      row.append(actions);
      return row;
    }

    function renderStories(stories, { pending = false, decided = false, banned = false } = {}) {
      const containerId = pending ? 'pending-stories' : banned ? 'banned-stories' : 'stories';
      const paginationId = pending ? 'pending-pagination' : banned ? 'banned-pagination' : 'decided-pagination';
      const listKey = pending ? 'pending' : banned ? 'banned' : 'decided';
      const container = document.getElementById(containerId);
      container.replaceChildren();
      const visibleStories = pending
        ? stories.filter((story) =>
          !state.ignored.has(story.id) &&
          (state.activeCategory === 'all' || story.category === state.activeCategory) &&
          (state.activeProvider === 'all' || story.provider === state.activeProvider))
        : decided
          ? stories.filter((story) =>
            (state.activeHistoryCategory === 'all' || story.category === state.activeHistoryCategory) &&
            (state.activeHistoryProvider === 'all' || story.provider === state.activeHistoryProvider))
          : stories;

      const pager = renderPaginationBar(paginationId, listKey, visibleStories.length, () => {
        renderStories(stories, { pending, decided, banned });
        refreshStoryAges();
      });

      const pagedStories = pager.slice(visibleStories);
      pagedStories.forEach((story) => {
        container.append(createStoryCardRow(story, { pending, decided, banned }));
      });
      if (!visibleStories.length) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = pending && state.activeProvider !== 'all'
          ? 'No stories awaiting approval from this provider in the selected category.'
          : pending && state.activeCategory !== 'all'
            ? 'No pending stories in this category.'
          : pending
            ? 'No stories awaiting approval.'
            : banned
              ? 'No banned stories.'
            : decided
              ? 'No stories in history match the current filters.'
            : 'No stories have been saved yet.';
        container.append(empty);
      }
    }

    /* STORY SEARCH WITH PAGINATION */
    function renderStorySearchMatches(matched, q) {
      storySearchResultsEl.replaceChildren();
      storySearchCountEl.style.display = 'block';
      storySearchCountEl.textContent = 'Found ' + matched.length + ' matching stories for "' + q + '":';

      const pager = renderPaginationBar('search-pagination', 'search', matched.length, () => {
        renderStorySearchMatches(matched, q);
        refreshStoryAges();
      });

      if (!matched.length) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'No matching stories found.';
        storySearchResultsEl.append(empty);
        return;
      }

      pager.slice(matched).forEach((story) => {
        storySearchResultsEl.append(createStoryCardRow(story, { isSearch: true }));
      });
      refreshStoryAges();
    }

    function doesStoryMatchQuery(story, q) {
      if (!story || !q) return false;
      const matchTitle = (story.title || '').toLowerCase().includes(q);
      const matchDesc = (story.description || '').toLowerCase().includes(q);
      const matchContent = (story.content || '').toLowerCase().includes(q);
      const matchSummary = (story.aiSummary || '').toLowerCase().includes(q);
      const matchSource = (story.source || '').toLowerCase().includes(q);
      const matchDomain = getStoryDomain(story.link).toLowerCase().includes(q);
      const matchCat = (story.category || '').toLowerCase().includes(q);
      const matchProvider = (story.provider || '').toLowerCase().includes(q);
      return Boolean(matchTitle || matchDesc || matchContent || matchSummary || matchSource || matchDomain || matchCat || matchProvider);
    }

    function applyStoryPatchAcrossAllLists(storyId, patch) {
      if (storyId == null || !patch) return;
      const numId = Number(storyId);
      const collections = [
        state.pendingStories,
        state.decidedStories,
        state.bannedStories,
        state.searchResults,
        state.aiCuration?.stagedPicks,
        state.aiCuration?.recentCuratedPicks
      ];
      collections.forEach((list) => {
        if (!Array.isArray(list)) return;
        list.forEach((item) => {
          if (item && Number(item.id) === numId) {
            Object.assign(item, patch);
          }
        });
      });
    }

    function syncSearchResultsWithKnownLists() {
      if (!Array.isArray(state.searchResults) || !state.searchResults.length) return;
      const freshById = new Map();
      const freshByLink = new Map();
      [
        ...(state.aiCuration?.stagedPicks || []),
        ...state.pendingStories,
        ...state.decidedStories,
        ...state.bannedStories
      ].forEach((story) => {
        if (!story) return;
        if (story.id != null) freshById.set(Number(story.id), story);
        if (story.link) freshByLink.set(story.link, story);
      });
      state.searchResults.forEach((searchItem) => {
        if (!searchItem) return;
        const fresh = (searchItem.id != null && freshById.get(Number(searchItem.id))) ||
          (searchItem.link && freshByLink.get(searchItem.link));
        if (fresh) {
          Object.assign(searchItem, fresh);
        }
      });
    }

    function performStorySearch(skipRemoteFetch = false) {
      const q = state.storySearchQuery.toLowerCase().trim();
      if (!q) {
        storySearchResultsEl.replaceChildren();
        storySearchCountEl.style.display = 'none';
        clearStorySearchBtn.style.display = 'none';
        document.getElementById('search-pagination').hidden = true;
        return;
      }
      clearStorySearchBtn.style.display = 'inline-block';
      const allKnownStories = [
        ...state.pendingStories,
        ...state.decidedStories,
        ...state.bannedStories,
        ...(state.aiCuration?.stagedPicks || []),
        ...state.searchResults
      ];
      const byKey = new Map();
      allKnownStories.forEach((story) => {
        if (!story) return;
        const key = story.id != null ? 'id:' + Number(story.id) : 'link:' + story.link;
        if (!byKey.has(key)) {
          byKey.set(key, story);
        } else {
          Object.assign(byKey.get(key), story);
        }
      });

      const matched = [];
      byKey.forEach((story) => {
        if (doesStoryMatchQuery(story, q)) {
          matched.push(story);
        }
      });

      renderStorySearchMatches(matched, q);

      if (!skipRemoteFetch && q.length >= 2) {
        request('/admin/api/stories/search?q=' + encodeURIComponent(q))
          .then((data) => {
            if (Array.isArray(data.items) && data.items.length) {
              let changed = false;
              data.items.forEach((item) => {
                const existingSearchIdx = state.searchResults.findIndex((s) =>
                  (item.id != null && s.id != null && Number(s.id) === Number(item.id)) ||
                  (item.link && s.link === item.link)
                );
                if (existingSearchIdx !== -1) {
                  Object.assign(state.searchResults[existingSearchIdx], item);
                } else {
                  state.searchResults.push(item);
                }

                const existingMatchIdx = matched.findIndex((s) =>
                  (item.id != null && s.id != null && Number(s.id) === Number(item.id)) ||
                  (item.link && s.link === item.link)
                );
                if (existingMatchIdx !== -1) {
                  Object.assign(matched[existingMatchIdx], item);
                  changed = true;
                } else if (doesStoryMatchQuery(item, q)) {
                  matched.push(item);
                  changed = true;
                }
              });
              if (changed && state.storySearchQuery.toLowerCase().trim() === q) {
                renderStorySearchMatches(matched, q);
              }
            }
          })
          .catch(() => {});
      }
    }

    storySearchInput.addEventListener('input', () => {
      state.storySearchQuery = storySearchInput.value;
      state.pages.search = 1;
      clearTimeout(state.storySearchTimer);
      state.storySearchTimer = setTimeout(performStorySearch, 250);
    });

    clearStorySearchBtn.addEventListener('click', () => {
      storySearchInput.value = '';
      state.storySearchQuery = '';
      state.pages.search = 1;
      performStorySearch();
    });

    /* ADS MANAGEMENT, SEARCH & PAGINATION */
    async function loadAds() {
      try {
        const data = await request('/admin/api/ads');
        state.ads = data.ads || [];
        filterAndRenderAds();
      } catch (err) {
        console.error('Failed to load ads:', err);
      }
    }

    async function loadAwinStatus() {
      const statusEl = document.getElementById('awin-status-line');
      const btn = document.getElementById('awin-sync-btn');
      if (!statusEl || !btn) return;
      try {
        const data = await request('/admin/api/awin/status');
        if (!data.configured) {
          statusEl.textContent = ' - not configured (set the AWIN_API_TOKEN worker secret)';
          btn.disabled = true;
          return;
        }
        const last = data.runs && data.runs[0];
        const when = last && last.finished_at
          ? new Date(last.finished_at).toLocaleString()
          : 'never';
        statusEl.textContent = ' - ' + (data.programCount || 0) + ' programs | last sync: ' + when;
      } catch (err) {
        statusEl.textContent = ' - status unavailable';
      }
    }

    async function runAwinSync() {
      const btn = document.getElementById('awin-sync-btn');
      const logEl = document.getElementById('awin-sync-log');
      if (!btn || !logEl) return;
      btn.disabled = true;
      btn.textContent = '⟳ Syncing…';
      logEl.hidden = false;
      logEl.innerHTML = '';
      const line = (text, cls) => {
        const div = document.createElement('div');
        if (cls) div.className = cls;
        div.textContent = text;
        logEl.appendChild(div);
        logEl.scrollTop = logEl.scrollHeight;
      };
      try {
        line('Starting Awin sync…');
        const result = await request('/admin/api/awin/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ includeProducts: true }),
        });
        for (const s of result.steps || []) {
          line('- ' + s.name + ': ' + (s.detail || s.status), s.status === 'ok' ? 'ok' : 'warn');
        }
        if (result.ok) {
          line('Done - ' + (result.programs || 0) + ' programs, ' + (result.products || 0) + ' products.', 'ok');
        } else {
          line('Sync failed: ' + (result.error || 'unknown error'), 'err');
        }
        await loadAwinStatus();
        await loadAds();
      } catch (err) {
        line('Sync failed: ' + err.message, 'err');
      } finally {
        btn.disabled = false;
        btn.textContent = '⟳ Update Awin data';
      }
    }

    function filterAndRenderAds() {
      const q = state.adSearchQuery.toLowerCase().trim();
      const cat = state.activeAdCategory;
      const net = state.activeAdNetwork;
      const prog = state.activeAdProgram;
      const quality = state.activeAdQuality;
      // Reset select-all toggle label whenever the list re-renders.
      const selectAllBtn = document.getElementById('ads-select-all');
      if (selectAllBtn) selectAllBtn.textContent = 'Select all on page';
      const filtered = state.ads.filter((ad) => {
        if (cat !== 'all' && ad.category !== cat && ad.category !== 'all') return false;
        if (net !== 'all' && (ad.network || '').toLowerCase() !== net.toLowerCase()) return false;
        if (prog !== 'all' && net.toLowerCase() === 'awin') {
          const adProg = ad.sponsor || '';
          if (adProg !== prog) return false;
        }
        if (quality === 'needs-category' && ad.category && ad.category !== 'all') return false;
        if (quality === 'no-image' && ad.img) return false;
        if (quality === 'products' && !String(ad.id || '').startsWith('awin-product-')) return false;
        if (quality === 'programs' && !String(ad.id || '').startsWith('awin-program-')) return false;
        if (quality === 'hidden' && ad.enabled !== false) return false;
        if (quality === 'visible' && ad.enabled === false) return false;
        if (q) {
          const matchTitle = (ad.title || '').toLowerCase().includes(q);
          const matchDesc = (ad.desc || '').toLowerCase().includes(q);
          const matchSponsor = (ad.sponsor || '').toLowerCase().includes(q);
          const matchCta = (ad.cta || '').toLowerCase().includes(q);
          const matchUrl = (ad.url || '').toLowerCase().includes(q);
          const matchCategory = (ad.category || '').toLowerCase().includes(q);
          const matchNetwork = (ad.network || '').toLowerCase().includes(q);
          if (!matchTitle && !matchDesc && !matchSponsor && !matchCta && !matchUrl && !matchCategory && !matchNetwork) {
            return false;
          }
        }
        return true;
      });

      document.getElementById('ads-count').textContent = '(' + state.ads.length + ')';
      document.getElementById('ads-results-count').textContent = 'Matching ads: ' + filtered.length + ' of ' + state.ads.length;
      adsListEl.replaceChildren();

      const pager = renderPaginationBar('ads-pagination', 'ads', filtered.length, filterAndRenderAds);

      if (!filtered.length) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'No ads match the current filters.';
        adsListEl.append(empty);
        return;
      }

      pager.slice(filtered).forEach((ad) => {
        const row = document.createElement('article');
        row.className = 'ad-row';
        row.tabIndex = 0;
        row.setAttribute('aria-label', 'Edit ad: ' + decodeHtmlEntities(ad.title));
        row.addEventListener('click', (event) => {
          if (event.target.closest('button') || event.target.closest('input[type="checkbox"]')) return;
          openAdPreview(ad);
        });
        row.addEventListener('keydown', (event) => {
          if (event.target === row && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            openAdPreview(ad);
          }
        });

        const fallbackAdImg = 'img/' + (ad.category || 'all') + '_1.jpg';
        const selectBox = document.createElement('input');
        selectBox.type = 'checkbox';
        selectBox.className = 'ad-select';
        selectBox.checked = state.selectedAdIds.has(ad.id);
        selectBox.setAttribute('aria-label', 'Select ad: ' + decodeHtmlEntities(ad.title));
        selectBox.addEventListener('click', (e) => e.stopPropagation());
        selectBox.addEventListener('change', () => {
          if (selectBox.checked) state.selectedAdIds.add(ad.id);
          else state.selectedAdIds.delete(ad.id);
          updateBulkBar();
        });
        row.append(selectBox);

        const image = document.createElement('img');
        image.src = ad.img || fallbackAdImg;
        image.alt = '';
        image.loading = 'lazy';
        attachSmoothImageLoader(image, null, fallbackAdImg);
        row.append(image);

        const details = document.createElement('div');
        details.className = 'ad-details';
        const title = document.createElement('h3');
        title.textContent = decodeHtmlEntities(ad.title);
        if (ad.enabled === false) {
          const hiddenBadge = document.createElement('span');
          hiddenBadge.className = 'meta-badge-status meta-banned';
          hiddenBadge.textContent = ' Hidden';
          hiddenBadge.style.marginLeft = '.4rem';
          title.append(hiddenBadge);
          row.style.opacity = '0.6';
        }
        const meta = document.createElement('p');
        meta.className = 'ad-meta';

        const sponsor = document.createElement('span');
        sponsor.className = 'meta-domain';
        sponsor.textContent = ad.sponsor || 'Featured Partner';

        const network = document.createElement('span');
        network.className = 'meta-network';
        network.textContent = ad.network || 'Partner';

        const catSpan = document.createElement('span');
        catSpan.className = 'meta-category';
        catSpan.textContent = categories.find(c => c.id === ad.category)?.label || ad.category;

        const ctaSpan = document.createElement('span');
        ctaSpan.className = 'meta-provider';
        ctaSpan.textContent = 'CTA: ' + (ad.cta || 'Learn More →');

        meta.append(sponsor, network, catSpan, ctaSpan);
        // Keyword tags badge
        if (Array.isArray(ad.keywords) && ad.keywords.length > 0) {
          const kwSpan = document.createElement('span');
          kwSpan.className = 'meta-badge-status meta-approved';
          kwSpan.textContent = '🔖 ' + ad.keywords.join(', ');
          kwSpan.title = 'Interest keywords for ad matching';
          meta.append(kwSpan);
        }
        details.append(title, meta);
        row.append(details);

        const actions = document.createElement('div');
        actions.className = 'ad-actions';
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'secondary small-btn';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openAdPreview(ad);
        });
        actions.append(editBtn);

        // Hide/Show toggle for Awin ads (persisted in Supabase).
        if (String(ad.id || '').startsWith('awin-')) {
          const toggleBtn = document.createElement('button');
          toggleBtn.type = 'button';
          toggleBtn.className = 'secondary small-btn';
          const isHidden = ad.enabled === false;
          toggleBtn.textContent = isHidden ? 'Show' : 'Hide';
          toggleBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            toggleBtn.disabled = true;
            try {
              await request('/admin/api/awin/ads/bulk', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [ad.id], enabled: isHidden })
              });
              ad.enabled = isHidden;
              filterAndRenderAds();
            } catch (err) {
              alert('Failed: ' + err.message);
              toggleBtn.disabled = false;
            }
          });
          actions.append(toggleBtn);
        }
        row.append(actions);

        adsListEl.append(row);
      });
    }

    function updateBulkBar() {
      const bar = document.getElementById('ads-bulk-bar');
      const count = state.selectedAdIds.size;
      bar.hidden = count === 0;
      document.getElementById('ads-bulk-count').textContent =
        count === 1 ? '1 ad selected' : count + ' ads selected';
    }

    // Populate bulk category dropdown from the site's categories.
    function populateBulkCategories() {
      const sel = document.getElementById('ads-bulk-category');
      sel.replaceChildren();
      for (const c of categories) {
        if (c.id === 'all') continue;
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.label;
        sel.append(opt);
      }
    }
    populateBulkCategories();

    document.getElementById('ads-bulk-clear').addEventListener('click', () => {
      state.selectedAdIds.clear();
      updateBulkBar();
      filterAndRenderAds();
    });

    async function bulkSetEnabled(enabled) {
      const ids = [...state.selectedAdIds].filter(id => String(id).startsWith('awin-'));
      if (!ids.length) {
        alert('Select at least one Awin ad.');
        return;
      }
      try {
        await request('/admin/api/awin/ads/bulk', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, enabled })
        });
        for (const ad of state.ads) {
          if (state.selectedAdIds.has(ad.id)) ad.enabled = enabled;
        }
        state.selectedAdIds.clear();
        updateBulkBar();
        filterAndRenderAds();
      } catch (err) {
        alert('Failed: ' + err.message);
      }
    }

    document.getElementById('ads-bulk-hide').addEventListener('click', () => bulkSetEnabled(false));
    document.getElementById('ads-bulk-show').addEventListener('click', () => bulkSetEnabled(true));

    document.getElementById('ads-select-all').addEventListener('click', () => {
      // Select all ads on the current page (respecting active filters).
      const q = state.adSearchQuery.toLowerCase().trim();
      const cat = state.activeAdCategory;
      const net = state.activeAdNetwork;
      const prog = state.activeAdProgram;
      const quality = state.activeAdQuality;
      const filtered = state.ads.filter((ad) => {
        if (cat !== 'all' && ad.category !== cat && ad.category !== 'all') return false;
        if (net !== 'all' && (ad.network || '').toLowerCase() !== net.toLowerCase()) return false;
        if (prog !== 'all' && net.toLowerCase() === 'awin' && (ad.sponsor || '') !== prog) return false;
        if (quality === 'needs-category' && ad.category && ad.category !== 'all') return false;
        if (quality === 'no-image' && ad.img) return false;
        if (quality === 'products' && !String(ad.id || '').startsWith('awin-product-')) return false;
        if (quality === 'programs' && !String(ad.id || '').startsWith('awin-program-')) return false;
        if (quality === 'hidden' && ad.enabled !== false) return false;
        if (quality === 'visible' && ad.enabled === false) return false;
        return true;
      });
      // Only the current pagination slice.
      const pageSize = state.pageSizes.ads || 10;
      const page = state.pages.ads || 1;
      const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
      // Toggle: if all on page are selected, deselect them; otherwise select them.
      const allSelected = slice.length > 0 && slice.every(ad => state.selectedAdIds.has(ad.id));
      for (const ad of slice) {
        if (allSelected) state.selectedAdIds.delete(ad.id);
        else state.selectedAdIds.add(ad.id);
      }
      document.getElementById('ads-select-all').textContent =
        allSelected ? 'Select all on page' : 'Deselect all on page';
      updateBulkBar();
      filterAndRenderAds();
    });

    document.getElementById('ads-bulk-apply').addEventListener('click', async () => {
      const category = document.getElementById('ads-bulk-category').value;
      const ids = [...state.selectedAdIds];
      if (!ids.length || !category) return;
      const btn = document.getElementById('ads-bulk-apply');
      btn.disabled = true;
      btn.textContent = 'Applying…';
      try {
        // Split Awin ads (persisted in Supabase) from in-memory ads.
        const awinIds = ids.filter(id => String(id).startsWith('awin-'));
        if (awinIds.length) {
          await request('/admin/api/awin/ads/bulk', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: awinIds, category })
          });
        }
        // Update local state for all selected ads.
        for (const ad of state.ads) {
          if (state.selectedAdIds.has(ad.id)) ad.category = category;
        }
        state.selectedAdIds.clear();
        updateBulkBar();
        filterAndRenderAds();
      } catch (err) {
        alert('Bulk update failed: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Apply to selected';
      }
    });

    adSearchInput.addEventListener('input', () => {
      state.adSearchQuery = adSearchInput.value;
      state.pages.ads = 1;
      filterAndRenderAds();
    });

    adsNetworkFilterEl.addEventListener('change', () => {
      state.activeAdNetwork = adsNetworkFilterEl.value;
      state.activeAdProgram = 'all';
      state.pages.ads = 1;
      updateProgramFilter();
      filterAndRenderAds();
    });

    const adsProgramFilterEl = document.getElementById('ads-program-filter');
    const adsProgramFilterWrap = document.getElementById('ads-program-filter-wrap');
    const adsQualityFilterEl = document.getElementById('ads-quality-filter');

    function updateProgramFilter() {
      const isAwin = state.activeAdNetwork.toLowerCase() === 'awin';
      adsProgramFilterWrap.hidden = !isAwin;
      if (!isAwin) return;
      const programs = [...new Set(
        state.ads
          .filter(ad => (ad.network || '').toLowerCase() === 'awin')
          .map(ad => ad.sponsor || 'Unknown')
      )].sort();
      adsProgramFilterEl.replaceChildren();
      const allOpt = document.createElement('option');
      allOpt.value = 'all';
      allOpt.textContent = 'All programs (' + programs.length + ')';
      adsProgramFilterEl.append(allOpt);
      for (const p of programs) {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        adsProgramFilterEl.append(opt);
      }
      adsProgramFilterEl.value = 'all';
    }

    adsProgramFilterEl.addEventListener('change', () => {
      state.activeAdProgram = adsProgramFilterEl.value;
      state.pages.ads = 1;
      filterAndRenderAds();
    });

    adsQualityFilterEl.addEventListener('change', () => {
      state.activeAdQuality = adsQualityFilterEl.value;
      state.pages.ads = 1;
      filterAndRenderAds();
    });

    document.getElementById('create-ad-btn').addEventListener('click', () => {
      openAdPreview(null);
    });

    document.getElementById('awin-sync-btn').addEventListener('click', runAwinSync);
    loadAwinStatus();

    // Ad keyword auto-tag (4 modes)
    document.getElementById('ad-tag-btn').addEventListener('click', () => runAdAutoTag('new'));
    document.getElementById('ad-tag-all-btn').addEventListener('click', () => runAdAutoTag('all'));
    document.getElementById('ad-tag-untagged-btn').addEventListener('click', () => runAdAutoTag('untagged'));
    document.getElementById('ad-tag-tagged-btn').addEventListener('click', () => runAdAutoTag('tagged'));

    async function runAdAutoTag(mode) {
      const btnIds = ['ad-tag-btn', 'ad-tag-all-btn', 'ad-tag-untagged-btn', 'ad-tag-tagged-btn'];
      btnIds.forEach(id => { document.getElementById(id).disabled = true; });
      const status = document.getElementById('ad-tag-status');
      const log = document.getElementById('ad-tag-log');
      const resultsDiv = document.getElementById('ad-tag-results');
      log.hidden = false;
      log.textContent = 'Fetching ads...';
      resultsDiv.hidden = true;
      resultsDiv.innerHTML = '';

      try {
        // Get all ads from the admin endpoint
        const adsRes = await fetch('/admin/api/ads', { credentials: 'include' });
        if (!adsRes.ok) throw new Error('Failed to fetch ads');
        const adsData = await adsRes.json();
        let ads = (adsData.ads || []).map(a => ({
          id: a.id,
          title: a.title || a.name || '',
          description: a.description || a.desc || ''
        })).filter(a => a.title);

        // Filter by mode: fetch existing tags to know what's tagged
        if (mode !== 'all') {
          log.textContent = 'Checking existing tags...';
          const tagsRes = await fetch('/ads/tags');
          const tagsData = await tagsRes.json().catch(() => ({ tags: {} }));
          const taggedIds = new Set(Object.keys(tagsData.tags || {}));
          if (mode === 'new' || mode === 'untagged') {
            ads = ads.filter(a => !taggedIds.has(a.id));
          } else if (mode === 'tagged') {
            ads = ads.filter(a => taggedIds.has(a.id));
          }
        }

        if (!ads.length) {
          status.textContent = 'No ads to tag';
          log.textContent = 'Nothing to do for mode: ' + mode;
          btnIds.forEach(id => { document.getElementById(id).disabled = false; });
          return;
        }

        status.textContent = 'Tagging ' + ads.length + ' ads...';
        let offset = 0;
        const allResults = [];

        while (true) {
          log.textContent = 'Tagging... (' + offset + '/' + ads.length + ')';
          const res = await fetch('/admin/api/ads/auto-tag', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ads, offset })
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || 'Auto-tag failed');
          }
          allResults.push(...(data.results || []));
          offset = data.progress.done;
          if (data.done) break;
        }

        // Display results
        status.textContent = 'Tagged ' + allResults.length + ' ads';
        log.textContent = 'Done! ' + allResults.length + ' ads tagged and saved to DB.';
        resultsDiv.hidden = false;
        const html = ['<div style="max-height: 400px; overflow-y: auto; margin-top: 8px;">'];
        html.push('<table style="width: 100%; font-size: 12px;"><tr><th style="text-align:left">Ad</th><th style="text-align:left">Keywords</th></tr>');
        for (const r of allResults) {
          const ad = ads.find(a => a.id === r.id);
          const kwStr = (r.keywords || []).map(k => k.label + ' (' + k.confidence.toFixed(2) + ')').join(', ') || '—';
          html.push('<tr><td>' + escapeHtml(ad?.title || r.id) + '</td><td>' + escapeHtml(kwStr) + '</td></tr>');
        }
        html.push('</table></div>');
        resultsDiv.innerHTML = html.join('');
      } catch (err) {
        status.textContent = 'Error';
        log.textContent = 'Error: ' + err.message;
      } finally {
        btnIds.forEach(id => { document.getElementById(id).disabled = false; });
      }
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    /* ============================================================================
     * AI DAILY STORY CURATION & STAGING QUEUE (5 Stories/Category · 3x/Day)
     * ============================================================================ */

    function getVisibleAiStagedPicks() {
      const picks = Array.isArray(state.aiCuration?.stagedPicks) ? state.aiCuration.stagedPicks : [];
      return picks.filter((pick) => {
        if (state.ignored.has(pick.id)) return false;
        if (state.activeAiSlot !== 'all' && pick.slot !== state.activeAiSlot) return false;
        if (state.activeAiCategory !== 'all_categories' && pick.category !== state.activeAiCategory) return false;
        return true;
      });
    }

    function renderAiCurationHeaderBar() {
      const bar = document.getElementById('ai-curation-bar');
      const countEl = document.getElementById('ai-staging-count');
      if (!bar) return;

      const ai = state.aiCuration || {};
      const stagedCount = Array.isArray(ai.stagedPicks) ? ai.stagedPicks.length : 0;
      if (countEl) {
        countEl.textContent = '(' + stagedCount + ')';
      }

      bar.replaceChildren();

      const info = document.createElement('div');
      info.className = 'ai-curation-info';

      const titleRow = document.createElement('div');
      titleRow.className = 'ai-curation-title';
      titleRow.textContent = '3x Daily AI Curation (5 / category): ';
      const statusBadge = document.createElement('span');
      statusBadge.className = 'status ' + (ai.enabled ? 'status-succeeded' : 'status-partial');
      statusBadge.textContent = ai.enabled
        ? 'Active · Morning (08:00), Afternoon (13:00), Evening (18:00)'
        : 'Paused';
      titleRow.append(statusBadge);

      const metaRow = document.createElement('div');
      metaRow.className = 'ai-curation-meta tabular-nums';
      const lastRunStr = ai.lastRunAt
        ? formatDateTime(new Date(ai.lastRunAt)) + ' (' + (ai.lastSlot || 'latest') + ' · ' + (ai.lastTrigger || 'auto') + ')'
        : 'Not run yet';
      const completedStr = Array.isArray(ai.completedSlotsToday) && ai.completedSlotsToday.length
        ? ai.completedSlotsToday.join(', ')
        : 'none yet';
      metaRow.textContent = 'Active window: ' + (ai.currentSlotLabel || 'Morning Edition') +
        ' · Last run: ' + lastRunStr +
        ' · Completed today: ' + completedStr + ' · ';

      if (ai.enabled && ai.nextRunAt) {
        const nextSpan = document.createElement('span');
        nextSpan.dataset.countdownPrefix = 'Next window (' + (ai.nextSlot || 'scheduled') + ') in ';
        nextSpan.dataset.countdownTo = ai.nextRunAt;
        nextSpan.textContent = 'Next window (' + (ai.nextSlot || 'scheduled') + ') in ' + formatCountdown(ai.nextRunAt);
        metaRow.append(nextSpan);
      }

      info.append(titleRow, metaRow);
      if (ai.lastSummary) {
        const sumLine = document.createElement('div');
        sumLine.className = 'ai-curation-meta';
        sumLine.textContent = ai.lastSummary;
        info.append(sumLine);
      }

      const actions = document.createElement('div');
      actions.className = 'ai-curation-actions';

      const slotSelect = document.createElement('select');
      slotSelect.id = 'ai-slot-select';
      slotSelect.className = 'provider-filter';
      slotSelect.setAttribute('aria-label', 'Select daily edition slot to curate');
      [
        { value: 'auto', label: 'Current Window (' + (ai.currentSlot || 'morning') + ')' },
        { value: 'morning', label: 'Morning Edition (08:00)' },
        { value: 'afternoon', label: 'Afternoon Edition (13:00)' },
        { value: 'evening', label: 'Evening Edition (18:00)' }
      ].forEach((optItem) => {
        const opt = document.createElement('option');
        opt.value = optItem.value;
        opt.textContent = optItem.label;
        slotSelect.append(opt);
      });
      slotSelect.value = state.selectedRunSlot || 'auto';
      slotSelect.addEventListener('change', () => {
        state.selectedRunSlot = slotSelect.value;
      });

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'secondary small-btn';
      toggleBtn.disabled = state.togglingAiSchedule;
      toggleBtn.textContent = ai.enabled ? 'Pause 3x/day schedule' : 'Enable 3x/day schedule';
      toggleBtn.addEventListener('click', toggleAiSchedule);

      const runBtn = document.createElement('button');
      runBtn.id = 'run-ai-curation-btn';
      runBtn.type = 'button';
      runBtn.className = 'small-btn';
      runBtn.disabled = state.curatingAi;
      runBtn.textContent = state.curatingAi ? 'Curating 5/Category…' : 'Curate 5/Category Now';
      runBtn.addEventListener('click', () => runAiCurationNow());

      actions.append(slotSelect, toggleBtn, runBtn);
      bar.append(info, actions);
    }

    function renderAiTasteDrawer() {
      const drawer = document.getElementById('ai-taste-drawer');
      const toggleBtn = document.getElementById('toggle-taste-drawer-btn');
      if (!drawer) return;
      drawer.hidden = !state.tasteDrawerOpen;
      if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', String(state.tasteDrawerOpen));
        toggleBtn.textContent = state.tasteDrawerOpen ? 'Hide Taste Profile' : 'Taste Profile & Schedule';
      }
      if (!state.tasteDrawerOpen) return;

      drawer.replaceChildren();
      const signals = state.aiCuration?.learnedSignals || {};
      const profile = state.aiCuration?.tasteProfile || {};

      const signalGrid = document.createElement('div');
      signalGrid.className = 'ai-signal-grid';

      const historyBox = document.createElement('div');
      historyBox.className = 'ai-signal-box tabular-nums';
      const histTitle = document.createElement('strong');
      histTitle.textContent = 'Learned Decision History';
      historyBox.append(
        histTitle,
        document.createTextNode(
          (signals.approvedCount || 0) + ' approved stories · ' +
          (signals.rejectedCount || 0) + ' rejected/banned stories analyzed'
        )
      );

      const sourcesBox = document.createElement('div');
      sourcesBox.className = 'ai-signal-box';
      const srcTitle = document.createElement('strong');
      srcTitle.textContent = 'Top Approved Sources';
      const topSources = (signals.topApprovedSources || []).map(s => s.name + ' (' + s.count + ')').join(', ');
      sourcesBox.append(srcTitle, document.createTextNode(topSources || 'Learning as you approve stories'));

      const termsBox = document.createElement('div');
      termsBox.className = 'ai-signal-box';
      const termsTitle = document.createElement('strong');
      termsTitle.textContent = 'Learned High-Affinity Themes';
      const topTerms = (signals.topApprovedTerms || []).slice(0, 8).map(t => t.name).join(', ');
      termsBox.append(termsTitle, document.createTextNode(topTerms || 'Building keyword affinity from approvals'));

      const avoidedBox = document.createElement('div');
      avoidedBox.className = 'ai-signal-box';
      const avoidTitle = document.createElement('strong');
      avoidTitle.textContent = 'Avoided Patterns (Rejected/Banned)';
      const avoidedTerms = (signals.avoidedTerms || []).slice(0, 6).map(t => t.name).join(', ');
      avoidedBox.append(avoidTitle, document.createTextNode(avoidedTerms || 'None flagged yet'));

      signalGrid.append(historyBox, sourcesBox, termsBox, avoidedBox);
      drawer.append(signalGrid);

      const instructionsWrap = document.createElement('div');
      instructionsWrap.className = 'ai-taste-field';
      const instLabel = document.createElement('label');
      instLabel.setAttribute('for', 'ai-taste-instructions');
      instLabel.textContent = 'Editable Editorial Taste Profile (guides AI story selection across all categories)';
      const instTextarea = document.createElement('textarea');
      instTextarea.id = 'ai-taste-instructions';
      instTextarea.rows = 3;
      instTextarea.value = profile.customInstructions || '';
      instTextarea.placeholder = 'Describe the stories, tone, and themes you enjoy and approve…';
      instructionsWrap.append(instLabel, instTextarea);
      drawer.append(instructionsWrap);

      const twoCol = document.createElement('div');
      twoCol.className = 'ai-taste-two-col';

      const prefWrap = document.createElement('div');
      prefWrap.className = 'ai-taste-field';
      const prefLabel = document.createElement('label');
      prefLabel.setAttribute('for', 'ai-taste-preferred');
      prefLabel.textContent = 'Preferred Keywords (comma-separated boost)';
      const prefInput = document.createElement('input');
      prefInput.id = 'ai-taste-preferred';
      prefInput.type = 'text';
      prefInput.value = profile.preferredKeywords || '';
      prefWrap.append(prefLabel, prefInput);

      const mutedWrap = document.createElement('div');
      mutedWrap.className = 'ai-taste-field';
      const mutedLabel = document.createElement('label');
      mutedLabel.setAttribute('for', 'ai-taste-muted');
      mutedLabel.textContent = 'Muted / Excluded Keywords (comma-separated penalty)';
      const mutedInput = document.createElement('input');
      mutedInput.id = 'ai-taste-muted';
      mutedInput.type = 'text';
      mutedInput.value = profile.mutedKeywords || '';
      mutedWrap.append(mutedLabel, mutedInput);

      twoCol.append(prefWrap, mutedWrap);
      drawer.append(twoCol);

      const btnRow = document.createElement('div');
      btnRow.className = 'editor-btn-row';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'secondary small-btn';
      saveBtn.disabled = state.savingTasteProfile;
      saveBtn.textContent = state.savingTasteProfile ? 'Saving…' : 'Save Taste Profile';
      saveBtn.addEventListener('click', () => saveAiTasteProfile(false));

      const saveAndRunBtn = document.createElement('button');
      saveAndRunBtn.type = 'button';
      saveAndRunBtn.className = 'small-btn';
      saveAndRunBtn.disabled = state.savingTasteProfile || state.curatingAi;
      saveAndRunBtn.textContent = state.savingTasteProfile ? 'Re-curating…' : 'Save & Re-Curate 5/Category Now';
      saveAndRunBtn.addEventListener('click', () => saveAiTasteProfile(true));

      btnRow.append(saveBtn, saveAndRunBtn);
      drawer.append(btnRow);
    }

    function renderAiEditionAndCategoryTabs() {
      const editionNav = document.getElementById('ai-edition-tabs');
      const catNav = document.getElementById('ai-staging-categories');
      const allStaged = Array.isArray(state.aiCuration?.stagedPicks) ? state.aiCuration.stagedPicks : [];

      if (editionNav) {
        editionNav.replaceChildren();
        const editions = [
          { id: 'all', label: 'All Editions (' + allStaged.length + ')' },
          { id: 'morning', label: 'Morning · 08:00 (' + allStaged.filter(p => p.slot === 'morning').length + ')' },
          { id: 'afternoon', label: 'Afternoon · 13:00 (' + allStaged.filter(p => p.slot === 'afternoon').length + ')' },
          { id: 'evening', label: 'Evening · 18:00 (' + allStaged.filter(p => p.slot === 'evening').length + ')' }
        ];
        editions.forEach((ed) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'category-tab tabular-nums';
          btn.setAttribute('aria-pressed', String(state.activeAiSlot === ed.id));
          btn.textContent = ed.label;
          btn.addEventListener('click', () => {
            state.activeAiSlot = ed.id;
            state.pages.aiStaging = 1;
            renderAiStagingSection();
          });
          editionNav.append(btn);
        });
      }

      if (catNav) {
        catNav.replaceChildren();
        const slotFiltered = state.activeAiSlot === 'all'
          ? allStaged
          : allStaged.filter(p => p.slot === state.activeAiSlot);

        const allCatBtn = document.createElement('button');
        allCatBtn.type = 'button';
        allCatBtn.className = 'category-tab tabular-nums';
        allCatBtn.setAttribute('aria-pressed', String(state.activeAiCategory === 'all_categories'));
        allCatBtn.textContent = 'All Categories (' + slotFiltered.length + ')';
        allCatBtn.addEventListener('click', () => {
          state.activeAiCategory = 'all_categories';
          state.pages.aiStaging = 1;
          renderAiStagingSection();
        });
        catNav.append(allCatBtn);

        categories.forEach((cat) => {
          const count = slotFiltered.filter(p => p.category === cat.id).length;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'category-tab tabular-nums';
          btn.setAttribute('aria-pressed', String(state.activeAiCategory === cat.id));
          btn.textContent = cat.icon + ' ' + cat.label + ' (' + count + '/5)';
          btn.addEventListener('click', () => {
            state.activeAiCategory = cat.id;
            state.pages.aiStaging = 1;
            renderAiStagingSection();
          });
          catNav.append(btn);
        });
      }
    }

    function renderAiBulkActionBar(visiblePicks) {
      const bulkBar = document.getElementById('ai-bulk-bar');
      if (!bulkBar) return;
      bulkBar.replaceChildren();

      // Clean up selected IDs that are no longer in stagedPicks
      const activeIds = new Set((state.aiCuration?.stagedPicks || []).map(p => Number(p.id)));
      Array.from(state.selectedAiStoryIds).forEach((id) => {
        if (!activeIds.has(Number(id))) state.selectedAiStoryIds.delete(id);
      });

      const selectedCount = state.selectedAiStoryIds.size;
      const allVisibleSelected = visiblePicks.length > 0 &&
        visiblePicks.every(p => state.selectedAiStoryIds.has(Number(p.id)));

      const left = document.createElement('div');
      left.className = 'ai-bulk-left';

      const selectAllBtn = document.createElement('button');
      selectAllBtn.type = 'button';
      selectAllBtn.className = 'secondary small-btn';
      selectAllBtn.disabled = visiblePicks.length === 0;
      selectAllBtn.textContent = allVisibleSelected
        ? 'Clear Visible (' + visiblePicks.length + ')'
        : 'Select Visible (' + visiblePicks.length + ')';
      selectAllBtn.addEventListener('click', () => {
        if (allVisibleSelected) {
          visiblePicks.forEach(p => state.selectedAiStoryIds.delete(Number(p.id)));
        } else {
          visiblePicks.forEach(p => state.selectedAiStoryIds.add(Number(p.id)));
        }
        renderAiStagingSection();
      });

      const selectionLabel = document.createElement('span');
      selectionLabel.className = 'muted tabular-nums';
      selectionLabel.textContent = selectedCount > 0
        ? selectedCount + ' story' + (selectedCount === 1 ? '' : 'ies') + ' selected'
        : 'Select stories for bulk promotion or rejection';

      left.append(selectAllBtn, selectionLabel);

      const right = document.createElement('div');
      right.className = 'ai-bulk-right';

      const approveSelectedBtn = document.createElement('button');
      approveSelectedBtn.type = 'button';
      approveSelectedBtn.className = 'small-btn btn-approve-accent tabular-nums';
      approveSelectedBtn.disabled = selectedCount === 0 || state.bulkDecidingAi;
      approveSelectedBtn.textContent = 'Approve Selected (' + selectedCount + ')';
      approveSelectedBtn.addEventListener('click', () => {
        bulkDecideAiStagedStories(Array.from(state.selectedAiStoryIds), 'approve');
      });

      const approveVisibleBtn = document.createElement('button');
      approveVisibleBtn.type = 'button';
      approveVisibleBtn.className = 'secondary small-btn tabular-nums';
      approveVisibleBtn.disabled = visiblePicks.length === 0 || state.bulkDecidingAi;
      approveVisibleBtn.textContent = state.activeAiCategory === 'all_categories'
        ? 'Approve All Staged (' + visiblePicks.length + ')'
        : 'Approve Category (' + visiblePicks.length + ')';
      approveVisibleBtn.addEventListener('click', () => {
        bulkDecideAiStagedStories(visiblePicks.map(p => Number(p.id)), 'approve');
      });

      const disapproveSelectedBtn = document.createElement('button');
      disapproveSelectedBtn.type = 'button';
      disapproveSelectedBtn.className = 'secondary small-btn tabular-nums';
      disapproveSelectedBtn.disabled = selectedCount === 0 || state.bulkDecidingAi;
      disapproveSelectedBtn.textContent = 'Disapprove Selected (' + selectedCount + ')';
      disapproveSelectedBtn.addEventListener('click', () => {
        bulkDecideAiStagedStories(Array.from(state.selectedAiStoryIds), 'disapprove');
      });

      const banSelectedBtn = document.createElement('button');
      banSelectedBtn.type = 'button';
      banSelectedBtn.className = 'small-btn btn-danger-outline tabular-nums';
      banSelectedBtn.disabled = selectedCount === 0 || state.bulkDecidingAi;
      banSelectedBtn.textContent = 'Ban Selected (' + selectedCount + ')';
      banSelectedBtn.addEventListener('click', () => {
        bulkDecideAiStagedStories(Array.from(state.selectedAiStoryIds), 'ban');
      });

      right.append(approveSelectedBtn, approveVisibleBtn, disapproveSelectedBtn, banSelectedBtn);
      bulkBar.append(left, right);
    }

    function createAiStagedStoryRow(pick) {
      const row = document.createElement('article');
      row.className = 'story ai-pick-row';
      row.tabIndex = 0;
      row.setAttribute('aria-label', 'Review AI staged story: ' + decodeHtmlEntities(pick.title));
      row.addEventListener('click', (event) => {
        if (event.target.closest('button') || event.target.closest('input[type="checkbox"]')) return;
        openStoryPreview(pick);
      });
      row.addEventListener('keydown', (event) => {
        if (event.target === row && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          openStoryPreview(pick);
        }
      });

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'ai-pick-checkbox';
      checkbox.checked = state.selectedAiStoryIds.has(Number(pick.id));
      checkbox.setAttribute('aria-label', 'Select ' + decodeHtmlEntities(pick.title));
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        if (checkbox.checked) state.selectedAiStoryIds.add(Number(pick.id));
        else state.selectedAiStoryIds.delete(Number(pick.id));
        renderAiBulkActionBar(getVisibleAiStagedPicks());
      });
      row.append(checkbox);

      const fallbackPickImg = 'img/' + (pick.category || 'all') + '_1.jpg';
      const image = document.createElement('img');
      image.src = pick.image || fallbackPickImg;
      image.alt = '';
      image.loading = 'lazy';
      attachSmoothImageLoader(image, null, fallbackPickImg);
      row.append(image);

      const details = document.createElement('div');
      details.className = 'story-details';

      const title = document.createElement('h3');
      const link = document.createElement('a');
      link.href = decodeHtmlEntities(pick.link);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = decodeHtmlEntities(pick.title);
      link.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openStoryPreview(pick);
      });
      title.append(link);

      const meta = document.createElement('p');
      meta.className = 'story-meta';
      const catLabel = categories.find(c => c.id === pick.category)?.label || pick.category;
      const slotShort = pick.slot === 'morning'
        ? 'Morning Edition'
        : pick.slot === 'afternoon'
          ? 'Afternoon Edition'
          : 'Evening Edition';

      [
        ['meta-rank', 'Pick #' + (pick.rank || 1) + ' in ' + catLabel],
        ['meta-slot', '· ' + slotShort],
        ['meta-provider', '· ' + (pick.provider || 'unknown')],
        ['meta-domain', '· ' + getStoryDomain(pick.link)]
      ].forEach(([cls, val]) => {
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = val;
        meta.append(span);
      });

      const updated = document.createElement('span');
      updated.className = 'meta-date';
      updated.dataset.updatedPrefix = '· Curated: ';
      updated.dataset.updatedAt = pick.curatedAt || pick.updatedAt || '';
      meta.append(updated);

      const reasonP = document.createElement('p');
      reasonP.className = 'ai-pick-reason';
      reasonP.textContent = pick.reason || 'Selected by AI curator based on your editorial taste profile and approval history.';

      details.append(title, meta, reasonP);
      const main = document.createElement('div');
      main.className = 'story-main';
      main.append(details);
      row.append(main);

      const actions = document.createElement('div');
      actions.className = 'story-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'secondary small-btn';
      editBtn.textContent = 'Preview / Edit';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openStoryPreview(pick);
      });

      const stagedLinkBtn = document.createElement('button');
      stagedLinkBtn.type = 'button';
      stagedLinkBtn.className = 'secondary small-btn';
      stagedLinkBtn.textContent = '🔗 Copy link';
      stagedLinkBtn.title = 'Copy the frontpage expanded-view link for this story';
      stagedLinkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyFrontpageStoryLink(stagedLinkBtn, pick);
      });

      const approveBtn = document.createElement('button');
      approveBtn.type = 'button';
      approveBtn.className = 'small-btn btn-approve-accent';
      approveBtn.textContent = state.approving.has(pick.id) ? 'Approving…' : 'Approve';
      approveBtn.disabled = state.approving.has(pick.id);
      approveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        approveStory(pick.id);
      });

      const disapproveBtn = document.createElement('button');
      disapproveBtn.type = 'button';
      disapproveBtn.className = 'secondary small-btn';
      disapproveBtn.textContent = state.unapproving.has(pick.id) ? 'Rejecting…' : 'Disapprove';
      disapproveBtn.disabled = state.unapproving.has(pick.id);
      disapproveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        disapproveStory(pick.id);
      });

      const banBtn = document.createElement('button');
      banBtn.type = 'button';
      banBtn.className = 'small-btn btn-danger-outline';
      banBtn.textContent = state.banning.has(pick.id) ? 'Banning…' : 'Ban';
      banBtn.disabled = state.banning.has(pick.id);
      banBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        banStory(pick.id);
      });

      actions.append(editBtn, stagedLinkBtn, approveBtn, disapproveBtn, banBtn);
      row.append(actions);
      return row;
    }

    function renderAiStagingSection() {
      renderAiCurationHeaderBar();
      renderAiTasteDrawer();
      renderAiEditionAndCategoryTabs();

      const visiblePicks = getVisibleAiStagedPicks();
      renderAiBulkActionBar(visiblePicks);

      const listEl = document.getElementById('ai-staged-stories');
      if (!listEl) return;
      listEl.replaceChildren();

      const pager = renderPaginationBar('ai-staging-pagination', 'aiStaging', visiblePicks.length, () => {
        renderAiStagingSection();
        refreshStoryAges();
      });

      if (!visiblePicks.length) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        const totalStaged = (state.aiCuration?.stagedPicks || []).length;
        empty.textContent = totalStaged === 0
          ? 'No AI-curated stories are currently staged. Click "Curate 5/Category Now" above to have the AI select 5 stories from each category tailored to your approval history and taste profile.'
          : 'No staged AI picks match the selected edition or category filter.';
        listEl.append(empty);
        return;
      }

      pager.slice(visiblePicks).forEach((pick) => {
        listEl.append(createAiStagedStoryRow(pick));
      });
    }

    async function runAiCurationNow(overrideSlot = null) {
      if (state.curatingAi) return;
      state.curatingAi = true;
      renderAiCurationHeaderBar();
      const targetSlot = overrideSlot || (state.selectedRunSlot !== 'auto' ? state.selectedRunSlot : null);
      messageEl.className = 'muted';
      messageEl.textContent = 'AI Curator is evaluating unapproved stories across all 7 categories…';
      try {
        const res = await request('/admin/api/ai-curation/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slot: targetSlot,
            triggerSource: 'manual'
          })
        });
        if (res.aiCuration) state.aiCuration = res.aiCuration;
        state.pages.aiStaging = 1;
        renderAiStagingSection();
        refreshStoryAges();
        messageEl.className = 'success';
        messageEl.textContent = res.aiCuration?.lastSummary ||
          ('AI staged ' + (res.totalStagedInRun || 0) + ' stories across categories.');
      } catch (error) {
        messageEl.className = 'error';
        messageEl.textContent = 'AI story curation failed: ' + error.message;
      } finally {
        state.curatingAi = false;
        renderAiCurationHeaderBar();
      }
    }

    async function toggleAiSchedule() {
      if (state.togglingAiSchedule) return;
      state.togglingAiSchedule = true;
      renderAiCurationHeaderBar();
      try {
        const nextEnabled = !(state.aiCuration?.enabled);
        const res = await request('/admin/api/ai-curation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: nextEnabled })
        });
        if (res.aiCuration) state.aiCuration = res.aiCuration;
        renderAiStagingSection();
        messageEl.className = 'success';
        messageEl.textContent = state.aiCuration.enabled
          ? '3x/day automatic AI story curation (Morning, Afternoon, Evening) enabled.'
          : '3x/day automatic AI story curation paused.';
      } catch (error) {
        messageEl.className = 'error';
        messageEl.textContent = 'Could not update AI schedule: ' + error.message;
      } finally {
        state.togglingAiSchedule = false;
        renderAiCurationHeaderBar();
      }
    }

    async function saveAiTasteProfile(reCurate = false) {
      if (state.savingTasteProfile) return;
      state.savingTasteProfile = true;
      renderAiTasteDrawer();
      const instructionsEl = document.getElementById('ai-taste-instructions');
      const preferredEl = document.getElementById('ai-taste-preferred');
      const mutedEl = document.getElementById('ai-taste-muted');
      const payload = {
        customInstructions: instructionsEl ? instructionsEl.value.trim() : '',
        preferredKeywords: preferredEl ? preferredEl.value.trim() : '',
        mutedKeywords: mutedEl ? mutedEl.value.trim() : '',
        reCurate: Boolean(reCurate),
        slot: state.selectedRunSlot !== 'auto' ? state.selectedRunSlot : null
      };
      messageEl.className = 'muted';
      messageEl.textContent = reCurate
        ? 'Saving taste profile and re-curating 5 stories per category…'
        : 'Saving editorial taste profile…';
      try {
        const res = await request('/admin/api/ai-curation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.aiCuration) state.aiCuration = res.aiCuration;
        renderAiStagingSection();
        refreshStoryAges();
        messageEl.className = 'success';
        messageEl.textContent = reCurate
          ? (res.aiCuration?.lastSummary || 'Taste profile saved and staging queue refreshed.')
          : 'Editorial taste profile saved.';
      } catch (error) {
        messageEl.className = 'error';
        messageEl.textContent = 'Could not save taste profile: ' + error.message;
      } finally {
        state.savingTasteProfile = false;
        renderAiTasteDrawer();
      }
    }

    async function bulkDecideAiStagedStories(storyIds, action) {
      const ids = Array.isArray(storyIds) ? storyIds.filter(Boolean) : [];
      if (!ids.length || state.bulkDecidingAi) return;
      state.bulkDecidingAi = true;
      renderAiBulkActionBar(getVisibleAiStagedPicks());
      const actionVerb = action === 'approve'
        ? 'Approving'
        : action === 'ban'
          ? 'Banning'
          : 'Disapproving';
      messageEl.className = 'muted';
      messageEl.textContent = actionVerb + ' ' + ids.length + ' staged ' + (ids.length === 1 ? 'story' : 'stories') + '…';
      try {
        const res = await request('/admin/api/ai-curation/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storyIds: ids, action })
        });
        ids.forEach(id => state.selectedAiStoryIds.delete(Number(id)));
        if (res.aiCuration) state.aiCuration = res.aiCuration;
        await refreshData();
        messageEl.className = 'success';
        const doneLabel = action === 'approve'
          ? 'promoted to Approved Stories'
          : action === 'ban'
            ? 'banned from public feeds'
            : 'marked Disapproved';
        messageEl.textContent = (res.succeededCount || ids.length) + ' AI-staged ' +
          ((res.succeededCount || ids.length) === 1 ? 'story ' : 'stories ') + doneLabel + '.';
      } catch (error) {
        messageEl.className = 'error';
        messageEl.textContent = 'Bulk ' + action + ' failed: ' + error.message;
      } finally {
        state.bulkDecidingAi = false;
        renderAiStagingSection();
      }
    }

    document.getElementById('toggle-taste-drawer-btn').addEventListener('click', () => {
      state.tasteDrawerOpen = !state.tasteDrawerOpen;
      renderAiTasteDrawer();
    });

    async function refreshData() {
      messageEl.className = 'muted';
      messageEl.textContent = 'Refreshing database status…';
      try {
        const query = state.activeProvider === 'all'
          ? ''
          : '?provider=' + encodeURIComponent(state.activeProvider);
        const data = await request('/admin/api/status' + query);
        state.lastStatus = data;
        state.providers = data.providers;
        state.pendingStories = data.pendingStories || [];
        state.decidedStories = data.recentStories || [];
        state.bannedStories = data.bannedStories || [];
        if (data.autoSync) state.autoSync = data.autoSync;
        if (data.aiCuration) state.aiCuration = data.aiCuration;
        if (data.providerLogs) {
          state.providerLogs = data.providerLogs.logs || [];
          state.providerLogsSummary = data.providerLogs.summary || state.providerLogsSummary;
        }
        if (data.runs) state.runs = data.runs;
        if (!state.runs.some((r) => r.status === 'running') && !state.providers.some((p) => p.status === 'running')) state.syncPollActive = false;
        syncSearchResultsWithKnownLists();
        renderProviders(data.providers);
        renderProviderFilter();
        renderLogFilterOptions();
        renderProviderLogs();
        renderAiStagingSection();
        document.getElementById('total').textContent = data.totalStories.toLocaleString();
        const unclassifiedEl = document.getElementById('validate-unclassified-count');
        if (unclassifiedEl) {
          unclassifiedEl.textContent = typeof data.unclassifiedCount === 'number'
            ? data.unclassifiedCount.toLocaleString() + ' stories awaiting interest classification.'
            : '';
        }
        document.getElementById('pending-count').textContent = state.pendingStories.length
          ? '(' + state.pendingStories.length + (state.pendingStories.length === 100 ? '+' : '') + ')'
          : '';
        document.getElementById('history-count').textContent = state.decidedStories.length
          ? '(' + state.decidedStories.length + ')'
          : '';
        document.getElementById('banned-count').textContent = state.bannedStories.length
          ? '(' + state.bannedStories.length + ')'
          : '';
        renderCategoryTabs();
        renderHistoryCategoryTabs();
        renderAdsCategoryTabs();
        renderStories(state.pendingStories, { pending: true });
        renderStories(state.decidedStories, { decided: true });
        renderStories(state.bannedStories, { banned: true });
        if (state.storySearchQuery.trim()) {
          performStorySearch();
        }
        refreshStoryAges();
        renderVitals();
        renderSectionMenu();
        loadAds().finally(() => { refreshVitalsExtras(); });
        messageEl.textContent = 'Database status refreshed.';
      } catch (error) {
        messageEl.className = 'error';
        messageEl.textContent = error.message;
      }
    }

    async function approveStory(storyId) {
      if (state.approving.has(storyId)) return;
      state.approving.add(storyId);
      renderStories(state.pendingStories, { pending: true });
      renderAiStagingSection();
      if (state.storySearchQuery.trim()) performStorySearch(true);
      try {
        await request('/admin/api/stories/' + encodeURIComponent(storyId) + '/approve', { method: 'POST' });
        state.selectedAiStoryIds.delete(Number(storyId));
        applyStoryPatchAcrossAllLists(storyId, {
          approved: true,
          removed: false,
          decisionAction: 'approve',
          updatedAt: new Date().toISOString()
        });
        await refreshData();
        messageEl.className = 'success';
        messageEl.textContent = 'Story approved and published.';
      } catch (error) {
        messageEl.className = 'error';
        messageEl.textContent = 'Story approval failed: ' + error.message;
      } finally {
        state.approving.delete(storyId);
        renderAiStagingSection();
        if (state.storySearchQuery.trim()) performStorySearch(true);
      }
    }

    async function postStoryDecision(storyId, action, busySet, successMessage) {
      if (busySet.has(storyId)) return;
      busySet.add(storyId);
      renderStories(state.pendingStories, { pending: true });
      renderStories(state.decidedStories, { decided: true });
      renderStories(state.bannedStories, { banned: true });
      renderAiStagingSection();
      if (state.storySearchQuery.trim()) performStorySearch(true);
      try {
        await request('/admin/api/stories/' + encodeURIComponent(storyId) + '/' + action, { method: 'POST' });
        state.selectedAiStoryIds.delete(Number(storyId));
        if (action === 'disapprove') {
          applyStoryPatchAcrossAllLists(storyId, {
            approved: false,
            removed: false,
            decisionAction: 'disapprove',
            updatedAt: new Date().toISOString()
          });
        } else if (action === 'ban') {
          applyStoryPatchAcrossAllLists(storyId, {
            approved: false,
            removed: true,
            decisionAction: 'ban',
            updatedAt: new Date().toISOString()
          });
        }
        await refreshData();
        messageEl.className = 'success';
        messageEl.textContent = successMessage;
      } catch (error) {
        messageEl.className = 'error';
        messageEl.textContent = 'Story decision failed: ' + error.message;
      } finally {
        busySet.delete(storyId);
        renderStories(state.pendingStories, { pending: true });
        renderStories(state.decidedStories, { decided: true });
        renderStories(state.bannedStories, { banned: true });
        renderAiStagingSection();
        if (state.storySearchQuery.trim()) performStorySearch(true);
      }
    }

    function banStory(storyId) {
      return postStoryDecision(storyId, 'ban', state.banning, 'Story banned from public feeds.');
    }

    function disapproveStory(storyId) {
      return postStoryDecision(storyId, 'disapprove', state.unapproving, 'Story disapproved; it remains in the feed without the Littlables badge.');
    }

    function undoDecision(storyId) {
      return postStoryDecision(storyId, 'undo', state.undoing, 'Previous story decision undone.');
    }

    async function updateProvider(providerId, force = false) {
      if (state.busy.has(providerId)) return;
      state.busy.add(providerId);
      state.syncPollActive = true;
      renderProviders(state.providers);
      messageEl.className = 'muted';
      messageEl.textContent = 'Updating ' + providerId + (force ? ' (forced)…' : '…');
      try {
        const suffix = force ? '?force=1' : '';
        const result = await request('/admin/api/providers/' + encodeURIComponent(providerId) + '/update' + suffix, { method: 'POST' });
        messageEl.className = result.status === 'succeeded' ? 'success' : 'error';
        if (result.status === 'succeeded') {
          messageEl.textContent = providerId + ': saved ' + result.storiesSaved + ' stories.';
        } else if (result.rateLimited) {
          messageEl.textContent = providerId + ' hit rate limit (saved ' + result.storiesSaved +
            (result.failoverProvider ? ', failed over remaining topics to ' + result.failoverProvider + ' +' + (result.failoverStoriesSaved || 0) : '') +
            '): ' + (result.errors || []).join('; ');
        } else {
          messageEl.textContent = providerId + ' update finished with errors: ' + (result.errors || []).join('; ');
        }
      } catch (error) {
        messageEl.className = 'error';
        messageEl.textContent = providerId + ' update failed: ' + error.message;
      } finally {
        state.busy.delete(providerId);
        await refreshData();
      }
    }

    async function resetProviderSync(providerId) {
      if (!window.confirm('Clear the stuck "running" state for ' + providerId + '? Use this only if the update is genuinely stuck — it will let you run the provider again.')) return;
      if (state.busy.has(providerId)) return;
      state.busy.add(providerId);
      renderProviders(state.providers);
      messageEl.className = 'muted';
      messageEl.textContent = 'Resetting ' + providerId + '…';
      try {
        const result = await request('/admin/api/providers/' + encodeURIComponent(providerId) + '/reset', { method: 'POST' });
        if (result.reset) {
          messageEl.className = 'success';
          messageEl.textContent = providerId + ' lock cleared — you can update it again now.';
        } else {
          messageEl.className = 'muted';
          messageEl.textContent = providerId + ' was not stuck (status: ' + (result.previousStatus || 'unknown') + ').';
        }
      } catch (error) {
        messageEl.className = 'error';
        messageEl.textContent = providerId + ' reset failed: ' + error.message;
      } finally {
        state.busy.delete(providerId);
        await refreshData();
      }
    }

    async function toggleHourlyAutoSync() {
      if (state.togglingAutoSync) return;
      state.togglingAutoSync = true;
      renderProviders(state.providers);
      try {
        const nextEnabled = !(state.autoSync?.enabled);
        const res = await request('/admin/api/auto-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: nextEnabled })
        });
        if (res.autoSync) state.autoSync = res.autoSync;
        renderProviders(state.providers);
        messageEl.className = 'success';
        messageEl.textContent = state.autoSync.enabled
          ? 'Hourly automatic provider querying enabled.'
          : 'Hourly automatic provider querying paused.';
      } catch (error) {
        messageEl.className = 'error';
        messageEl.textContent = 'Could not update auto-sync setting: ' + error.message;
      } finally {
        state.togglingAutoSync = false;
        renderProviders(state.providers);
      }
    }

    async function syncAllProvidersNow() {
      if (state.syncingAll) return;
      state.syncingAll = true;
      state.syncPollActive = true;
      renderProviders(state.providers);
      messageEl.className = 'muted';
      messageEl.textContent = 'Running full sync across all configured providers…';
      try {
        const res = await request('/admin/api/providers/sync-all', { method: 'POST' });
        if (res.autoSync) state.autoSync = res.autoSync;
        await refreshData();
        messageEl.className = res.status === 'succeeded' ? 'success' : 'muted';
        messageEl.textContent = (res.autoSync?.lastSummary || ('Synced providers: ' + (res.totalStoriesSaved || 0) + ' stories saved.'));
      } catch (error) {
        messageEl.className = 'error';
        messageEl.textContent = 'Sync all providers failed: ' + error.message;
      } finally {
        state.syncingAll = false;
        renderProviders(state.providers);
      }
    }

    async function unstickAllProviders() {
      if (state.unstickingAll) return;
      state.unstickingAll = true;
      renderProviders(state.providers);
      messageEl.className = 'muted';
      messageEl.textContent = 'Clearing stuck sync locks…';
      try {
        const res = await request('/admin/api/providers/unstick-all', { method: 'POST' });
        await refreshData();
        const providersN = res.providersReset?.length || 0;
        const runsN = res.runsClosed?.length || 0;
        messageEl.className = 'success';
        messageEl.textContent = 'Unstuck ' + providersN + ' provider' + (providersN === 1 ? '' : 's') + ' and closed ' + runsN + ' stuck run' + (runsN === 1 ? '' : 's') + '.';
      } catch (error) {
        messageEl.className = 'error';
        messageEl.textContent = 'Unstick all failed: ' + error.message;
      } finally {
        state.unstickingAll = false;
        renderProviders(state.providers);
      }
    }

    function renderLogFilterOptions() {
      const logProviderSelect = document.getElementById('logs-provider-filter');
      const logCategorySelect = document.getElementById('logs-category-filter');
      const logStatusNav = document.getElementById('logs-status-tabs');
      if (logProviderSelect) {
        const currentVal = state.activeLogProvider;
        logProviderSelect.replaceChildren();
        const allOpt = document.createElement('option');
        allOpt.value = 'all';
        allOpt.textContent = 'All providers';
        logProviderSelect.append(allOpt);
        state.providers.forEach((p) => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.name;
          logProviderSelect.append(opt);
        });
        logProviderSelect.value = currentVal;
      }
      if (logCategorySelect && logCategorySelect.options.length <= 1) {
        categories.forEach((cat) => {
          const opt = document.createElement('option');
          opt.value = cat.id;
          opt.textContent = cat.label;
          logCategorySelect.append(opt);
        });
        logCategorySelect.value = state.activeLogCategory;
      }
      if (logStatusNav) {
        logStatusNav.replaceChildren();
        const statusTabs = [
          { id: 'all', label: 'All' },
          { id: 'rate_limited', label: 'Rate Limited (429)' },
          { id: 'failed', label: 'Errors' },
          { id: 'failover', label: 'Failovers' },
          { id: 'succeeded', label: 'Succeeded' }
        ];
        statusTabs.forEach((tab) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'category-tab';
          btn.setAttribute('aria-pressed', String(state.activeLogStatus === tab.id));
          btn.textContent = tab.label;
          btn.addEventListener('click', () => {
            state.activeLogStatus = tab.id;
            state.pages.logs = 1;
            renderLogFilterOptions();
            renderProviderLogs();
          });
          logStatusNav.append(btn);
        });
      }
    }

    function renderProviderLogs() {
      const summaryEl = document.getElementById('logs-summary');
      const listEl = document.getElementById('provider-logs-list');
      const countEl = document.getElementById('logs-count');
      if (!listEl || !summaryEl) return;

      const summary = state.providerLogsSummary || {
        totalRequests: state.providerLogs.length,
        rateLimitedCount: 0,
        failedCount: 0,
        failoverCount: 0,
        averageLatencyMs: 0
      };
      if (countEl) {
        countEl.textContent = summary.totalRequests ? '(' + summary.totalRequests + ')' : '';
      }

      summaryEl.replaceChildren();
      [
        { label: 'Total Fetches Logged', value: String(summary.totalRequests || 0) },
        { label: 'Rate-Limit Events (429)', value: String(summary.rateLimitedCount || 0) },
        { label: 'Topic Failovers', value: String(summary.failoverCount || 0) },
        { label: 'Avg Fetch Latency', value: (summary.averageLatencyMs || 0) + ' ms' }
      ].forEach((stat) => {
        const box = document.createElement('div');
        box.className = 'log-stat-box';
        const l = document.createElement('p');
        l.className = 'log-stat-label';
        l.textContent = stat.label;
        const v = document.createElement('p');
        v.className = 'log-stat-value tabular-nums';
        v.textContent = stat.value;
        box.append(l, v);
        summaryEl.append(box);
      });

      const filtered = state.providerLogs.filter((log) => {
        if (state.activeLogProvider !== 'all' && log.provider !== state.activeLogProvider) return false;
        if (state.activeLogCategory !== 'all' && log.category !== state.activeLogCategory) return false;
        if (state.activeLogStatus !== 'all') {
          if (state.activeLogStatus === 'failover') {
            if (!log.failoverProvider && log.triggerSource !== 'failover') return false;
          } else if (log.status !== state.activeLogStatus) {
            return false;
          }
        }
        return true;
      });

      listEl.replaceChildren();
      const pager = renderPaginationBar('logs-pagination', 'logs', filtered.length, renderProviderLogs);

      if (!filtered.length) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = state.providerLogs.length === 0
          ? 'No provider fetch logs recorded in this session yet. Click "Update" on a provider or "Sync all providers now" to capture detailed fetch telemetry.'
          : 'No fetch logs match the selected filters.';
        listEl.append(empty);
        return;
      }

      pager.slice(filtered).forEach((log) => {
        const row = document.createElement('article');
        row.className = 'log-row';
        const main = document.createElement('div');
        main.className = 'log-row-main';

        const left = document.createElement('div');
        left.className = 'log-row-left';

        const statusSpan = document.createElement('span');
        statusSpan.className = 'status status-' + String(log.status || 'never').toLowerCase();
        statusSpan.textContent = log.status === 'rate_limited'
          ? 'RATE LIMITED'
          : log.status === 'skipped_cooldown'
            ? 'COOLDOWN SKIP'
            : String(log.status || '').toUpperCase();

        const provSpan = document.createElement('span');
        provSpan.className = 'meta-provider';
        provSpan.textContent = log.providerLabel || log.provider;

        const catSpan = document.createElement('span');
        catSpan.className = 'meta-category';
        catSpan.textContent = '· ' + (log.category || 'all');

        const trigSpan = document.createElement('span');
        trigSpan.className = 'muted';
        trigSpan.textContent = '· trigger: ' + (log.triggerSource || 'manual');

        left.append(statusSpan, provSpan, catSpan, trigSpan);

        const right = document.createElement('div');
        right.className = 'log-row-right tabular-nums';
        const httpText = log.httpStatus ? 'HTTP ' + log.httpStatus : '—';
        const latencyText = (log.durationMs ?? 0) + 'ms';
        const retriesText = 'tries: ' + (log.attemptCount ?? 1);
        const storiesText = 'fetched: ' + (log.itemsFetched ?? 0) + ' · saved: ' + (log.storiesSaved ?? 0);
        const timeText = log.createdAt ? formatDateTime(new Date(log.createdAt)) : '';
        right.textContent = [httpText, latencyText, retriesText, storiesText, timeText].filter(Boolean).join(' · ');

        main.append(left, right);
        row.append(main);

        if (log.errorMessage) {
          const errP = document.createElement('p');
          errP.className = 'log-error-line';
          errP.textContent = log.errorMessage;
          row.append(errP);
        }

        if (state.expandedLogs.has(log.id)) {
          const drawer = document.createElement('div');
          drawer.className = 'log-drawer tabular-nums';
          const lines = [
            'Endpoint URL: ' + (log.requestUrl || '—'),
            'HTTP Status: ' + (log.httpStatus ?? '—') + ' · Latency: ' + (log.durationMs ?? 0) + ' ms · Attempts: ' + (log.attemptCount ?? 1),
            'Items Fetched: ' + (log.itemsFetched ?? 0) + ' · Stories Saved: ' + (log.storiesSaved ?? 0) + ' · Duplicates Skipped: ' + (log.duplicatesSkipped ?? 0),
            'Rate-Limit Headers: Retry-After=' + (log.retryAfterSeconds != null ? log.retryAfterSeconds + 's' : 'none') +
              ' · Remaining=' + (log.rateLimitRemaining ?? 'none') +
              ' · Reset=' + (log.rateLimitReset || 'none')
          ];
          if (log.failoverProvider) {
            lines.push('Failover Partner: ' + log.failoverProvider);
          }
          lines.forEach((lineText) => {
            const div = document.createElement('div');
            div.textContent = lineText;
            drawer.append(div);
          });
          row.append(drawer);
        }

        row.addEventListener('click', () => {
          if (state.expandedLogs.has(log.id)) state.expandedLogs.delete(log.id);
          else state.expandedLogs.add(log.id);
          renderProviderLogs();
        });

        listEl.append(row);
      });
    }

    async function refreshLogsOnly() {
      try {
        const data = await request('/admin/api/logs?limit=200');
        state.providerLogs = data.logs || [];
        state.providerLogsSummary = data.summary || state.providerLogsSummary;
        if (data.autoSync) state.autoSync = data.autoSync;
        renderProviderLogs();
        renderProviders(state.providers);
      } catch (error) {
        messageEl.className = 'error';
        messageEl.textContent = 'Could not refresh logs: ' + error.message;
      }
    }

    async function clearAllLogs() {
      try {
        const data = await request('/admin/api/logs/clear', { method: 'POST' });
        state.providerLogs = data.logs || [];
        state.providerLogsSummary = data.summary || {
          totalRequests: 0,
          rateLimitedCount: 0,
          failedCount: 0,
          failoverCount: 0,
          averageLatencyMs: 0
        };
        state.expandedLogs.clear();
        renderProviderLogs();
        messageEl.className = 'success';
        messageEl.textContent = 'Provider fetch logs cleared.';
      } catch (error) {
        messageEl.className = 'error';
        messageEl.textContent = 'Could not clear logs: ' + error.message;
      }
    }

    document.getElementById('refresh').addEventListener('click', refreshData);
    document.getElementById('logs-nested-toggle').addEventListener('click', () => {
      const body = document.getElementById('logs-body');
      const btn = document.getElementById('logs-nested-toggle');
      const expanded = body.hidden;
      body.hidden = !expanded;
      btn.setAttribute('aria-expanded', String(expanded));
    });
    document.getElementById('refresh-logs-btn').addEventListener('click', refreshLogsOnly);
    document.getElementById('clear-logs-btn').addEventListener('click', clearAllLogs);
    document.getElementById('logs-provider-filter').addEventListener('change', (e) => {
      state.activeLogProvider = e.target.value;
      state.pages.logs = 1;
      renderProviderLogs();
    });
    document.getElementById('logs-category-filter').addEventListener('change', (e) => {
      state.activeLogCategory = e.target.value;
      state.pages.logs = 1;
      renderProviderLogs();
    });

    function editButton(label, className = '') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preview-edit ' + className;
      button.textContent = '✏️';
      button.title = 'Edit ' + label;
      button.setAttribute('aria-label', 'Edit ' + label);
      return button;
    }

    /* Commit any open inline editors before saving the card */
    function commitAllOpenEditors() {
      document.querySelectorAll('#preview-card .preview-inline-editor').forEach((editorEl) => {
        if (typeof editorEl._commit === 'function') editorEl._commit();
      });
    }

    /* EDITABLE FIELD: Isolated per-field commit & cancel so canceling one field never closes other open fields */
    function editableField(parent, field, label, {
      tag = 'span',
      value = '',
      editor = 'text',
      className = '',
      display = val => val || 'Not set',
      onSave = null
    } = {}) {
      const currentDraft = state.previewType === 'ad' ? state.previewAdDraft : state.previewDraft;
      let currentValue = value !== '' ? value : (currentDraft?.[field] || '');
      const wrapper = document.createElement('span');
      wrapper.className = 'preview-editable ' + className;
      const visible = document.createElement(tag);
      visible.className = 'preview-value';
      if (field === 'title') {
        visible.classList.add(state.previewType === 'ad' ? 'ad-card-title' : 'news-card-title');
      }

      const updateVisibleDom = (val) => {
        visible.replaceChildren();
        const displayValue = display(val);
        if (displayValue instanceof Node) visible.append(displayValue);
        else visible.textContent = decodeHtmlEntities(displayValue);
        if (tag === 'a') {
          visible.href = currentDraft.link || currentDraft.url || '#';
          visible.target = '_blank';
          visible.rel = 'noopener noreferrer';
        }
      };
      updateVisibleDom(currentValue);

      const pencil = editButton(label);
      pencil.addEventListener('click', (event) => {
        event.stopPropagation();
        if (wrapper.classList.contains('is-editing')) return;
        visible.style.display = 'none';
        pencil.style.display = 'none';
        wrapper.classList.add('is-editing');

        const editorWrap = document.createElement('div');
        editorWrap.className = 'preview-inline-editor';
        let input;
        if (editor === 'category') {
          input = document.createElement('select');
          categories.forEach((category) => {
            const option = document.createElement('option');
            option.value = category.id;
            option.textContent = category.icon + ' ' + category.label;
            input.append(option);
          });
          input.value = currentValue || 'all';
        } else if (editor === 'network') {
          input = document.createElement('select');
          ['Amazon', 'TikTok', 'Gumroad', 'Partner'].forEach((net) => {
            const option = document.createElement('option');
            option.value = net;
            option.textContent = net;
            input.append(option);
          });
          input.value = currentValue || 'Partner';
        } else if (editor === 'textarea') {
          input = document.createElement('textarea');
          input.value = currentValue;
          input.rows = 4;
        } else {
          input = document.createElement('input');
          input.type = editor;
          input.value = editor === 'datetime-local' && currentValue
            ? (() => {
              const date = new Date(currentValue);
              date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
              return date.toISOString().slice(0, 16);
            })()
            : currentValue;
        }
        input.setAttribute('aria-label', label);
        input.placeholder = 'Enter ' + label + '…';

        const closeInlineEditor = () => {
          editorWrap.remove();
          wrapper.classList.remove('is-editing');
          visible.style.display = '';
          pencil.style.display = '';
        };

        const commitValue = () => {
          let next = input.value.trim();
          if (editor === 'datetime-local' && next) next = new Date(next).toISOString();
          if (state.previewType !== 'ad' && STORY_FIELD_LIMITS[field]) {
            next = next.slice(0, STORY_FIELD_LIMITS[field]);
          }
          currentValue = next;
          currentDraft[field] = next;
          if (onSave) onSave(next);
          updateVisibleDom(next);

          // Update live card elements in-place without destroying other open field editors
          const cardEl = wrapper.closest('.news-card');
          if (cardEl) {
            if (field === 'image') {
              const imgEl = cardEl.querySelector('.news-card-image');
              const wrapEl = cardEl.querySelector('.news-card-image-wrap');
              if (imgEl) {
                imgEl.classList.remove('is-loaded');
                if (wrapEl) wrapEl.classList.remove('is-loaded');
                imgEl.src = next || 'img/' + (currentDraft.category || 'all') + '_1.jpg';
              }
            } else if (field === 'link' || field === 'url') {
              cardEl.querySelectorAll('a').forEach((aEl) => {
                aEl.href = next || '#';
              });
            }
          }
          closeInlineEditor();
        };

        const cancelValue = () => {
          closeInlineEditor();
        };

        editorWrap._commit = commitValue;

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && editor !== 'textarea') {
            e.preventDefault();
            commitValue();
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && editor === 'textarea') {
            e.preventDefault();
            commitValue();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancelValue();
          }
        });

        const btnRow = document.createElement('div');
        btnRow.className = 'editor-btn-row';

        const done = document.createElement('button');
        done.type = 'button';
        done.className = 'small-btn';
        done.textContent = 'OK';
        done.addEventListener('click', commitValue);

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'secondary small-btn';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', cancelValue);

        btnRow.append(done, cancel);
        editorWrap.append(input, btnRow);
        wrapper.append(editorWrap);
        input.focus();
        if (typeof input.select === 'function' && editor !== 'category' && editor !== 'network') {
          input.select();
        }
      });
      wrapper.append(visible, pencil);
      parent.append(wrapper);
      return wrapper;
    }

    /* STORY PREVIEW MATCHING HOMEPAGE EXACTLY */
    function renderPreview() {
      state.previewType = 'story';
      const draft = state.previewDraft;
      if (!draft) return;
      const preview = document.getElementById('preview-card');
      preview.replaceChildren();

      const card = document.createElement('article');
      card.className = 'news-card';

      const imageWrap = document.createElement('div');
      imageWrap.className = 'news-card-image-wrap';
      const stockImages = {
        all: 'all_1.jpg',
        childcare: 'childcare_1.jpg',
        animals: 'animals_1.jpg',
        arts: 'arts_1.jpg',
        tech: 'tech_1.jpg',
        world: 'world_1.jpg',
        uplifting: 'uplifting_1.jpg'
      };
      const fallbackPreviewImg = 'img/' + (stockImages[draft.category] || stockImages.all);
      const image = document.createElement('img');
      image.className = 'news-card-image';
      image.src = draft.image || fallbackPreviewImg;
      image.alt = draft.title || '';
      attachSmoothImageLoader(image, imageWrap, fallbackPreviewImg);
      imageWrap.append(image);
      if (state.generatingImage) {
        const loadingBadge = document.createElement('div');
        loadingBadge.className = 'preview-image-loading';
        loadingBadge.textContent = '✨ Creating fun Littlables AI image…';
        imageWrap.append(loadingBadge);
      }

      editableField(imageWrap, 'category', 'category', {
        className: 'preview-category-edit',
        editor: 'category',
        display: (val) => {
          const catObj = categories.find(item => item.id === (val || draft.category)) || categories[0];
          const badge = document.createElement('span');
          badge.className = 'news-card-badge';
          badge.textContent = catObj.icon + ' ' + catObj.label;
          return badge;
        }
      });
      editableField(imageWrap, 'image', 'image URL', {
        className: 'preview-image-edit',
        editor: 'url',
        display: () => ''
      });

      const content = document.createElement('div');
      content.className = 'news-card-content';
      const meta = document.createElement('div');
      meta.className = 'news-card-meta';
      const date = document.createElement('span');
      editableField(date, 'pubDate', 'publication date', {
        display: (val) => {
          const d = val ? new Date(val) : (draft.pubDate ? new Date(draft.pubDate) : new Date());
          return '🕒 ' + d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
        },
        editor: 'datetime-local'
      });
      meta.append(date);
      editableField(meta, 'source', 'source name', { display: value => value || getStoryDomain(draft.link) });
      if (draft.approved === true) {
        const approval = document.createElement('span');
        approval.textContent = "🧸 Littlables' Little Scoop";
        meta.append(approval);
      }
      content.append(meta);

      const title = document.createElement('h3');
      title.className = 'news-card-title';
      title.id = 'preview-title';
      editableField(title, 'title', 'title', { tag: 'a', display: value => value || 'Untitled Update' });
      content.append(title);

      const description = document.createElement('p');
      description.className = 'news-card-desc';
      editableField(description, 'description', 'description', {
        tag: 'span',
        editor: 'textarea',
        display: value => value || 'No description was found on this page.'
      });
      content.append(description);

      const aiSummary = document.createElement('div');
      if (draft.aiSummary) {
        aiSummary.className = 'news-card-ai-summary';
        const aiLabel = document.createElement('div');
        aiLabel.className = 'news-card-ai-label';
        aiLabel.textContent = '✨ Quick AI Brief';
        aiSummary.append(aiLabel);
        editableField(aiSummary, 'aiSummary', 'AI summary', {
          editor: 'textarea',
          display: value => value
        });
        content.append(aiSummary);
      }

      const aiActions = document.createElement('div');
      aiActions.className = 'preview-ai-actions';

      const generateSummary = document.createElement('button');
      generateSummary.type = 'button';
      generateSummary.className = 'summary-generate';
      generateSummary.textContent = state.generatingSummary ? 'Generating…' : 'Generate AI summary';
      generateSummary.disabled = state.generatingSummary || state.generatingImage;
      generateSummary.addEventListener('click', generatePreviewSummary);

      const generateImage = document.createElement('button');
      generateImage.type = 'button';
      generateImage.className = 'summary-generate image-generate';
      generateImage.textContent = state.generatingImage ? 'Generating image…' : 'Generate AI image';
      generateImage.disabled = state.generatingImage || state.generatingSummary;
      generateImage.addEventListener('click', generatePreviewImage);

      aiActions.append(generateSummary, generateImage);
      content.append(aiActions);

      const footer = document.createElement('div');
      footer.className = 'news-card-footer';
      const readMore = document.createElement('a');
      readMore.className = 'news-read-more-btn';
      readMore.href = draft.link;
      readMore.target = '_blank';
      readMore.rel = 'noopener noreferrer';
      readMore.textContent = 'Read Full Story →';
      footer.append(readMore);

      editableField(footer, 'link', 'article URL', {
        tag: 'span',
        editor: 'url',
        display: () => 'Link'
      });

      const reactions = document.createElement('div');
      reactions.className = 'news-card-reactions';
      ['❤️ 0', '🤯 0', '☕ 0'].forEach((r) => {
        const pill = document.createElement('span');
        pill.className = 'reaction-pill';
        pill.textContent = r;
        reactions.append(pill);
      });
      footer.append(reactions);

      card.append(imageWrap, content);
      preview.append(card);

      const context = document.createElement('div');
      context.className = 'preview-context';
      const contextTitle = document.createElement('strong');
      contextTitle.textContent = 'AI summary source content';
      context.append(contextTitle);
      editableField(context, 'content', 'AI summary source content', {
        editor: 'textarea',
        display: value => value || 'No extra source content'
      });
      preview.append(context);

      // ── Full story fields: the entire JSON object, viewable here.
      // Everything with a write path is editable: keywords and display
      // categories save with this preview via their dedicated endpoints.
      const fieldsSection = document.createElement('div');
      fieldsSection.className = 'preview-context';
      const fieldsTitle = document.createElement('strong');
      fieldsTitle.textContent = 'All story fields';
      fieldsSection.append(fieldsTitle);
      const fieldsHint = document.createElement('p');
      fieldsHint.className = 'admin-hint';
      fieldsHint.textContent = 'Interest keywords and display categories save with this preview. ID, country and region are derived values, shown for reference.';
      fieldsSection.append(fieldsHint);

      const kwLabel = document.createElement('div');
      kwLabel.style.cssText = 'font-weight:600;margin-top:0.5rem;';
      kwLabel.textContent = 'Interest keywords';
      fieldsSection.append(kwLabel);
      const kwChips = document.createElement('div');
      kwChips.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.35rem;margin:0.35rem 0;';
      const renderKwChips = () => {
        kwChips.replaceChildren();
        const current = Array.isArray(draft.interest_keywords) ? draft.interest_keywords : [];
        if (current.length === 0) {
          const none = document.createElement('span');
          none.className = 'admin-hint';
          none.textContent = 'No keywords';
          kwChips.append(none);
        }
        current.forEach((kwId) => {
          const found = (window.LITTLABLES_KEYWORDS || []).find((k) => k.id === kwId);
          const chip = document.createElement('span');
          chip.className = 'meta-badge-status meta-approved';
          chip.style.cssText = 'cursor:pointer;';
          chip.textContent = (found ? ((found.icon ? found.icon + ' ' : '') + found.label) : kwId) + ' ×';
          chip.title = 'Remove';
          chip.addEventListener('click', () => {
            draft.interest_keywords = draft.interest_keywords.filter((k) => k !== kwId);
            renderKwChips();
          });
          kwChips.append(chip);
        });
      };
      renderKwChips();
      fieldsSection.append(kwChips);
      const kwPickerBtn = document.createElement('button');
      kwPickerBtn.type = 'button';
      kwPickerBtn.className = 'secondary small-btn';
      kwPickerBtn.textContent = 'Edit keywords…';
      const kwPickerWrap = document.createElement('div');
      kwPickerBtn.addEventListener('click', () => {
        if (kwPickerWrap.children.length > 0) { kwPickerWrap.replaceChildren(); return; }
        const picker = document.createElement('div');
        picker.style.cssText = 'display:flex;flex-direction:column;gap:0.5rem;margin-top:0.4rem;max-height:22rem;overflow-y:auto;padding:0.5rem;border:1px solid var(--news-border, #334155);border-radius:0.5rem;';
        const hint = document.createElement('span');
        hint.className = 'admin-hint';
        hint.textContent = 'Uncheck all to clear.';
        picker.append(hint);
        const boxes = [];
        const groups = [];
        (window.LITTLABLES_KEYWORDS || []).forEach((kw) => {
          if (groups.indexOf(kw.group) === -1) groups.push(kw.group);
        });
        groups.forEach((group) => {
          const groupTitle = document.createElement('strong');
          groupTitle.style.cssText = 'font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.8;margin-top:0.25rem;';
          groupTitle.textContent = group;
          picker.append(groupTitle);
          const groupRow = document.createElement('div');
          groupRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.35rem;align-items:center;';
          (window.LITTLABLES_KEYWORDS || []).filter((kw) => kw.group === group).forEach((kw) => {
            const lab = document.createElement('label');
            lab.style.cssText = 'display:flex;align-items:center;gap:0.25rem;font-size:0.8rem;cursor:pointer;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = kw.id;
            cb.checked = (draft.interest_keywords || []).indexOf(kw.id) !== -1;
            lab.append(cb);
            lab.append(document.createTextNode((kw.icon ? kw.icon + ' ' : '') + kw.label));
            groupRow.append(lab);
            boxes.push(cb);
          });
          picker.append(groupRow);
        });
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:0.5rem;margin-top:0.25rem;';
        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'small-btn';
        applyBtn.textContent = 'Apply';
        applyBtn.addEventListener('click', () => {
          draft.interest_keywords = boxes.filter((cb) => cb.checked).map((cb) => cb.value);
          renderKwChips();
          kwPickerWrap.replaceChildren();
        });
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'secondary small-btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => kwPickerWrap.replaceChildren());
        btnRow.append(applyBtn, cancelBtn);
        picker.append(btnRow);
        kwPickerWrap.append(picker);
      });
      fieldsSection.append(kwPickerBtn, kwPickerWrap);

      const catLabel = document.createElement('div');
      catLabel.style.cssText = 'font-weight:600;margin-top:0.75rem;';
      catLabel.textContent = 'Display categories (override)';
      fieldsSection.append(catLabel);
      const catRow = document.createElement('div');
      catRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.35rem;align-items:center;margin:0.35rem 0;';
      ['childcare', 'animals', 'arts', 'tech', 'world', 'uplifting'].forEach((catId) => {
        const catObj = categories.find((c) => c.id === catId) || { label: catId };
        const lab = document.createElement('label');
        lab.style.cssText = 'display:flex;align-items:center;gap:0.25rem;font-size:0.8rem;cursor:pointer;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = catId;
        cb.checked = Array.isArray(draft.display_categories) && draft.display_categories.indexOf(catId) !== -1;
        cb.addEventListener('change', () => {
          const chosen = Array.from(catRow.querySelectorAll('input:checked')).map((el) => el.value);
          draft.display_categories = chosen.length > 0 ? chosen : null;
        });
        lab.append(cb);
        lab.append(document.createTextNode(catObj.icon ? catObj.icon + ' ' + catObj.label : catObj.label));
        catRow.append(lab);
      });
      fieldsSection.append(catRow);

      const fieldRow = (label, value, note) => {
        const row = document.createElement('div');
        row.style.cssText = 'font-size:0.85rem;margin-top:0.35rem;overflow-wrap:anywhere;';
        const strong = document.createElement('strong');
        strong.textContent = label + ': ';
        row.append(strong);
        row.append(document.createTextNode(value === '' || value == null ? '—' : String(value)));
        if (note) {
          const hint = document.createElement('span');
          hint.className = 'admin-hint';
          hint.textContent = ' ' + note;
          row.append(hint);
        }
        fieldsSection.append(row);
      };
      editableField(fieldsSection, 'provider', 'provider', { display: (value) => value || 'Not set' });
      fieldRow('ID', draft.id, draft.id == null ? '(new story)' : '');
      fieldRow('Country code', draft.country_code, 'derived from keywords');
      fieldRow('Region', draft.region, 'derived from keywords');
      fieldRow('Provider country', draft.provider_country, 'derived from provider data');

      const rawBtn = document.createElement('button');
      rawBtn.type = 'button';
      rawBtn.className = 'secondary small-btn';
      rawBtn.style.marginTop = '0.75rem';
      rawBtn.textContent = 'Show raw JSON';
      const rawWrap = document.createElement('div');
      rawBtn.addEventListener('click', () => {
        if (rawWrap.children.length > 0) {
          rawWrap.replaceChildren();
          rawBtn.textContent = 'Show raw JSON';
          return;
        }
        const pre = document.createElement('pre');
        pre.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font-size:0.75rem;background:rgba(0,0,0,0.25);padding:0.5rem;border-radius:0.5rem;max-height:20rem;overflow-y:auto;margin-top:0.4rem;';
        pre.textContent = JSON.stringify(draft, null, 2);
        rawWrap.append(pre);
        rawBtn.textContent = 'Hide raw JSON';
      });
      fieldsSection.append(rawBtn, rawWrap);

      preview.append(fieldsSection);

      if (state.previewStatusMessage) {
        const statusMsg = document.createElement('p');
        statusMsg.id = 'preview-status';
        statusMsg.className = 'preview-status-msg ' + (state.previewStatusType || 'muted');
        statusMsg.textContent = state.previewStatusMessage;
        preview.append(statusMsg);
      }

      const actions = document.createElement('div');
      actions.className = 'preview-actions';
      const close = document.createElement('button');
      close.id = 'preview-close';
      close.type = 'button';
      close.className = 'secondary small-btn';
      close.textContent = 'Close';
      close.addEventListener('click', () => previewDialog.close());
      actions.append(close);

      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'small-btn';
      save.textContent = state.previewStoryId === null ? 'Add to approved stories' : 'Save';
      save.addEventListener('click', () => savePreview(false));
      actions.append(save);

      if (state.previewStoryId !== null && draft.approved !== true && draft.removed !== true) {
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.className = 'small-btn';
        approve.textContent = 'Save & approve';
        approve.addEventListener('click', () => savePreview(true));
        actions.append(approve);
      }
      preview.append(actions);
    }

    /* AD PREVIEW MATCHING HOMEPAGE AD CARD EXACTLY */
    function renderAdPreview() {
      state.previewType = 'ad';
      const draft = state.previewAdDraft;
      if (!draft) return;
      const preview = document.getElementById('preview-card');
      preview.replaceChildren();

      const card = document.createElement('article');
      card.className = 'news-card news-card-ad';

      const fallbackAdPreviewImg = 'img/' + (draft.category || 'all') + '_1.jpg';
      const imageWrap = document.createElement('div');
      imageWrap.className = 'news-card-image-wrap';
      const image = document.createElement('img');
      image.className = 'news-card-image';
      image.src = draft.img || fallbackAdPreviewImg;
      image.alt = draft.title || '';
      attachSmoothImageLoader(image, imageWrap, fallbackAdPreviewImg);
      imageWrap.append(image);

      const badge = document.createElement('span');
      badge.className = 'news-card-badge ad-badge';
      badge.textContent = 'SPONSORED';
      imageWrap.append(badge);

      editableField(imageWrap, 'image', 'image URL', {
        className: 'preview-image-edit',
        editor: 'url',
        value: draft.img,
        display: () => '',
        onSave: (val) => { draft.img = val; }
      });

      editableField(imageWrap, 'category', 'category', {
        className: 'preview-category-edit',
        editor: 'category',
        value: draft.category,
        display: (val) => {
          const catObj = categories.find(item => item.id === (val || draft.category)) || categories[0];
          const catSpan = document.createElement('span');
          catSpan.className = 'news-card-badge';
          catSpan.style.background = '#0f172a';
          catSpan.textContent = catObj.icon + ' ' + catObj.label;
          return catSpan;
        },
        onSave: (val) => { draft.category = val; }
      });

      const content = document.createElement('div');
      content.className = 'news-card-content';

      const meta = document.createElement('div');
      meta.className = 'news-card-meta';
      const sponsorLabel = document.createElement('span');
      sponsorLabel.className = 'ad-sponsor-label';
      editableField(sponsorLabel, 'sponsor', 'sponsor name', {
        value: draft.sponsor,
        display: v => '📢 ' + (v || 'Featured Partner'),
        onSave: (val) => { draft.sponsor = val; }
      });
      meta.append(sponsorLabel);

      const networkLabel = document.createElement('span');
      networkLabel.className = 'ad-network-label';
      editableField(networkLabel, 'network', 'ad network', {
        editor: 'network',
        value: draft.network,
        display: v => v || 'Featured Partner',
        onSave: (val) => { draft.network = val; }
      });
      meta.append(networkLabel);
      content.append(meta);

      const title = document.createElement('h3');
      title.className = 'news-card-title ad-card-title';
      title.id = 'preview-title';
      editableField(title, 'title', 'ad title', {
        tag: 'a',
        value: draft.title,
        display: v => v || 'Curated Discovery',
        onSave: (val) => { draft.title = val; }
      });
      content.append(title);

      const desc = document.createElement('p');
      desc.className = 'news-card-desc ad-card-description';
      editableField(desc, 'desc', 'ad description', {
        editor: 'textarea',
        value: draft.desc,
        display: v => v || 'Add ad description here...',
        onSave: (val) => { draft.desc = val; }
      });
      content.append(desc);

      const footer = document.createElement('div');
      footer.className = 'news-card-footer';
      const ctaBtn = document.createElement('span');
      ctaBtn.className = 'ad-cta-btn';
      editableField(ctaBtn, 'cta', 'CTA button text', {
        value: draft.cta,
        display: v => v || 'Explore Free →',
        onSave: (val) => { draft.cta = val; }
      });
      footer.append(ctaBtn);

      editableField(footer, 'url', 'destination URL', {
        editor: 'url',
        value: draft.url,
        display: () => 'Link URL',
        onSave: (val) => { draft.url = val; }
      });
      content.append(footer);

      card.append(imageWrap, content);
      preview.append(card);

      if (state.previewStatusMessage) {
        const statusMsg = document.createElement('p');
        statusMsg.id = 'preview-status';
        statusMsg.className = 'preview-status-msg ' + (state.previewStatusType || 'muted');
        statusMsg.textContent = state.previewStatusMessage;
        preview.append(statusMsg);
      }

      const actions = document.createElement('div');
      actions.className = 'preview-actions';
      const close = document.createElement('button');
      close.id = 'preview-close';
      close.type = 'button';
      close.className = 'secondary small-btn';
      close.textContent = 'Close';
      close.addEventListener('click', () => previewDialog.close());
      actions.append(close);

      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'small-btn';
      save.textContent = state.previewAdId ? 'Save' : 'Create';
      save.addEventListener('click', saveAdPreview);
      actions.append(save);

      const genImage = document.createElement('button');
      genImage.type = 'button';
      genImage.className = 'secondary small-btn';
      genImage.textContent = state.generatingAdImage ? 'Generating image…' : 'Generate AI image';
      genImage.disabled = !!state.generatingAdImage;
      genImage.addEventListener('click', generateAdPreviewImage);
      actions.append(genImage);

      preview.append(actions);
    }

    async function generateAdPreviewImage() {
      const draft = state.previewAdDraft;
      if (!draft || state.generatingAdImage) return;
      state.generatingAdImage = true;
      renderAdPreview();
      try {
        const result = await request('/admin/api/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: draft.title,
            description: draft.desc,
            category: draft.category,
            link: draft.url && draft.url !== 'https://' ? draft.url : undefined
          })
        });
        draft.img = result.image;
        state.previewStatusType = 'success';
        state.previewStatusMessage = 'AI image generated! Click Save to keep this image.';
      } catch (error) {
        state.previewStatusType = 'error';
        state.previewStatusMessage = 'Could not generate AI image: ' + error.message;
      } finally {
        state.generatingAdImage = false;
        renderAdPreview();
      }
    }

    const STORY_FIELD_LIMITS = {
      title: 500,
      description: 4000,
      content: 4000,
      aiSummary: 4000,
      source: 500
    };

    function trimStoryDraftFields(draft) {
      if (!draft || typeof draft !== 'object') return draft;
      for (const [field, maxLen] of Object.entries(STORY_FIELD_LIMITS)) {
        if (typeof draft[field] === 'string') {
          draft[field] = draft[field].trim().slice(0, maxLen);
        }
      }
      return draft;
    }

    function openStoryPreview(story) {
      state.previewType = 'story';
      state.previewStoryId = story.id ?? null;
      state.previewStatusMessage = '';
      state.previewStatusType = 'muted';
      // Carry every field the caller had into the draft, so the preview shows
      // the entire story object — not just the 11 display fields it used to keep.
      const keywords = story.interest_keywords || story.interestKeywords || [];
      const cats = story.display_categories !== undefined && story.display_categories !== null
        ? story.display_categories
        : (story.displayCategories !== undefined && story.displayCategories !== null ? story.displayCategories : null);
      state.previewOrigKeywords = Array.isArray(keywords) ? [...keywords] : [];
      state.previewOrigCats = Array.isArray(cats) ? [...cats] : null;
      state.previewDraft = trimStoryDraftFields({
        id: story.id ?? null,
        title: decodeHtmlEntities(story.title || ''),
        link: decodeHtmlEntities(story.link || ''),
        image: decodeHtmlEntities(story.image || ''),
        description: decodeHtmlEntities(story.description || ''),
        content: decodeHtmlEntities(story.content || ''),
        aiSummary: decodeHtmlEntities(story.aiSummary || ''),
        pubDate: story.pubDate || story.publishedAt || new Date().toISOString(),
        source: story.source || story.provider || '',
        provider: story.provider || story.source || '',
        category: story.category || story.queryCategory || 'all',
        interest_keywords: state.previewOrigKeywords,
        display_categories: state.previewOrigCats,
        country_code: story.country_code || story.countryCode || '',
        region: story.region || '',
        provider_country: story.provider_country || story.providerCountry || '',
        approved: story.approved === true,
        removed: story.removed === true
      });
      renderPreview();
      lockModalScroll();
      if (!previewDialog.open) previewDialog.showModal();
      previewDialog.scrollTop = 0;
    }

    function openAdPreview(ad) {
      state.previewType = 'ad';
      state.previewAdId = ad ? ad.id : null;
      state.previewStatusMessage = '';
      state.previewStatusType = 'muted';
      state.previewAdDraft = ad ? { ...ad } : {
        id: 'ad-' + Date.now(),
        title: 'New Curated Discovery',
        desc: 'Handpicked products and creative tools tailored for mindful families and curious creators.',
        img: 'img/all_1.jpg',
        sponsor: 'Featured Partner',
        cta: 'Explore Now →',
        url: 'https://',
        category: 'all',
        network: 'Partner',
        price: 'Free'
      };
      renderAdPreview();
      lockModalScroll();
      if (!previewDialog.open) previewDialog.showModal();
      previewDialog.scrollTop = 0;
    }

    async function savePreview(approve) {
      commitAllOpenEditors();
      const draft = trimStoryDraftFields(state.previewDraft);
      const existingId = state.previewStoryId;
      try {
        let storyId = existingId;
        if (existingId === null) {
          const created = await request('/admin/api/stories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draft)
          });
          storyId = created.id;
        } else {
          await request('/admin/api/stories/' + encodeURIComponent(existingId), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draft)
          });
          if (approve) {
            await request('/admin/api/stories/' + encodeURIComponent(existingId) + '/approve', { method: 'POST' });
          }
          applyStoryPatchAcrossAllLists(existingId, {
            title: draft.title,
            link: draft.link,
            image: draft.image,
            description: draft.description,
            content: draft.content,
            aiSummary: draft.aiSummary,
            pubDate: draft.pubDate,
            source: draft.source,
            category: draft.category,
            updatedAt: new Date().toISOString(),
            ...(approve ? { approved: true, removed: false, decisionAction: 'approve' } : {})
          });
          // Keep the validation list row in sync with preview edits.
          patchValidationRow(existingId, {
            title: draft.title,
            articleUrl: draft.link,
            imageUrl: draft.image,
            description: draft.description,
            provider: draft.source,
            publishedAt: draft.pubDate,
            queryCategory: draft.category,
            ...(approve ? { approved: true } : {})
          });
        }
        // The main story PATCH only writes the 9 core columns, so keyword
        // and display-category overrides go through their dedicated endpoints.
        const keywordsChanged = JSON.stringify(draft.interest_keywords || []) !== JSON.stringify(state.previewOrigKeywords || []);
        const catsChanged = JSON.stringify(draft.display_categories || null) !== JSON.stringify(state.previewOrigCats || null);
        if (storyId != null && keywordsChanged) {
          await request('/admin/api/stories/' + encodeURIComponent(storyId) + '/interest-keywords', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ interest_keywords: (draft.interest_keywords || []).length > 0 ? draft.interest_keywords : null })
          });
        }
        if (storyId != null && catsChanged) {
          await request('/admin/api/stories/' + encodeURIComponent(storyId) + '/display-categories', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ display_categories: draft.display_categories })
          });
        }
        previewDialog.close();
        await refreshData();
        messageEl.className = 'success';
        messageEl.textContent = existingId === null
          ? 'Custom story added to the approved feed.'
          : approve
            ? 'Story changes saved and approved.'
            : 'Story changes saved.';
      } catch (error) {
        state.previewStatusType = 'error';
        state.previewStatusMessage = 'Could not save story: ' + error.message;
        renderPreview();
        messageEl.className = 'error';
        messageEl.textContent = 'Could not save story: ' + error.message;
      }
    }

    async function saveAdPreview() {
      commitAllOpenEditors();
      const draft = state.previewAdDraft;
      const existingId = state.previewAdId;
      try {
        if (existingId) {
          const res = await request('/admin/api/ads/' + encodeURIComponent(existingId), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draft)
          });
          const idx = state.ads.findIndex(a => String(a.id) === String(existingId));
          if (idx !== -1) Object.assign(state.ads[idx], res.ad || draft);
        } else {
          const res = await request('/admin/api/ads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draft)
          });
          if (res.ad) state.ads.unshift(res.ad);
          else state.ads.unshift(draft);
        }
        previewDialog.close();
        filterAndRenderAds();
        messageEl.className = 'success';
        messageEl.textContent = existingId ? 'Ad changes saved.' : 'New ad created and saved.';
      } catch (error) {
        messageEl.className = 'error';
        messageEl.textContent = 'Could not save ad: ' + error.message;
      }
    }

    async function generatePreviewSummary() {
      commitAllOpenEditors();
      if (!state.previewDraft || state.generatingSummary || state.generatingImage) return;
      trimStoryDraftFields(state.previewDraft);
      state.generatingSummary = true;
      state.previewStatusType = 'muted';
      state.previewStatusMessage = 'Generating an AI summary from the current story details…';
      renderPreview();
      messageEl.className = 'muted';
      messageEl.textContent = 'Generating an AI summary from the current story details…';
      try {
        const result = await request('/admin/api/summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state.previewDraft)
        });
        state.previewDraft.aiSummary = result.summary;
        state.previewStatusType = 'success';
        state.previewStatusMessage = 'AI summary generated. Save the card to publish it.';
        messageEl.className = 'success';
        messageEl.textContent = 'AI summary generated. Save the card to publish it.';
      } catch (error) {
        state.previewStatusType = 'error';
        state.previewStatusMessage = 'Could not generate AI summary: ' + error.message;
        messageEl.className = 'error';
        messageEl.textContent = 'Could not generate AI summary: ' + error.message;
      } finally {
        state.generatingSummary = false;
        renderPreview();
      }
    }

    async function generatePreviewImage() {
      commitAllOpenEditors();
      if (!state.previewDraft || state.generatingImage || state.generatingSummary) return;
      trimStoryDraftFields(state.previewDraft);
      state.generatingImage = true;
      state.previewStatusType = 'muted';
      state.previewStatusMessage = 'Generating a fun Littlables AI image from the story details…';
      renderPreview();
      messageEl.className = 'muted';
      messageEl.textContent = 'Generating a fun Littlables AI image from the story details…';
      try {
        const result = await request('/admin/api/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state.previewDraft)
        });
        state.previewDraft.image = result.image;
        state.previewStatusType = 'success';
        state.previewStatusMessage = 'AI image generated! Click Save to keep this image.';
        messageEl.className = 'success';
        messageEl.textContent = 'AI image generated. Save the card to publish it.';
      } catch (error) {
        state.previewStatusType = 'error';
        state.previewStatusMessage = 'Could not generate AI image: ' + error.message;
        messageEl.className = 'error';
        messageEl.textContent = 'Could not generate AI image: ' + error.message;
      } finally {
        state.generatingImage = false;
        renderPreview();
      }
    }

    async function parseCustomLink() {
      const input = document.getElementById('custom-link');
      const value = input.value.trim();
      if (!value) return;
      let url;
      try {
        url = new URL(value);
      } catch {
        messageEl.className = 'error';
        messageEl.textContent = 'Paste a valid article URL.';
        return;
      }
      if (!['http:', 'https:'].includes(url.protocol)) {
        messageEl.className = 'error';
        messageEl.textContent = 'Only HTTP and HTTPS links can be previewed.';
        return;
      }
      messageEl.className = 'muted';
      messageEl.textContent = 'Parsing custom article…';
      try {
        const data = await request('/admin/api/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.href })
        });
        openStoryPreview({
          ...data,
          pubDate: data.pubDate || new Date().toISOString(),
          category: state.activeCategory,
          provider: 'custom',
          approved: false,
          removed: false
        });
        messageEl.className = 'success';
        messageEl.textContent = 'Custom card preview ready.';
      } catch (error) {
        messageEl.className = 'error';
        messageEl.textContent = 'Could not preview this link: ' + error.message;
      }
    }

    function queueCustomPreview() {
      clearTimeout(state.previewTimer);
      state.previewTimer = setTimeout(parseCustomLink, 500);
    }

    const customLink = document.getElementById('custom-link');
    customLink.addEventListener('input', queueCustomPreview);
    customLink.addEventListener('paste', () => setTimeout(queueCustomPreview, 0));

    request('/admin/api/identity')
      .then((data) => { document.getElementById('identity').textContent = 'Signed in as @' + data.login; })
      .catch((error) => { document.getElementById('identity').textContent = error.message; });

    document.getElementById('logout').addEventListener('click', async () => {
      try {
        const response = await fetch('/admin/logout', { method: 'POST' });
        if (!response.ok) throw new Error('Sign out failed (HTTP ' + response.status + ')');
        window.location.assign('/admin');
      } catch (error) {
        messageEl.className = 'error';
        messageEl.textContent = error.message;
      }
    });

    providerFilterEl.addEventListener('change', () => {
      state.activeProvider = providerFilterEl.value;
      refreshData();
    });

    document.getElementById('stage-halloween-btn').addEventListener('click', async () => {
      const btn = document.getElementById('stage-halloween-btn');
      const statusEl = document.getElementById('stage-halloween-status');
      btn.disabled = true;
      statusEl.className = 'muted';
      statusEl.textContent = 'Staging Halloween batch…';
      try {
        const result = await request('/admin/api/stories/stage-halloween-batch', { method: 'POST' });
        statusEl.textContent = result.staged
          + ' Halloween stories staged in Pending Approval, with images and interests on '
          + result.interestsSet + ' of them'
          + (result.duplicatesSkipped ? ' (' + result.duplicatesSkipped + ' already there, skipped)' : '')
          + (result.interestsFailed ? ' — interests failed on ' + result.interestsFailed + ', try the button again' : '')
          + '. Approve or reject them as usual.';
        await refreshData();
      } catch (error) {
        statusEl.className = 'error';
        statusEl.textContent = error.message;
      } finally {
        btn.disabled = false;
      }
    });

    historyProviderFilterEl.addEventListener('change', () => {
      state.activeHistoryProvider = historyProviderFilterEl.value;
      state.pages.decided = 1;
      renderStories(state.decidedStories, { decided: true });
      refreshStoryAges();
    });


    async function checkStaleHourlySync() {
      if (state.syncingAll || state.curatingAi) return;
      const syncEnabled = state.autoSync?.enabled;
      const nextMs = Date.parse(state.autoSync?.nextRunAt || '');
      const syncDue = syncEnabled && (!Number.isFinite(nextMs) || Date.now() >= nextMs);
      const aiDue = state.aiCuration?.enabled && state.aiCuration?.isSlotDue;
      if (!syncDue && !aiDue) return;
      try {
        const res = await request('/admin/api/auto-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'check_stale' })
        });
        if (res.triggered || res.aiTriggered) {
          await refreshData();
          if (res.aiTriggered && res.aiRun?.summaryText) {
            messageEl.className = 'success';
            messageEl.textContent = 'Scheduled AI Curation completed: ' + res.aiRun.summaryText;
          }
        } else {
          if (res.autoSync) {
            state.autoSync = res.autoSync;
            renderProviders(state.providers);
          }
          if (res.aiCuration) {
            state.aiCuration = res.aiCuration;
            renderAiStagingSection();
          }
        }
      } catch {}
    }

    /* Embedding category validation */
    // Registry of rendered validation rows by story id, so row content can
    // update live when a story is edited/approved from its row or its preview.
    var validationRowRegistry = new Map();
    var patchValidationRow = function (storyId, patch) {
      var entry = validationRowRegistry.get(Number(storyId));
      if (!entry || !patch) return;
      Object.assign(entry.m, patch);
      var fresh = entry.render(entry.m);
      entry.row.replaceWith(fresh);
      validationRowRegistry.set(Number(storyId), { m: entry.m, row: fresh, render: entry.render });
    };
    var updateValidationRowApproval = function (storyId, approved) {
      patchValidationRow(storyId, { approved: approved === true });
    };
    const validateBtn = document.getElementById('validate-categories-btn');
    const validateStatus = document.getElementById('validate-categories-status');
    const validateResults = document.getElementById('validate-categories-results');
    if (validateBtn) {
      validateBtn.addEventListener('click', async () => {
        validateBtn.disabled = true;
        validateBtn.textContent = 'Validating…';
        if (validateResults) validateResults.replaceChildren();
        const BATCH_SIZE = 20;
        const totalRequested = parseInt(document.getElementById('validate-categories-limit').value, 10) || 200;
        let totalValidated = 0;
        let allMismatches = [];
        let allValidatedStories = [];
        try {
          let totalStored = 0;
          let storeError = null;
          let warmupRounds = 0;
          const MAX_WARMUP_ROUNDS = 12;
          // Fast warmup status check first (1 DB read, 0 AI calls) so progress
          // shows immediately instead of waiting for a slow backfill round.
          try {
            const chkRes = await fetch('/admin/api/stories/validate-categories', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ warmup_check: true }),
            });
            const chk = await chkRes.json();
            if (chkRes.ok && chk.warmingUp && validateStatus) {
              validateStatus.textContent = 'Warming up keyword vectors (' + chk.warmupDone + '/' + chk.warmupTotal + ')…';
            }
          } catch (chkErr) {
            // Non-fatal: the main loop will surface warmup state anyway.
          }
          while (totalValidated < totalRequested) {
            const remaining = totalRequested - totalValidated;
            if (validateStatus) validateStatus.textContent = 'Validating… (' + totalValidated + '/' + totalRequested + ' done)';
            const catFilter = (document.getElementById('validate-category-filter')?.value || '').trim();
            const postBody = { limit: Math.min(BATCH_SIZE, remaining) };
            if (catFilter) postBody.category = catFilter;
            const res = await fetch('/admin/api/stories/validate-categories', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(postBody),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Validation failed');
            if (data.warmingUp) {
              // Keyword vectors are still backfilling: keep going automatically
              // until they are complete, then story validation proceeds.
              warmupRounds += 1;
              if (warmupRounds > MAX_WARMUP_ROUNDS) {
                throw new Error('Keyword warmup is not progressing' + (data.status ? ' — ' + data.status : '') + '. Check the worker logs.');
              }
              if (validateStatus) validateStatus.textContent = 'Warming up keyword vectors (' + data.warmupDone + '/' + data.warmupTotal + ')…';
              continue;
            }
            totalValidated += data.validated;
            totalStored += data.stored || 0;
            if (data.storeError && !storeError) storeError = data.storeError;
            allMismatches = allMismatches.concat(data.mismatches || []);
            allValidatedStories = allValidatedStories.concat(data.results || []);
            if (data.validated === 0) break;
          }
          if (validateStatus) {
            let msg = 'Validated ' + totalValidated + ' stories, ' + allMismatches.length + ' mismatches found.';
            msg += ' (' + totalStored + ' stored)';
            if (storeError) msg += ' Error: ' + storeError;
            validateStatus.textContent = msg;
          }
          if (validateResults) {
            // Collect from batch loop (we'll accumulate in the loop above)
            if (allValidatedStories.length === 0) {
              const p = document.createElement('p');
              p.className = 'admin-hint';
              p.textContent = 'No stories were validated in this run.';
              validateResults.appendChild(p);
            } else {
              var OVERRIDABLE_IDS = ['childcare', 'animals', 'arts', 'tech', 'world', 'uplifting'];
              var catLabel = function (id) {
                var found = categories.find(function (c) { return c.id === id; });
                return found ? found.label : id;
              };
              var kwLabel = function (id) {
                var found = (window.LITTLABLES_KEYWORDS || []).find(function (k) { return k.id === id; });
                return found ? ((found.icon ? found.icon + ' ' : '') + found.label) : id;
              };
              var fmtValDate = function (m) {
                var raw = m.publishedAt || m.fetchedAt;
                if (!raw) return '';
                var d = new Date(raw);
                return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
              };
              var refreshValidationRow = function (row, m) {
                var fresh = createValidationRow(m);
                row.replaceWith(fresh);
              };
              var applyDisplayCategories = function (storyId, cats, row, m, btns) {
                btns.forEach(function (b) { b.disabled = true; });
                fetch('/admin/api/stories/' + storyId + '/display-categories', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ display_categories: cats }),
                }).then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
                  .then(function (out) {
                    if (!out.ok) throw new Error(out.data.error || 'Update failed');
                    m.displayCategories = out.data.display_categories;
                    refreshValidationRow(row, m);
                  })
                  .catch(function (err) {
                    if (validateStatus) validateStatus.textContent = 'Category update failed: ' + (err.message || 'unknown error');
                    btns.forEach(function (b) { b.disabled = false; });
                  });
              };
              var applyInterestKeywords = function (storyId, keywords, row, m, btns) {
                btns.forEach(function (b) { b.disabled = true; });
                fetch('/admin/api/stories/' + storyId + '/interest-keywords', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ interest_keywords: keywords }),
                }).then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
                  .then(function (out) {
                    if (!out.ok) throw new Error(out.data.error || 'Update failed');
                    m.interestKeywords = out.data.interest_keywords;
                    refreshValidationRow(row, m);
                  })
                  .catch(function (err) {
                    if (validateStatus) validateStatus.textContent = 'Keyword update failed: ' + (err.message || 'unknown error');
                    btns.forEach(function (b) { b.disabled = false; });
                  });
              };
              var createValidationRow = function (m) {
                if (m.approved !== true) m.approved = false;
                var row = document.createElement('article');
                row.className = 'story';
                row.tabIndex = 0;
                row.dataset.mismatch = m._isMismatch ? '1' : '0';
                row.style.borderLeft = m._isMismatch ? '3px solid #ef4444' : '3px solid #22c55e';
                row.setAttribute('aria-label', 'Preview story: ' + decodeHtmlEntities(m.title || 'Untitled'));
                var openValidationPreview = function () {
                  openStoryPreview({
                    id: m.id,
                    title: m.title,
                    link: m.articleUrl,
                    image: m.imageUrl,
                    description: m.description,
                    category: m.queryCategory,
                    provider: m.provider,
                    source: m.provider,
                    pubDate: m.publishedAt,
                    interest_keywords: m.interestKeywords,
                    display_categories: m.displayCategories,
                    approved: false,
                    removed: false
                  });
                };
                row.addEventListener('click', function (event) {
                  if (event.target.closest('button, input, label, select, textarea')) return;
                  openValidationPreview();
                });
                row.addEventListener('keydown', function (event) {
                  if (event.target === row && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    openValidationPreview();
                  }
                });

                var fallbackImg = 'https://littlables.com/img/' + (m.queryCategory || 'all') + '_1.jpg';
                var image = document.createElement('img');
                image.src = m.imageUrl || fallbackImg;
                image.alt = '';
                image.loading = 'lazy';
                if (typeof attachSmoothImageLoader === 'function') attachSmoothImageLoader(image, null, fallbackImg);
                row.appendChild(image);

                var details = document.createElement('div');
                details.className = 'story-details';
                var title = document.createElement('h3');
                var link = document.createElement('a');
                link.href = m.articleUrl || '#';
                link.textContent = decodeHtmlEntities(m.title || 'Untitled');
                link.addEventListener('click', function (event) {
                  event.preventDefault();
                  event.stopPropagation();
                  openValidationPreview();
                });
                title.appendChild(link);
                details.appendChild(title);

                var meta = document.createElement('p');
                meta.className = 'story-meta';
                var addMeta = function (text, cls) {
                  if (!text) return;
                  var s = document.createElement('span');
                  if (cls) s.className = cls;
                  s.textContent = text;
                  meta.appendChild(s);
                };
                addMeta(m.provider || 'unknown', 'meta-provider');
                if (m.articleUrl) addMeta(getStoryDomain(m.articleUrl), 'meta-domain');
                var dateStr = fmtValDate(m);
                if (dateStr) addMeta(dateStr, 'meta-date');

                var catLine = document.createElement('span');
                catLine.className = 'meta-category';
                catLine.textContent = 'query=' + catLabel(m.queryCategory) + ' → AI=' + catLabel(m.embeddingCategory) +
                  ' (' + (m.confidence != null ? Number(m.confidence).toFixed(2) : 'n/a') + ')';
                meta.appendChild(catLine);

                var badge = document.createElement('span');
                badge.className = 'meta-badge-status ' + (m._isMismatch ? 'meta-banned' : 'meta-approved');
                badge.textContent = m._isMismatch ? 'MISMATCH' : '✓ match';
                meta.appendChild(badge);

                if (m.approved === true) {
                  var scoop = document.createElement('span');
                  scoop.className = 'meta-badge-status meta-approved';
                  scoop.textContent = "🧸 Littlables' Little Scoop";
                  meta.appendChild(scoop);
                }

                var override = Array.isArray(m.displayCategories) && m.displayCategories.length > 0 ? m.displayCategories : null;
                if (override) {
                  var ovBadge = document.createElement('span');
                  ovBadge.className = 'meta-badge-status meta-approved';
                  ovBadge.textContent = 'Showing in: ' + override.map(catLabel).join(', ');
                  meta.appendChild(ovBadge);
                }

                var kws = Array.isArray(m.interestKeywords) && m.interestKeywords.length > 0 ? m.interestKeywords : null;
                if (kws) {
                  var kwBadge = document.createElement('span');
                  kwBadge.className = 'meta-badge-status meta-approved';
                  // Prefer keywordMatches (carries confidence from the tagging run);
                  // fall back to plain stored ids (e.g. hand-tagged keywords).
                  var kwConf = {};
                  (Array.isArray(m.keywordMatches) ? m.keywordMatches : []).forEach(function (km) {
                    kwConf[km.id] = km.confidence;
                  });
                  kwBadge.textContent = '🔖 ' + kws.map(function (id) {
                    var label = kwLabel(id);
                    var kw = (window.LITTLABLES_KEYWORDS || []).find(function (k) { return k.id === id; });
                    if (kw && kw.excluded) label = '🚫 ' + label;
                    return kwConf[id] != null ? label + ' (' + Number(kwConf[id]).toFixed(2) + ')' : label;
                  }).join(', ');
                  // Flagged keywords hide the story from front-page feeds.
                  if (kws.some(function (id) {
                    var kw = (window.LITTLABLES_KEYWORDS || []).find(function (k) { return k.id === id; });
                    return kw && kw.excluded;
                  })) {
                    kwBadge.style.borderColor = '#f87171';
                    kwBadge.style.color = '#fca5a5';
                  }
                  meta.appendChild(kwBadge);
                }
                // Country/region badge (derived from keywords)
                if (m.countryCode || m.region) {
                  var regionBadge = document.createElement('span');
                  regionBadge.className = 'meta-badge-status';
                  var regionLabel = m.region === 'global' ? '🌍 Global' : (m.countryCode ? m.countryCode + ' · ' + m.region : m.region);
                  regionBadge.textContent = '📍 ' + regionLabel;
                  regionBadge.style.borderColor = '#60a5fa';
                  regionBadge.style.color = '#93c5fd';
                  meta.appendChild(regionBadge);
                }
                details.appendChild(meta);

                var main = document.createElement('div');
                main.className = 'story-main';
                main.appendChild(details);
                row.appendChild(main);

                var actions = document.createElement('div');
                actions.className = 'story-actions';
                var rowBtns = [];
                var mkBtn = function (label, cls) {
                  var b = document.createElement('button');
                  b.type = 'button';
                  b.className = cls || 'secondary small-btn';
                  b.textContent = label;
                  actions.appendChild(b);
                  rowBtns.push(b);
                  return b;
                };
                var approveBtn = null;
                if (m.approved !== true) {
                  approveBtn = mkBtn('Approve', 'small-btn');
                }
                var banBtn = mkBtn('Ban', 'secondary small-btn');
                var fadeOutRow = function () {
                  row.style.transition = 'opacity 0.3s';
                  row.style.opacity = '0';
                  setTimeout(function () {
                    row.remove();
                    validationRowRegistry.delete(Number(m.id));
                  }, 320);
                };
                if (approveBtn) {
                  approveBtn.addEventListener('click', function () {
                    approveBtn.disabled = true;
                    banBtn.disabled = true;
                    approveStory(m.id).then(function () {
                      updateValidationRowApproval(m.id, true);
                    }).catch(function () {
                      approveBtn.disabled = false;
                      banBtn.disabled = false;
                    });
                  });
                }
                banBtn.addEventListener('click', function () {
                  if (approveBtn) approveBtn.disabled = true;
                  banBtn.disabled = true;
                  banStory(m.id).then(fadeOutRow).catch(function () {
                    if (approveBtn) approveBtn.disabled = false;
                    banBtn.disabled = false;
                  });
                });
                var hasAi = m._isMismatch && m.embeddingCategory && OVERRIDABLE_IDS.indexOf(m.embeddingCategory) !== -1;
                if (!override) {
                  if (hasAi) {
                    mkBtn('Use AI', 'small-btn').addEventListener('click', function () {
                      applyDisplayCategories(m.id, [m.embeddingCategory], row, m, rowBtns);
                    });
                    // "Use both" is redundant when the query category is 'all'
                    // (it would resolve to just the AI category after filtering).
                    if (m.embeddingCategory !== m.queryCategory && m.queryCategory !== 'all') {
                      mkBtn('Use both', 'small-btn').addEventListener('click', function () {
                        var both = [m.queryCategory, m.embeddingCategory].filter(function (c, i, a) {
                          return c && OVERRIDABLE_IDS.indexOf(c) !== -1 && a.indexOf(c) === i;
                        });
                        applyDisplayCategories(m.id, both, row, m, rowBtns);
                      });
                    }
                  }
                  var pickBtn = mkBtn('Interests', 'secondary small-btn');
                  pickBtn.addEventListener('click', function () { togglePicker(row, m, actions, pickBtn, rowBtns); });
                } else {
                  var changeBtn = mkBtn('Interests', 'secondary small-btn');
                  changeBtn.addEventListener('click', function () { togglePicker(row, m, actions, changeBtn, rowBtns); });
                }
                var kwBtn = mkBtn('Keywords', 'secondary small-btn');
                kwBtn.addEventListener('click', function () { toggleKeywordPicker(row, m, actions, kwBtn, rowBtns); });
                var aiBtn = mkBtn('🤖 AI tags', 'secondary small-btn');
                aiBtn.addEventListener('click', function () {
                  aiBtn.disabled = true;
                  var originalLabel = aiBtn.textContent;
                  aiBtn.textContent = 'Thinking…';
                  fetch('/admin/api/stories/' + m.id + '/llm-keywords', { method: 'POST' })
                    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
                    .then(function (out) {
                      if (!out.ok) throw new Error(out.data.error || 'AI tagging failed');
                      patchValidationRow(m.id, {
                        interestKeywords: out.data.interest_keywords,
                        keywordMatches: [],
                      });
                    })
                    .catch(function (err) {
                      if (validateStatus) validateStatus.textContent = 'AI tagging failed: ' + (err.message || 'unknown error');
                    })
                    .finally(function () {
                      aiBtn.disabled = false;
                      aiBtn.textContent = originalLabel;
                    });
                });
                row.appendChild(actions);
                validationRowRegistry.set(Number(m.id), { m: m, row: row, render: createValidationRow });
                return row;
              };
              var togglePicker = function (row, m, actions, anchorBtn, rowBtns) {
                var existing = actions.querySelector('.cat-picker, .kw-picker');
                if (existing) { existing.remove(); return; }
                var picker = document.createElement('div');
                picker.className = 'cat-picker';
                picker.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.35rem;align-items:center;margin-top:0.4rem;flex-basis:100%;';
                var hint = document.createElement('span');
                hint.className = 'admin-hint';
                hint.style.flexBasis = '100%';
                hint.textContent = 'Uncheck all to clear the override.';
                picker.appendChild(hint);
                var current = Array.isArray(m.displayCategories) && m.displayCategories.length > 0
                  ? m.displayCategories
                  : (m._isMismatch && m.embeddingCategory ? [m.queryCategory, m.embeddingCategory] : [m.queryCategory]);
                var boxes = [];
                OVERRIDABLE_IDS.forEach(function (id) {
                  var lab = document.createElement('label');
                  lab.style.cssText = 'display:flex;align-items:center;gap:0.25rem;font-size:0.8rem;cursor:pointer;';
                  var cb = document.createElement('input');
                  cb.type = 'checkbox';
                  cb.value = id;
                  cb.checked = current.indexOf(id) !== -1;
                  lab.appendChild(cb);
                  lab.appendChild(document.createTextNode(catLabel(id)));
                  picker.appendChild(lab);
                  boxes.push(cb);
                });
                var applyBtn = document.createElement('button');
                applyBtn.type = 'button';
                applyBtn.className = 'small-btn';
                applyBtn.textContent = 'Apply';
                applyBtn.addEventListener('click', function () {
                  var chosen = boxes.filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; });
                  applyDisplayCategories(m.id, chosen.length > 0 ? chosen : null, row, m, rowBtns.concat([applyBtn]));
                });
                var cancelBtn = document.createElement('button');
                cancelBtn.type = 'button';
                cancelBtn.className = 'secondary small-btn';
                cancelBtn.textContent = 'Cancel';
                cancelBtn.addEventListener('click', function () { picker.remove(); });
                picker.appendChild(applyBtn);
                picker.appendChild(cancelBtn);
                actions.appendChild(picker);
              };
              var toggleKeywordPicker = function (row, m, actions, anchorBtn, rowBtns) {
                var existing = actions.querySelector('.cat-picker, .kw-picker');
                if (existing) { existing.remove(); return; }
                var picker = document.createElement('div');
                picker.className = 'kw-picker';
                picker.style.cssText = 'display:flex;flex-direction:column;gap:0.5rem;margin-top:0.4rem;flex-basis:100%;max-height:22rem;overflow-y:auto;padding:0.5rem;border:1px solid var(--news-border, #334155);border-radius:0.5rem;';
                var hint = document.createElement('span');
                hint.className = 'admin-hint';
                hint.textContent = 'Tag this story with interest keywords. Uncheck all to clear.';
                picker.appendChild(hint);
                var current = Array.isArray(m.interestKeywords) && m.interestKeywords.length > 0 ? m.interestKeywords : [];
                var boxes = [];
                var allKws = window.LITTLABLES_KEYWORDS || [];
                var groups = [];
                allKws.forEach(function (kw) {
                  if (groups.indexOf(kw.group) === -1) groups.push(kw.group);
                });
                groups.forEach(function (group) {
                  var groupTitle = document.createElement('strong');
                  groupTitle.style.cssText = 'font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.8;margin-top:0.25rem;';
                  groupTitle.textContent = group;
                  picker.appendChild(groupTitle);
                  var groupRow = document.createElement('div');
                  groupRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.35rem;align-items:center;';
                  allKws.filter(function (kw) { return kw.group === group; }).forEach(function (kw) {
                    var lab = document.createElement('label');
                    lab.style.cssText = 'display:flex;align-items:center;gap:0.25rem;font-size:0.8rem;cursor:pointer;';
                    var cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.value = kw.id;
                    cb.checked = current.indexOf(kw.id) !== -1;
                    lab.appendChild(cb);
                    lab.appendChild(document.createTextNode((kw.icon ? kw.icon + ' ' : '') + kw.label));
                    groupRow.appendChild(lab);
                    boxes.push(cb);
                  });
                  picker.appendChild(groupRow);
                });
                var btnRow = document.createElement('div');
                btnRow.style.cssText = 'display:flex;gap:0.5rem;margin-top:0.25rem;';
                var applyBtn = document.createElement('button');
                applyBtn.type = 'button';
                applyBtn.className = 'small-btn';
                applyBtn.textContent = 'Apply';
                applyBtn.addEventListener('click', function () {
                  var chosen = boxes.filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; });
                  applyInterestKeywords(m.id, chosen.length > 0 ? chosen : null, row, m, rowBtns.concat([applyBtn]));
                });
                var cancelBtn = document.createElement('button');
                cancelBtn.type = 'button';
                cancelBtn.className = 'secondary small-btn';
                cancelBtn.textContent = 'Cancel';
                cancelBtn.addEventListener('click', function () { picker.remove(); });
                btnRow.appendChild(applyBtn);
                btnRow.appendChild(cancelBtn);
                picker.appendChild(btnRow);
                actions.appendChild(picker);
              };
              var list = document.createElement('div');
              list.id = 'validate-results-list';
              list.style.display = 'flex';
              list.style.flexDirection = 'column';
              list.style.gap = '0.5rem';
              validationRowRegistry.clear();
              // Sort order from the dropdown: matched first by default.
              var sortOrder = (document.getElementById('validate-sort-order')?.value || 'matched');
              var matchRows = allValidatedStories.filter(s => !s.mismatch).map(s => ({...s, _isMismatch: false}));
              var mismatchRows = allMismatches.map(m => ({...m, _isMismatch: true}));
              var sorted = sortOrder === 'matched' ? [...matchRows, ...mismatchRows] : [...mismatchRows, ...matchRows];
              for (const m of sorted) {
                list.appendChild(createValidationRow(m));
              }
              validateResults.appendChild(list);
            }
          }
          const countEl = document.getElementById('embedding-validation-count');
          if (countEl) countEl.textContent = allMismatches.length ? '(' + allMismatches.length + ')' : '';
        } catch (err) {
          if (validateStatus) validateStatus.textContent = 'Error: ' + (err.message || 'Validation failed');
        } finally {
          validateBtn.disabled = false;
          validateBtn.textContent = 'Validate Categories';
          // Refresh the unclassified count (and panel data) after the run.
          refreshData();
        }
      });
    }

    // Re-sort the currently displayed validation results when the sort
    // dropdown changes (no re-validation needed — just reorder the rows).
    const sortSelect = document.getElementById('validate-sort-order');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        const list = document.getElementById('validate-results-list');
        if (!list) return;
        const rows = [...list.children];
        const matched = rows.filter(r => r.dataset.mismatch !== '1');
        const unmatched = rows.filter(r => r.dataset.mismatch === '1');
        const ordered = sortSelect.value === 'matched' ? [...matched, ...unmatched] : [...unmatched, ...matched];
        ordered.forEach(r => list.appendChild(r));
      });
    }

    restoreSectionLayout();
    refreshData();

    // ── Broken Images scan ──
    (function initBrokenImages() {
      const runBtn = document.getElementById('check-images-btn');
      const stopBtn = document.getElementById('stop-images-btn');
      const statusEl = document.getElementById('check-images-status');
      const resultsEl = document.getElementById('check-images-results');
      const countEl = document.getElementById('broken-images-count');
      if (!runBtn || !resultsEl) return;
      let scanning = false;
      let stopRequested = false;

      function renderFoundRow(item, reason) {
        const row = document.createElement('article');
        row.className = 'story story-no-thumb';
        const details = document.createElement('div');
        details.className = 'story-details';
        const title = document.createElement('h3');
        const link = document.createElement('a');
        link.href = item.link || '#';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = item.title || '(untitled)';
        title.append(link);
        const meta = document.createElement('p');
        meta.className = 'story-meta';
        const badge = document.createElement('span');
        badge.className = 'meta-badge-status ' + (item.removed ? 'meta-banned' : item.approved ? 'meta-approved' : 'meta-pending');
        badge.textContent = item.removed ? 'Banned' : item.approved ? 'Approved' : 'Pending';
        const reasonSpan = document.createElement('span');
        reasonSpan.className = 'meta-badge-status meta-banned';
        reasonSpan.textContent = reason;
        meta.append(badge, reasonSpan);
        details.append(title, meta);
        const actions = document.createElement('div');
        actions.className = 'story-actions';
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'secondary small-btn';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => openStoryPreview({
          id: item.id, title: item.title || '', link: item.link || '',
          image: item.imageUrl || '', category: item.category || 'all',
        }));
        const linkBtn = document.createElement('button');
        linkBtn.type = 'button';
        linkBtn.className = 'secondary small-btn';
        linkBtn.textContent = '🔗 Copy link';
        linkBtn.title = 'Copy the frontpage expanded-view link for this story';
        linkBtn.addEventListener('click', () => copyFrontpageStoryLink(linkBtn, {
          title: item.title, link: item.link, category: item.category,
        }));
        actions.append(editBtn, linkBtn);
        row.append(details, actions);
        return row;
      }
      function renderGroups(noImage, broken) {
        resultsEl.replaceChildren();
        const total = noImage.length + broken.length;
        if (countEl) countEl.textContent = total ? '(' + total + ')' : '';
        if (!total) {
          if (!scanning) {
            const p = document.createElement('p');
            p.className = 'muted';
            p.textContent = 'No broken images found in the scanned stories.';
            resultsEl.append(p);
          }
          return;
        }
        if (noImage.length) {
          const h = document.createElement('h3');
          h.textContent = 'No image (' + noImage.length + ')';
          resultsEl.append(h);
          noImage.forEach((item) => resultsEl.append(renderFoundRow(item, 'No image')));
        }
        if (broken.length) {
          const h = document.createElement('h3');
          h.textContent = 'Broken image (' + broken.length + ')';
          resultsEl.append(h);
          broken.forEach((item) => {
            const reason = item.status === 'timeout' ? 'Timeout'
              : item.status === 'invalid' ? 'Invalid URL'
              : item.status === 'error' ? 'Unreachable'
              : 'HTTP ' + item.status;
            resultsEl.append(renderFoundRow(item, reason));
          });
        }
      }
      async function runScan() {
        if (scanning) return;
        scanning = true;
        stopRequested = false;
        runBtn.disabled = true;
        runBtn.textContent = 'Scanning…';
        stopBtn.hidden = false;
        const foundNoImage = [];
        const foundBroken = [];
        let before = null;
        let checked = 0;
        try {
          while (!stopRequested) {
            const query = before ? '?before=' + encodeURIComponent(before) : '';
            const data = await request('/admin/api/stories/check-images' + query);
            checked += data.checked || 0;
            foundNoImage.push(...(data.noImage || []));
            foundBroken.push(...(data.broken || []));
            renderGroups(foundNoImage, foundBroken);
            statusEl.textContent = 'Checked ' + checked + ' stories… Found ' +
              foundNoImage.length + ' with no image, ' + foundBroken.length + ' broken.';
            if (data.done || !data.nextBefore) break;
            before = data.nextBefore;
          }
          statusEl.textContent = stopRequested
            ? 'Stopped after ' + checked + ' stories. Found ' + foundNoImage.length + ' with no image, ' + foundBroken.length + ' broken.'
            : 'Done — checked ' + checked + ' stories. Found ' + foundNoImage.length + ' with no image, ' + foundBroken.length + ' broken.';
          if (!foundNoImage.length && !foundBroken.length && !stopRequested) renderGroups(foundNoImage, foundBroken);
        } catch (err) {
          statusEl.textContent = 'Scan failed: ' + (err.message || 'unknown error');
        } finally {
          scanning = false;
          runBtn.disabled = false;
          runBtn.textContent = 'Find broken images';
          stopBtn.hidden = true;
        }
      }
      runBtn.addEventListener('click', runScan);
      stopBtn.addEventListener('click', () => { stopRequested = true; });
    })();

    // ── Analytics dashboard ──
    (function initAnalytics() {
      var regionSel = document.getElementById('analytics-region');
      var countrySel = document.getElementById('analytics-country');
      var refreshBtn = document.getElementById('analytics-refresh');
      var statusEl = document.getElementById('analytics-status');
      var resultsEl = document.getElementById('analytics-results');
      var tabs = Array.prototype.slice.call(document.querySelectorAll('.analytics-tab'));
      if (!regionSel || !resultsEl) return;
      var activeTab = 'search';

      // Populate country dropdown from the Countries keyword group
      try {
        var countries = (LITTLABLES_KEYWORDS || []).filter(function (k) { return k.group === 'Countries'; });
        countries.sort(function (a, b) { return a.label.localeCompare(b.label); });
        countries.forEach(function (k) {
          // id is like 'country-us' -> 'US'
          var code = (k.id || '').replace(/^country-/, '').toUpperCase();
          var opt = document.createElement('option');
          opt.value = code;
          opt.textContent = k.icon + ' ' + k.label;
          countrySel.appendChild(opt);
        });
      } catch (e) { /* ignore */ }

      function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }

      function renderTable(cols, rows) {
        if (!rows || rows.length === 0) {
          return '<p class="admin-hint">No data yet — check back after real traffic flows in.</p>';
        }
        var html = '<div style="overflow-x: auto;"><table class="admin-table"><thead><tr>';
        cols.forEach(function (c) { html += '<th>' + esc(c.label) + '</th>'; });
        html += '</tr></thead><tbody>';
        rows.forEach(function (r) {
          html += '<tr>';
          cols.forEach(function (c) {
            var v = r[c.key];
            if (c.format === 'pct' && typeof v === 'number') v = (v * 100).toFixed(1) + '%';
            if (c.format === 'num' && typeof v === 'number') v = v.toLocaleString();
            html += '<td>' + esc(v) + '</td>';
          });
          html += '</tr>';
        });
        return html + '</tbody></table></div>';
      }

      var TAB_CONFIG = {
        search: {
          label: 'Top searches',
          cols: [
            { key: 'query', label: 'Query' },
            { key: 'searches', label: 'Searches', format: 'num' },
            { key: 'avg_results', label: 'Avg results', format: 'num' },
            { key: 'country_code', label: 'Country' },
            { key: 'region', label: 'Region' },
          ],
        },
        search_gaps: {
          label: 'Searches with no results (content gaps)',
          cols: [
            { key: 'query', label: 'Query' },
            { key: 'searches', label: 'Searches', format: 'num' },
            { key: 'avg_results', label: 'Avg results' },
            { key: 'country_code', label: 'Country' },
            { key: 'region', label: 'Region' },
          ],
        },
        keywords: {
          label: 'Keyword click-through rate',
          cols: [
            { key: 'keyword', label: 'Keyword' },
            { key: 'views', label: 'Views', format: 'num' },
            { key: 'clicks', label: 'Clicks', format: 'num' },
            { key: 'ctr', label: 'CTR', format: 'pct' },
            { key: 'country_code', label: 'Country' },
            { key: 'region', label: 'Region' },
          ],
        },
        boards: {
          label: 'Space topics built',
          cols: [
            { key: 'keyword', label: 'Keyword' },
            { key: 'boards_built', label: 'Spaces built', format: 'num' },
            { key: 'country_code', label: 'Country' },
            { key: 'region', label: 'Region' },
          ],
        },
        acquisition: {
          label: 'Traffic sources',
          cols: [
            { key: 'referrer_domain', label: 'Referrer' },
            { key: 'utm_source', label: 'UTM source' },
            { key: 'sessions', label: 'Sessions', format: 'num' },
            { key: 'views', label: 'Views', format: 'num' },
            { key: 'clicks', label: 'Clicks', format: 'num' },
            { key: 'country_code', label: 'Country' },
            { key: 'region', label: 'Region' },
          ],
        },
        dwell: {
          label: 'Reading time per story',
          cols: [
            { key: 'story_title', label: 'Story' },
            { key: 'dwell_events', label: 'Reads', format: 'num' },
            { key: 'avg_dwell_seconds', label: 'Avg seconds', format: 'num' },
            { key: 'median_dwell_seconds', label: 'Median seconds', format: 'num' },
            { key: 'country_code', label: 'Country' },
            { key: 'region', label: 'Region' },
          ],
        },
        ads: {
          label: 'Ad click-through rate',
          cols: [
            { key: 'ad_title', label: 'Ad' },
            { key: 'network', label: 'Network' },
            { key: 'impressions', label: 'Impressions', format: 'num' },
            { key: 'clicks', label: 'Clicks', format: 'num' },
            { key: 'ctr', label: 'CTR', format: 'pct' },
            { key: 'country_code', label: 'Country' },
            { key: 'region', label: 'Region' },
          ],
        },
        ad_networks: {
          label: 'Ad performance by network',
          cols: [
            { key: 'network', label: 'Network' },
            { key: 'ads', label: 'Ads', format: 'num' },
            { key: 'impressions', label: 'Impressions', format: 'num' },
            { key: 'clicks', label: 'Clicks', format: 'num' },
            { key: 'ctr', label: 'CTR', format: 'pct' },
            { key: 'country_code', label: 'Country' },
            { key: 'region', label: 'Region' },
          ],
        },
      };

      function setActiveTab(name) {
        activeTab = name;
        tabs.forEach(function (t) {
          var isActive = t.getAttribute('data-analytics-tab') === name;
          t.classList.toggle('sign-in-button', isActive);
          t.classList.toggle('primary-button', isActive);
        });
        loadAnalytics();
      }

      async function loadAnalytics() {
        var cfg = TAB_CONFIG[activeTab];
        if (statusEl) statusEl.textContent = 'Loading…';
        try {
          var params = new URLSearchParams({
            type: activeTab,
            region: regionSel.value,
            country: countrySel.value,
            limit: '100',
          });
          var res = await fetch('/admin/api/analytics?' + params.toString(), { credentials: 'same-origin' });
          var data = await res.json();
          if (!data.ok) throw new Error(data.reason || 'Request failed');
          resultsEl.innerHTML = '<h3 style="margin: 0 0 0.5rem;">' + esc(cfg.label) + '</h3>' + renderTable(cfg.cols, data.rows);
          if (statusEl) statusEl.textContent = '';
        } catch (err) {
          if (statusEl) statusEl.textContent = 'Error: ' + (err.message || 'failed');
        }
      }

      tabs.forEach(function (t) {
        t.addEventListener('click', function () { setActiveTab(t.getAttribute('data-analytics-tab')); });
      });
      if (refreshBtn) refreshBtn.addEventListener('click', loadAnalytics);
      if (regionSel) regionSel.addEventListener('change', loadAnalytics);
      if (countrySel) countrySel.addEventListener('change', loadAnalytics);
      // Load when the section is first opened
      var toggle = document.getElementById('analytics-toggle');
      if (toggle) toggle.addEventListener('click', function () {
        var body = document.getElementById('analytics-body');
        if (body && !body.hidden && !resultsEl.innerHTML) loadAnalytics();
      });
      // Style the first tab as active
      setActiveTab('search');
    })();

    setInterval(refreshStoryAges, 1000);
    setInterval(() => {
      if (state.providers.some((provider) => provider.status === 'running') || (state.runs || []).some((r) => r.status === 'running') || state.syncPollActive) refreshData();
    }, 15000);
    setInterval(checkStaleHourlySync, 60000);
  </script>
</body>
</html>`;
}
