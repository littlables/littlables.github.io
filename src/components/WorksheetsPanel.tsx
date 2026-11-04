import React, { useRef, useState } from 'react';
import { t } from '../constants/translations';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';
import {
  clearActivityFromUrl,
  parseActivityFromUrl,
  shareWorksheetWithImage,
} from '../services/urlService';
import { DigitalWorksheetModal } from './DigitalWorksheetModal';

export type WorksheetType = 'coloring-page' | 'hidden-puzzle' | 'word-search';
type WorksheetFilter = 'all' | WorksheetType;

const WORKSHEET_TYPES: { id: WorksheetType; label: string }[] = [
  { id: 'coloring-page', label: 'Coloring Pages' },
  { id: 'hidden-puzzle', label: 'Hidden Puzzles' },
  { id: 'word-search', label: 'Word Searches' },
];

export interface WorksheetItem {
  id: string;
  title: string;
  types: WorksheetType[];
  badge: string;
  previewImg: string;
  pdfUrl: string;
  pdfFilename: string;
  jpgUrl: string;
  jpgFilename: string;
  description: string;
  pubName: string;
  domain: string;
  dateLabel: string;
}

export const WORKSHEETS: WorksheetItem[] = [
  {
    id: 'halloween-2026-coloring-page',
    title: 'Littlables Halloween Party Coloring Page',
    types: ['coloring-page'],
    badge: '🎨 Coloring Page',
    previewImg: '/img/worksheets/preview/littlables-halloween-coloring-page-preview.jpg',
    pdfUrl: '/img/worksheets/littlables-halloween-2026-coloring-page.pdf',
    pdfFilename: 'littlables-halloween-2026-coloring-page.pdf',
    jpgUrl: '/img/worksheets/littlables-halloween-2026-coloring-page.jpg',
    jpgFilename: 'littlables-halloween-2026-coloring-page.jpg',
    description:
      "Color in a cozy Halloween costume party with friendly jack-o'-lanterns, party balloons, sweet treats, and alphabet blocks!",
    pubName: 'littlables',
    domain: 'littlables.com',
    dateLabel: 'Oct 2026',
  },
  {
    id: 'halloween-2026-hidden-objects-coloring-page',
    title: 'Halloween Hidden Objects & Coloring Page',
    types: ['coloring-page', 'hidden-puzzle'],
    badge: '🔍 Hidden Objects',
    previewImg: '/img/worksheets/preview/littlables-halloween-hidden-objects-coloring-page-preview.jpg',
    pdfUrl: '/img/worksheets/littlables-halloween-2026-hidden-objects-coloring-page.pdf',
    pdfFilename: 'littlables-halloween-2026-hidden-objects-coloring-page.pdf',
    jpgUrl: '/img/worksheets/littlables-halloween-2026-hidden-objects-coloring-page.jpg',
    jpgFilename: 'littlables-halloween-2026-hidden-objects-coloring-page.jpg',
    description:
      'Can you find all 10 hidden objects — pizza, banana, star, heart, key, moon, crown, fish, pencil, and bone — and color the scene?',
    pubName: 'littlables',
    domain: 'littlables.com',
    dateLabel: 'Oct 2026',
  },
  {
    id: 'halloween-2026-word-search',
    title: 'Halloween Word Search & Coloring Page',
    types: ['coloring-page', 'word-search'],
    badge: '🔤 Word Search',
    previewImg: '/img/worksheets/preview/littlables-halloween-word-search-preview.jpg',
    pdfUrl: '/img/worksheets/littlables-halloween-2026-word-search.pdf',
    pdfFilename: 'littlables-halloween-2026-word-search.pdf',
    jpgUrl: '/img/worksheets/littlables-halloween-2026-word-search.jpg',
    jpgFilename: 'littlables-halloween-2026-word-search.jpg',
    description:
      'Can you find all 10 spooky Halloween words — pumpkin, ghost, bat, candy, witch, spider, littlables, treat, costume, and cauldron — in any direction and color the cute Halloween characters?',
    pubName: 'littlables',
    domain: 'littlables.com',
    dateLabel: 'Oct 2026',
  },
];

export function toggleWorksheetsPanel() {
  window.dispatchEvent(new CustomEvent('littlables:toggle-worksheets'));
}

export const WorksheetsPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useState<boolean>(() => parseActivityFromUrl().isOpen);
  const [targetWorksheetId, setTargetWorksheetId] = useState<string | null>(
    () => parseActivityFromUrl().worksheetId
  );
  const [backdropTop, setBackdropTop] = useState<number>(54);
  const containerRef = useRef<HTMLElement | null>(null);
  const printFrameRef = useRef<HTMLIFrameElement | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [openDownloadPopoverId, setOpenDownloadPopoverId] = useState<string | null>(null);
  const [activeDigitalWorksheet, setActiveDigitalWorksheet] = useState<WorksheetItem | null>(null);
  const [worksheetFilter, setWorksheetFilter] = useState<WorksheetFilter>('all');
  const visibleWorksheets = worksheetFilter === 'all'
    ? WORKSHEETS
    : WORKSHEETS.filter((worksheet) => worksheet.types.includes(worksheetFilter));

  useLockBodyScroll(isOpen);

  React.useEffect(() => {
    const updateHeaderBottom = () => {
      const headerEl = document.querySelector('.news-widget-header');
      if (headerEl) {
        const rect = headerEl.getBoundingClientRect();
        setBackdropTop(Math.max(0, Math.round(rect.bottom)));
      }
    };
    updateHeaderBottom();

    const handleToggle = () => {
      updateHeaderBottom();
      setIsOpen((prev) => {
        const next = !prev;
        if (!next) {
          clearActivityFromUrl();
        }
        return next;
      });
    };

    const handleUrlChange = () => {
      const parsed = parseActivityFromUrl();
      if (parsed.isOpen) {
        updateHeaderBottom();
        setTargetWorksheetId(parsed.worksheetId);
        setIsOpen(true);
      }
    };

    window.addEventListener('littlables:toggle-worksheets', handleToggle);
    window.addEventListener('resize', updateHeaderBottom);
    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
    return () => {
      window.removeEventListener('littlables:toggle-worksheets', handleToggle);
      window.removeEventListener('resize', updateHeaderBottom);
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, []);

  React.useEffect(() => {
    if (!isOpen) {
      document.documentElement.classList.remove('story-modal-open');
      document.body.classList.remove('story-modal-open');
      setOpenDownloadPopoverId(null);
      return;
    }
    document.documentElement.classList.add('story-modal-open');
    document.body.classList.add('story-modal-open');

    if (targetWorksheetId) {
      window.requestAnimationFrame(() => {
        const cardEl = document.getElementById(`worksheet-card-${targetWorksheetId}`);
        if (cardEl) {
          cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    }

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest('.worksheet-download-popover-wrap')) {
        setOpenDownloadPopoverId(null);
      }
      if (target.closest('#worksheets-btn')) return;
      if (target.closest('.digital-worksheet-modal-backdrop')) return;
      if (containerRef.current && !containerRef.current.contains(target)) {
        clearActivityFromUrl();
        setIsOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.documentElement.classList.remove('story-modal-open');
      document.body.classList.remove('story-modal-open');
    };
  }, [isOpen, targetWorksheetId]);

  const isMobileDevice = (): boolean => {
    if (typeof window === 'undefined') return false;
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
    const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
      navigator.userAgent || ''
    );
    return Boolean(coarsePointer || mobileUA);
  };

  const handleFileDownload = async (
    e: React.MouseEvent<HTMLAnchorElement>,
    url: string,
    filename: string,
    fileType: 'pdf' | 'jpg'
  ) => {
    if (isMobileDevice()) {
      // On mobile: let the <a target="_blank"> link open directly and automatically in a new window/tab
      return;
    }

    // On desktop: prompt for a file location using the File System Access API when supported
    e.preventDefault();
    const absoluteUrl = new URL(url, window.location.origin).href;

    if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
      try {
        const pickerTypes =
          fileType === 'pdf'
            ? [
                {
                  description: 'PDF Document',
                  accept: { 'application/pdf': ['.pdf'] },
                },
              ]
            : [
                {
                  description: 'JPEG Image',
                  accept: { 'image/jpeg': ['.jpg', '.jpeg'] },
                },
              ];

        const fileHandle = await (
          window as unknown as {
            showSaveFilePicker: (options: unknown) => Promise<FileSystemFileHandle>;
          }
        ).showSaveFilePicker({
          suggestedName: filename,
          types: pickerTypes,
        });

        const response = await fetch(absoluteUrl);
        const blob = await response.blob();
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // User cancelled the file location dialog
          return;
        }
        // Fall through to new window + download fallback if blocked by iframe or browser
      }
    }

    // Fallback for desktop browsers/environments without showSaveFilePicker:
    // Open in a new window so the website is never lost, and trigger download
    window.open(absoluteUrl, '_blank', 'noopener,noreferrer');
    try {
      const response = await fetch(absoluteUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const tempLink = document.createElement('a');
      tempLink.href = blobUrl;
      tempLink.download = filename;
      tempLink.target = '_blank';
      tempLink.rel = 'noopener noreferrer';
      document.body.appendChild(tempLink);
      tempLink.click();
      document.body.removeChild(tempLink);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch {
      // Already opened in a new window above
    }
  };

  const handlePrintWorksheet = (worksheet: WorksheetItem) => {
    setPrintingId(worksheet.id);

    const escapedTitle = worksheet.title.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const imgSrc = new URL(worksheet.jpgUrl, window.location.origin).href;

    const printHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapedTitle}</title>
  <style>
    @page {
      size: letter portrait;
      margin: 0;
    }
    * {
      box-sizing: border-box;
    }
    html, body {
      width: 100%;
      height: 100%;
      margin: 0 !important;
      padding: 0 !important;
      background: #ffffff;
      overflow: hidden;
    }
    .print-page-wrap {
      width: 100%;
      height: 100vh;
      max-height: 10.8in;
      padding: 0;
      margin: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    img {
      width: auto;
      height: auto;
      max-width: 100%;
      max-height: 96vh;
      object-fit: contain;
      display: block;
      margin: 0 auto;
      background: #ffffff;
      page-break-inside: avoid;
      break-inside: avoid;
    }
  </style>
</head>
<body>
  <div class="print-page-wrap">
    <img id="print-img" src="${imgSrc}" alt="${escapedTitle}" />
  </div>
  <script>
    (function() {
      var img = document.getElementById('print-img');
      var printed = false;
      function triggerPrint() {
        if (printed) return;
        printed = true;
        setTimeout(function() {
          window.focus();
          window.print();
        }, 100);
      }
      if (img.complete && img.naturalWidth > 0) {
        triggerPrint();
      } else {
        img.onload = triggerPrint;
      }
    })();
  </script>
</body>
</html>`;

    const frame = printFrameRef.current;
    const doc = frame?.contentDocument || frame?.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(printHtml);
      doc.close();
    }

    setTimeout(() => {
      setPrintingId((prev) => (prev === worksheet.id ? null : prev));
    }, 900);
  };

  const handleShareWorksheet = async (
    e: React.MouseEvent<HTMLButtonElement>,
    worksheet: WorksheetItem
  ) => {
    e.stopPropagation();
    const ok = await shareWorksheetWithImage(worksheet);
    if (ok) {
      setCopiedId(worksheet.id);
      setTimeout(() => {
        setCopiedId((prev) => (prev === worksheet.id ? null : prev));
      }, 2000);
    }
  };

  return (
    <div
      className="worksheets-overlay-backdrop"
      style={{ top: `${backdropTop}px` }}
      hidden={!isOpen}
    >
      <section
        ref={containerRef}
        className="worksheets-dropdown-container"
        aria-label="Printable Worksheets & Activities"
      >
        <div className="worksheets-dropdown-scroll">
          <div className="worksheets-panel-header">
            <h2>Activity Worksheets ({visibleWorksheets.length})</h2>
            <div className="worksheets-type-filter-container">
              <select
                className="worksheets-type-filter"
                aria-label="Filter worksheets by type"
                value={worksheetFilter}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'all') setWorksheetFilter('all');
                  else {
                    const selectedType = WORKSHEET_TYPES.find((type) => type.id === value);
                    if (selectedType) setWorksheetFilter(selectedType.id);
                  }
                }}
              >
                <option value="all">All Activities</option>
                {WORKSHEET_TYPES.map((type) => (
                  <option key={type.id} value={type.id}>{type.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="news-grid worksheets-grid">
        {visibleWorksheets.map((worksheet) => (
          <article
            key={worksheet.id}
            id={`worksheet-card-${worksheet.id}`}
            className="news-card worksheet-card"
          >
            <div
              className="news-card-image-wrap worksheet-card-image-wrap is-loaded"
              role="button"
              tabIndex={0}
              title={`Open interactive ${worksheet.title}`}
              onClick={() => setActiveDigitalWorksheet(worksheet)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActiveDigitalWorksheet(worksheet);
                }
              }}
            >
              <img
                src={worksheet.previewImg}
                alt={worksheet.title}
                className="news-card-image worksheet-card-image is-loaded"
                loading="eager"
                decoding="async"
              />
              <span className="news-card-badge">{worksheet.badge}</span>
            </div>

            <div className="news-card-content">
              <div className="news-card-meta story-meta-grid">
                <span className="story-meta-cell story-provider-badge" title={worksheet.pubName}>
                  📰 {worksheet.pubName}
                </span>
                <span className="story-meta-cell story-date-badge" title={worksheet.dateLabel}>
                  🕒 {worksheet.dateLabel}
                </span>
                <span className="story-meta-cell story-domain-badge" title={worksheet.domain}>
                  🌐 {worksheet.domain}
                </span>
                <span className="story-meta-cell story-scoop-badge">
                  {t('verifiedWire') || "🧸 Littlables' Little Scoop"}
                </span>
              </div>

              <div className="news-card-title worksheet-card-title">{worksheet.title}</div>

              <p className="news-card-desc">{worksheet.description}</p>

              <div className="news-card-footer worksheet-card-footer">
                <div className="worksheet-primary-actions">
                  <button
                    type="button"
                    className="worksheet-action-btn worksheet-digital-btn"
                    data-umami-event="Open-Digital-Worksheet"
                    data-umami-event-worksheet={worksheet.id}
                    onClick={() => setActiveDigitalWorksheet(worksheet)}
                    title="Color & solve interactively"
                  >
                    🎨 Digital
                  </button>
                  <button
                    type="button"
                    className="worksheet-action-btn worksheet-print-btn"
                    data-umami-event="Print-Worksheet"
                    data-umami-event-worksheet={worksheet.id}
                    onClick={() => handlePrintWorksheet(worksheet)}
                  >
                    🖨️ {printingId === worksheet.id ? 'Preparing…' : 'Print'}
                  </button>
                </div>

                <div className="worksheet-download-group">
                  <div className="worksheet-download-popover-wrap">
                    <button
                      type="button"
                      className={`worksheet-action-btn worksheet-download-btn worksheet-download-trigger ${
                        openDownloadPopoverId === worksheet.id ? 'is-open' : ''
                      }`}
                      aria-expanded={openDownloadPopoverId === worksheet.id}
                      aria-haspopup="menu"
                      title="Download PDF or JPG"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenDownloadPopoverId((prev) =>
                          prev === worksheet.id ? null : worksheet.id
                        );
                      }}
                    >
                      ⬇PDF/JPG
                    </button>

                    {openDownloadPopoverId === worksheet.id && (
                      <div
                        className="worksheet-download-popover"
                        role="menu"
                        aria-label={`Download options for ${worksheet.title}`}
                      >
                        <a
                          href={worksheet.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          role="menuitem"
                          className="worksheet-download-popover-item"
                          data-umami-event="Download-Worksheet-PDF"
                          data-umami-event-worksheet={worksheet.id}
                          onClick={(e) => {
                            setOpenDownloadPopoverId(null);
                            handleFileDownload(e, worksheet.pdfUrl, worksheet.pdfFilename, 'pdf');
                          }}
                        >
                          <span>📄</span>
                          <span>Download PDF</span>
                        </a>
                        <a
                          href={worksheet.jpgUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          role="menuitem"
                          className="worksheet-download-popover-item"
                          data-umami-event="Download-Worksheet-JPG"
                          data-umami-event-worksheet={worksheet.id}
                          onClick={(e) => {
                            setOpenDownloadPopoverId(null);
                            handleFileDownload(e, worksheet.jpgUrl, worksheet.jpgFilename, 'jpg');
                          }}
                        >
                          <span>🖼️</span>
                          <span>Download JPG</span>
                        </a>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className={`reaction-pill story-share-btn worksheet-share-btn ${
                      copiedId === worksheet.id ? 'copied' : ''
                    }`}
                    onClick={(e) => handleShareWorksheet(e, worksheet)}
                    title="Share activity link & image"
                    aria-label="Share activity"
                    data-umami-event="Share-Worksheet"
                    data-umami-event-worksheet={worksheet.id}
                  >
                    <span>{copiedId === worksheet.id ? '✓' : '🔗'}</span>
                    <span>{copiedId === worksheet.id ? 'Copied' : 'Share'}</span>
                  </button>
                </div>
              </div>
            </div>
          </article>
        ))}
        {visibleWorksheets.length === 0 && (
          <p className="worksheets-empty">No worksheets in this category yet.</p>
        )}
          </div>
        </div>

        <iframe
          ref={printFrameRef}
          title="Worksheet Print Frame"
          className="worksheet-print-iframe"
          aria-hidden="true"
        />
      </section>

      <DigitalWorksheetModal
        worksheet={activeDigitalWorksheet}
        allWorksheets={WORKSHEETS}
        onClose={() => setActiveDigitalWorksheet(null)}
        onSelectWorksheet={(next) => setActiveDigitalWorksheet(next)}
      />
    </div>
  );
};
