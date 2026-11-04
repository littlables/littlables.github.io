import React, { useCallback, useEffect, useRef, useState } from 'react';
import { WorksheetItem } from './WorksheetsPanel';

interface DigitalWorksheetModalProps {
  worksheet: WorksheetItem | null;
  allWorksheets: WorksheetItem[];
  onClose: () => void;
  onSelectWorksheet: (worksheet: WorksheetItem) => void;
  embedded?: boolean;
}

type ToolMode = 'puzzle' | 'bucket' | 'brush' | 'eraser';

interface HiddenObjectDef {
  id: string;
  label: string;
  emoji: string;
  /** Scene hit targets (normalized 0..1 coordinates + radius) */
  targets: { x: number; y: number; r: number }[];
  /** Bottom checklist icon position (normalized 0..1) */
  bankPos: { x: number; y: number };
  color: string;
}

interface WordPlacementDef {
  word: string;
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  bankPos: { x: number; y: number };
  color: string;
}

const CRAYON_PALETTE = [
  { name: 'Pumpkin Orange', hex: '#efa963' },
  { name: 'Bright Orange', hex: '#f97316' },
  { name: 'Buttercup Yellow', hex: '#fae06b' },
  { name: 'Witch Purple', hex: '#9556cc' },
  { name: 'Bat Violet', hex: '#8778ab' },
  { name: 'Soft Lavender', hex: '#c084fc' },
  { name: 'Bubblegum Pink', hex: '#f487c9' },
  { name: 'Coral Red', hex: '#ed717b' },
  { name: 'Zombie Lime', hex: '#a3c95c' },
  { name: 'Cauldron Sage', hex: '#84a099' },
  { name: 'Mint Teal', hex: '#71bea8' },
  { name: 'Sky Blue', hex: '#75adfc' },
  { name: 'Royal Blue', hex: '#6366f1' },
  { name: 'Broomstick Brown', hex: '#c98c58' },
  { name: 'Warm Tan', hex: '#e2b887' },
  { name: 'Castle Slate', hex: '#8fa0b5' },
];

const HIDDEN_OBJECTS_LIST: HiddenObjectDef[] = [
  {
    id: 'pizza',
    label: 'PIZZA',
    emoji: '🍕',
    targets: [{ x: 0.12, y: 0.15, r: 0.045 }],
    bankPos: { x: 0.098, y: 0.905 },
    color: '#f97316',
  },
  {
    id: 'banana',
    label: 'BANANA',
    emoji: '🍌',
    targets: [{ x: 0.302, y: 0.228, r: 0.045 }],
    bankPos: { x: 0.195, y: 0.905 },
    color: '#eab308',
  },
  {
    id: 'star',
    label: 'STAR',
    emoji: '⭐',
    targets: [
      { x: 0.201, y: 0.193, r: 0.042 },
      { x: 0.547, y: 0.304, r: 0.042 },
    ],
    bankPos: { x: 0.29, y: 0.905 },
    color: '#f59e0b',
  },
  {
    id: 'heart',
    label: 'HEART',
    emoji: '❤️',
    targets: [{ x: 0.285, y: 0.305, r: 0.042 }],
    bankPos: { x: 0.382, y: 0.905 },
    color: '#ec4899',
  },
  {
    id: 'key',
    label: 'KEY',
    emoji: '🔑',
    targets: [{ x: 0.148, y: 0.534, r: 0.045 }],
    bankPos: { x: 0.465, y: 0.905 },
    color: '#8b5cf6',
  },
  {
    id: 'moon',
    label: 'MOON',
    emoji: '🌙',
    targets: [{ x: 0.485, y: 0.222, r: 0.042 }],
    bankPos: { x: 0.545, y: 0.905 },
    color: '#eab308',
  },
  {
    id: 'crown',
    label: 'CROWN',
    emoji: '👑',
    targets: [{ x: 0.548, y: 0.498, r: 0.048 }],
    bankPos: { x: 0.635, y: 0.905 },
    color: '#f59e0b',
  },
  {
    id: 'fish',
    label: 'FISH',
    emoji: '🐟',
    targets: [{ x: 0.85, y: 0.508, r: 0.052 }],
    bankPos: { x: 0.735, y: 0.905 },
    color: '#06b6d4',
  },
  {
    id: 'pencil',
    label: 'PENCIL',
    emoji: '✏️',
    targets: [{ x: 0.362, y: 0.674, r: 0.045 }],
    bankPos: { x: 0.822, y: 0.905 },
    color: '#10b981',
  },
  {
    id: 'bone',
    label: 'BONE',
    emoji: '🦴',
    targets: [
      { x: 0.574, y: 0.671, r: 0.045 },
      { x: 0.81, y: 0.714, r: 0.05 },
    ],
    bankPos: { x: 0.905, y: 0.905 },
    color: '#6366f1',
  },
];

const WORD_SEARCH_GRID = [
  'LKBCHZNCSB',
  'GIAOHRHWFD',
  'UUTSREDIPS',
  'NBJTREATHC',
  'ICAULDRONH',
  'KHUMRACFTN',
  'PXCEMABSVH',
  'MDBTNPOLFW',
  'UPRDIHTLEQ',
  'PMYNGWMWNS',
];

const WORD_SEARCH_PLACEMENTS: WordPlacementDef[] = [
  { word: 'PUMPKIN', r0: 9, c0: 0, r1: 3, c1: 0, bankPos: { x: 0.2985, y: 0.7261 }, color: '#f97316' },
  { word: 'GHOST', r0: 9, c0: 4, r1: 5, c1: 8, bankPos: { x: 0.2985, y: 0.765 }, color: '#8b5cf6' },
  { word: 'BAT', r0: 0, c0: 2, r1: 2, c1: 2, bankPos: { x: 0.2985, y: 0.8039 }, color: '#ec4899' },
  { word: 'CANDY', r0: 5, c0: 6, r1: 9, c1: 2, bankPos: { x: 0.2985, y: 0.8429 }, color: '#14b8a6' },
  { word: 'WITCH', r0: 9, c0: 5, r1: 5, c1: 1, bankPos: { x: 0.2985, y: 0.8818 }, color: '#a855f7' },
  { word: 'SPIDER', r0: 2, c0: 9, r1: 2, c1: 4, bankPos: { x: 0.5065, y: 0.7261 }, color: '#3b82f6' },
  { word: 'LITTLABLES', r0: 0, c0: 0, r1: 9, c1: 9, bankPos: { x: 0.5065, y: 0.765 }, color: '#eab308' },
  { word: 'TREAT', r0: 3, c0: 3, r1: 3, c1: 7, bankPos: { x: 0.5065, y: 0.8039 }, color: '#10b981' },
  { word: 'COSTUME', r0: 0, c0: 3, r1: 6, c1: 3, bankPos: { x: 0.5065, y: 0.8429 }, color: '#f43f5e' },
  { word: 'CAULDRON', r0: 4, c0: 1, r1: 4, c1: 8, bankPos: { x: 0.5065, y: 0.8818 }, color: '#84cc16' },
];

// Normalized centers of cell (0,0) and cell (9,9) on the 3:4 worksheet canvas
const GRID_X0 = 0.2186;
const GRID_X9 = 0.7747;
const GRID_Y0 = 0.2246;
const GRID_Y9 = 0.6204;

function getGridCellNormalizedCenter(row: number, col: number): { x: number; y: number } {
  return {
    x: GRID_X0 + (col / 9) * (GRID_X9 - GRID_X0),
    y: GRID_Y0 + (row / 9) * (GRID_Y9 - GRID_Y0),
  };
}

function getNearestGridCell(normX: number, normY: number): { row: number; col: number } | null {
  const stepX = (GRID_X9 - GRID_X0) / 9;
  const stepY = (GRID_Y9 - GRID_Y0) / 9;
  const col = Math.round((normX - GRID_X0) / stepX);
  const row = Math.round((normY - GRID_Y0) / stepY);
  if (row < 0 || row > 9 || col < 0 || col > 9) {
    return null;
  }
  const center = getGridCellNormalizedCenter(row, col);
  const dx = Math.abs(normX - center.x);
  const dy = Math.abs(normY - center.y);
  if (dx > stepX * 0.75 || dy > stepY * 0.75) {
    return null;
  }
  return { row, col };
}

function snapToValidWordLine(
  r0: number,
  c0: number,
  r1: number,
  c1: number
): { r1: number; c1: number; cells: { r: number; c: number }[]; letters: string } {
  const dr = r1 - r0;
  const dc = c1 - c0;
  if (dr === 0 && dc === 0) {
    return { r1: r0, c1: c0, cells: [{ r: r0, c: c0 }], letters: WORD_SEARCH_GRID[r0][c0] };
  }
  const angle = Math.atan2(dr, dc);
  const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  const stepR = Math.round(Math.sin(snappedAngle));
  const stepC = Math.round(Math.cos(snappedAngle));
  const dist = Math.max(Math.abs(dr), Math.abs(dc));

  const cells: { r: number; c: number }[] = [];
  let letters = '';
  let lastR = r0;
  let lastC = c0;
  for (let k = 0; k <= dist; k++) {
    const nr = r0 + stepR * k;
    const nc = c0 + stepC * k;
    if (nr < 0 || nr > 9 || nc < 0 || nc > 9) break;
    lastR = nr;
    lastC = nc;
    cells.push({ r: nr, c: nc });
    letters += WORD_SEARCH_GRID[nr][nc];
  }
  return { r1: lastR, c1: lastC, cells, letters };
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

// Fast deterministic colored-pencil / crayon texture modulation at (x, y)
function getPencilTexturedRgb(
  x: number,
  y: number,
  baseR: number,
  baseG: number,
  baseB: number,
  useTexture: boolean
): [number, number, number] {
  if (!useTexture) return [baseR, baseG, baseB];
  // Diagonal coordinate (-45 deg)
  const u = (x + y) * 0.7071;
  const v = (x - y) * 0.7071;
  const wave1 = Math.sin(u * 0.85 + Math.sin(v * 0.04) * 2.2);
  const wave2 = Math.cos(u * 0.32 + v * 0.02 + 1.7);
  // Pseudo-random paper tooth
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = (h ^ (h >> 13)) * 1274126177;
  const grain = (((h ^ (h >> 16)) >>> 0) / 4294967295) - 0.5;

  const mod = wave1 * 0.42 + wave2 * 0.33 + grain * 0.35;
  if (mod > 0) {
    const t = Math.min(0.42, mod * 0.34);
    return [
      Math.round(baseR + (255 - baseR) * t),
      Math.round(baseG + (255 - baseG) * t),
      Math.round(baseB + (255 - baseB) * t),
    ];
  } else {
    const t = Math.min(0.24, -mod * 0.22);
    return [
      Math.round(baseR * (1 - t)),
      Math.round(baseG * (1 - t)),
      Math.round(baseB * (1 - t)),
    ];
  }
}

const CANVAS_W = 1080;
const CANVAS_H = 1440;

export const DigitalWorksheetModal: React.FC<DigitalWorksheetModalProps> = ({
  worksheet,
  allWorksheets,
  onClose,
  onSelectWorksheet,
  embedded = false,
}) => {
  const isHiddenObjects = worksheet?.id === 'halloween-2026-hidden-objects-coloring-page';
  const isWordSearch = worksheet?.id === 'halloween-2026-word-search';
  const hasPuzzleMode = isHiddenObjects || isWordSearch;

  const [tool, setTool] = useState<ToolMode>('bucket');
  const [selectedColor, setSelectedColor] = useState<string>(CRAYON_PALETTE[0].hex);
  const [brushSize, setBrushSize] = useState<number>(18);
  const [usePencilTexture, setUsePencilTexture] = useState<boolean>(true);
  const [isLoadingCanvas, setIsLoadingCanvas] = useState<boolean>(true);
  const [confirmReset, setConfirmReset] = useState<boolean>(false);

  // Puzzle state
  const [foundObjects, setFoundObjects] = useState<string[]>([]);
  const [foundWords, setFoundWords] = useState<string[]>([]);
  const [hintTargetId, setHintTargetId] = useState<string | null>(null);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  // Word Search drag selection state
  const [dragStartCell, setDragStartCell] = useState<{ row: number; col: number } | null>(null);
  const [dragCurrentCell, setDragCurrentCell] = useState<{ row: number; col: number } | null>(null);

  // Undo / Redo stacks of colorLayer Uint8ClampedArray (RGB, 3 bytes per pixel)
  const [undoCount, setUndoCount] = useState<number>(0);
  const [redoCount, setRedoCount] = useState<number>(0);
  const undoStackRef = useRef<Uint8Array[]>([]);
  const redoStackRef = useRef<Uint8Array[]>([]);

  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const printFrameRef = useRef<HTMLIFrameElement | null>(null);

  // Pixel buffers:
  // lineMaskRef: 0..255 blackness of the original worksheet line art (255 = pure black line, 0 = white paper)
  // colorLayerRef: W * H * 3 RGB bytes of user's coloring underneath the line art
  const lineMaskRef = useRef<Uint8Array | null>(null);
  const colorLayerRef = useRef<Uint8Array | null>(null);
  const isDrawingRef = useRef<boolean>(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const showToast = useCallback((msg: string) => {
    setStatusToast(msg);
  }, []);

  useEffect(() => {
    if (!statusToast) return;
    const timer = window.setTimeout(() => setStatusToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [statusToast]);

  // Set default initial tool when switching worksheets
  useEffect(() => {
    if (!worksheet) return;
    setConfirmReset(false);
    setHintTargetId(null);
    setDragStartCell(null);
    setDragCurrentCell(null);
    if (worksheet.id === 'halloween-2026-hidden-objects-coloring-page' || worksheet.id === 'halloween-2026-word-search') {
      setTool('puzzle');
    } else {
      setTool('bucket');
    }

    // Load saved puzzle state from localStorage
    try {
      const savedPuzzle = localStorage.getItem(`littlables:digital-puzzle:${worksheet.id}`);
      if (savedPuzzle) {
        const parsed = JSON.parse(savedPuzzle);
        if (Array.isArray(parsed.foundObjects)) setFoundObjects(parsed.foundObjects);
        else setFoundObjects([]);
        if (Array.isArray(parsed.foundWords)) setFoundWords(parsed.foundWords);
        else setFoundWords([]);
      } else {
        setFoundObjects([]);
        setFoundWords([]);
      }
    } catch {
      setFoundObjects([]);
      setFoundWords([]);
    }
  }, [worksheet]);

  // Save puzzle progress
  useEffect(() => {
    if (!worksheet) return;
    try {
      localStorage.setItem(
        `littlables:digital-puzzle:${worksheet.id}`,
        JSON.stringify({ foundObjects, foundWords })
      );
    } catch {}
  }, [worksheet, foundObjects, foundWords]);

  // Composite colorLayer + lineMask + puzzle overlays onto displayCanvas
  const renderDisplayCanvas = useCallback(() => {
    const canvas = displayCanvasRef.current;
    const lineMask = lineMaskRef.current;
    const colorLayer = colorLayerRef.current;
    if (!canvas || !lineMask || !colorLayer) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imgData = ctx.createImageData(CANVAS_W, CANVAS_H);
    const out = imgData.data;
    const totalPixels = CANVAS_W * CANVAS_H;

    for (let i = 0; i < totalPixels; i++) {
      const lineBlackness = lineMask[i]; // 0 = white, 255 = black
      const cIdx = i * 3;
      const oIdx = i * 4;
      if (lineBlackness === 0) {
        out[oIdx] = colorLayer[cIdx];
        out[oIdx + 1] = colorLayer[cIdx + 1];
        out[oIdx + 2] = colorLayer[cIdx + 2];
        out[oIdx + 3] = 255;
      } else {
        const keep = (255 - lineBlackness) / 255;
        out[oIdx] = Math.round(colorLayer[cIdx] * keep);
        out[oIdx + 1] = Math.round(colorLayer[cIdx + 1] * keep);
        out[oIdx + 2] = Math.round(colorLayer[cIdx + 2] * keep);
        out[oIdx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Draw interactive puzzle overlays (Found Hidden Objects OR Found Word Search lines)
    if (isHiddenObjects) {
      for (const obj of HIDDEN_OBJECTS_LIST) {
        if (!foundObjects.includes(obj.id)) continue;
        // Circle in scene
        for (const t of obj.targets) {
          const cx = t.x * CANVAS_W;
          const cy = t.y * CANVAS_H;
          const r = t.r * CANVAS_W;
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = `${obj.color}28`;
          ctx.fill();
          ctx.lineWidth = 5;
          ctx.strokeStyle = obj.color;
          ctx.stroke();

          // Checkmark badge on top-right of ring
          const bx = cx + r * 0.72;
          const by = cy - r * 0.72;
          ctx.beginPath();
          ctx.arc(bx, by, 14, 0, Math.PI * 2);
          ctx.fillStyle = obj.color;
          ctx.fill();
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 16px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('✓', bx, by + 1);
          ctx.restore();
        }

        // Circle & check off in bottom checklist bar
        const bx = obj.bankPos.x * CANVAS_W;
        const by = obj.bankPos.y * CANVAS_H;
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, 38, 0, Math.PI * 2);
        ctx.fillStyle = `${obj.color}33`;
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = obj.color;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(bx + 24, by - 24, 12, 0, Math.PI * 2);
        ctx.fillStyle = '#10b981';
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✓', bx + 24, by - 23);
        ctx.restore();
      }

      // Draw a larger search-area hint circle around where the hidden object is located
      if (hintTargetId) {
        const hintObj = HIDDEN_OBJECTS_LIST.find((o) => o.id === hintTargetId);
        if (hintObj && hintObj.targets[0]) {
          const t = hintObj.targets[0];
          const cx = t.x * CANVAS_W;
          const cy = t.y * CANVAS_H;
          const r = Math.max(t.r * CANVAS_W * 2.85, 135);
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(250, 204, 21, 0.22)';
          ctx.fill();
          ctx.lineWidth = 11;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.stroke();
          ctx.lineWidth = 7;
          ctx.setLineDash([16, 12]);
          ctx.strokeStyle = '#f59e0b';
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    if (isWordSearch) {
      // Draw found words in the 10x10 grid and check off in the Word Bank
      for (const wp of WORD_SEARCH_PLACEMENTS) {
        if (!foundWords.includes(wp.word)) continue;
        const p0 = getGridCellNormalizedCenter(wp.r0, wp.c0);
        const p1 = getGridCellNormalizedCenter(wp.r1, wp.c1);
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.beginPath();
        ctx.moveTo(p0.x * CANVAS_W, p0.y * CANVAS_H);
        ctx.lineTo(p1.x * CANVAS_W, p1.y * CANVAS_H);
        ctx.lineCap = 'round';
        ctx.lineWidth = 38;
        ctx.strokeStyle = `${wp.color}66`;
        ctx.stroke();
        ctx.restore();

        // Outline of word pill
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(p0.x * CANVAS_W, p0.y * CANVAS_H);
        ctx.lineTo(p1.x * CANVAS_W, p1.y * CANVAS_H);
        ctx.lineCap = 'round';
        ctx.lineWidth = 40;
        ctx.strokeStyle = wp.color;
        ctx.globalAlpha = 0.55;
        ctx.stroke();
        ctx.restore();

        // Check off pumpkin in Word Bank
        const kx = wp.bankPos.x * CANVAS_W;
        const ky = wp.bankPos.y * CANVAS_H;
        ctx.save();
        ctx.beginPath();
        ctx.arc(kx, ky, 15, 0, Math.PI * 2);
        ctx.fillStyle = wp.color;
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✓', kx, ky + 1);

        // Strikethrough line across the found word in the Word Bank
        ctx.beginPath();
        ctx.moveTo(kx + 24, ky);
        ctx.lineTo(kx + 145, ky);
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = wp.color;
        ctx.stroke();
        ctx.restore();
      }

      // Draw active drag selection line
      if (dragStartCell && dragCurrentCell) {
        const snapped = snapToValidWordLine(
          dragStartCell.row,
          dragStartCell.col,
          dragCurrentCell.row,
          dragCurrentCell.col
        );
        const p0 = getGridCellNormalizedCenter(dragStartCell.row, dragStartCell.col);
        const p1 = getGridCellNormalizedCenter(snapped.r1, snapped.c1);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(p0.x * CANVAS_W, p0.y * CANVAS_H);
        ctx.lineTo(p1.x * CANVAS_W, p1.y * CANVAS_H);
        ctx.lineCap = 'round';
        ctx.lineWidth = 38;
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.38)';
        ctx.stroke();
        ctx.restore();
      }

      // Draw hint highlight covering at least a 3x3 grid area around the start letter of the hinted word
      if (hintTargetId) {
        const wp = WORD_SEARCH_PLACEMENTS.find((w) => w.word === hintTargetId);
        if (wp) {
          // Clamp center to 1..8 so a full 3x3 block of letters is enclosed inside the 10x10 grid
          const centerR = Math.max(1, Math.min(8, wp.r0));
          const centerC = Math.max(1, Math.min(8, wp.c0));
          const pCenter = getGridCellNormalizedCenter(centerR, centerC);
          const cx = pCenter.x * CANVAS_W;
          const cy = pCenter.y * CANVAS_H;
          const r = 122; // Diameter 244px > 3x3 grid cells (~200px)
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(250, 204, 21, 0.22)';
          ctx.fill();
          ctx.lineWidth = 11;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.stroke();
          ctx.lineWidth = 7;
          ctx.setLineDash([16, 12]);
          ctx.strokeStyle = '#f59e0b';
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }, [isHiddenObjects, isWordSearch, foundObjects, foundWords, dragStartCell, dragCurrentCell, hintTargetId]);

  const [isControlsOpen, setIsControlsOpen] = useState<boolean>(false);

  // Load worksheet line art into lineMaskRef and initialize colorLayerRef
  useEffect(() => {
    if (!worksheet) return;
    let cancelled = false;
    setIsLoadingCanvas(true);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      const offscreen = document.createElement('canvas');
      offscreen.width = CANVAS_W;
      offscreen.height = CANVAS_H;
      const offCtx = offscreen.getContext('2d');
      if (!offCtx) return;

      offCtx.fillStyle = '#ffffff';
      offCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      offCtx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);

      const raw = offCtx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
      const totalPixels = CANVAS_W * CANVAS_H;
      const lineMask = new Uint8Array(totalPixels);
      const colorLayer = new Uint8Array(totalPixels * 3);

      for (let i = 0; i < totalPixels; i++) {
        const r = raw[i * 4];
        const g = raw[i * 4 + 1];
        const b = raw[i * 4 + 2];
        const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        // Clean white paper threshold so JPEG artifacts near 250..255 become pure 0
        lineMask[i] = lum > 242 ? 0 : 255 - lum;
        colorLayer[i * 3] = 255;
        colorLayer[i * 3 + 1] = 255;
        colorLayer[i * 3 + 2] = 255;
      }

      lineMaskRef.current = lineMask;
      colorLayerRef.current = colorLayer;
      undoStackRef.current = [];
      redoStackRef.current = [];
      setUndoCount(0);
      setRedoCount(0);
      setIsLoadingCanvas(false);
      renderDisplayCanvas();
    };
    img.onerror = () => {
      if (!cancelled) setIsLoadingCanvas(false);
    };
    img.src = worksheet.jpgUrl;

    return () => {
      cancelled = true;
    };
  }, [worksheet]);

  // Re-render display canvas whenever puzzle overlays change
  useEffect(() => {
    if (!isLoadingCanvas) {
      renderDisplayCanvas();
    }
  }, [isLoadingCanvas, renderDisplayCanvas]);

  const pushUndoSnapshot = () => {
    const colorLayer = colorLayerRef.current;
    if (!colorLayer) return;
    const copy = new Uint8Array(colorLayer);
    undoStackRef.current.push(copy);
    if (undoStackRef.current.length > 25) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(0);
  };

  const handleUndo = () => {
    const colorLayer = colorLayerRef.current;
    if (!colorLayer || undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current.pop()!;
    redoStackRef.current.push(new Uint8Array(colorLayer));
    colorLayer.set(prev);
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    renderDisplayCanvas();
  };

  const handleRedo = () => {
    const colorLayer = colorLayerRef.current;
    if (!colorLayer || redoStackRef.current.length === 0) return;
    const next = redoStackRef.current.pop()!;
    undoStackRef.current.push(new Uint8Array(colorLayer));
    colorLayer.set(next);
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    renderDisplayCanvas();
  };

  const handleResetAll = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    const colorLayer = colorLayerRef.current;
    if (colorLayer) {
      pushUndoSnapshot();
      colorLayer.fill(255);
    }
    setFoundObjects([]);
    setFoundWords([]);
    setHintTargetId(null);
    renderDisplayCanvas();
    showToast('Worksheet reset to a fresh page!');
  };

  // Smart Scanline Flood Fill with 1px Anti-Aliased Edge Dilation
  const performBucketFill = (startX: number, startY: number, hexColor: string) => {
    const lineMask = lineMaskRef.current;
    const colorLayer = colorLayerRef.current;
    if (!lineMask || !colorLayer) return;

    const sx = Math.max(0, Math.min(CANVAS_W - 1, Math.round(startX)));
    const sy = Math.max(0, Math.min(CANVAS_H - 1, Math.round(startY)));
    const startIdx = sy * CANVAS_W + sx;

    // If user clicked directly on a dark black line, search a tiny 3px neighborhood for an adjacent fillable pixel
    let seedX = sx;
    let seedY = sy;
    if (lineMask[startIdx] > 110) {
      let foundSeed = false;
      for (let r = 1; r <= 4 && !foundSeed; r++) {
        for (let dy = -r; dy <= r && !foundSeed; dy++) {
          for (let dx = -r; dx <= r && !foundSeed; dx++) {
            const nx = sx + dx;
            const ny = sy + dy;
            if (nx >= 0 && nx < CANVAS_W && ny >= 0 && ny < CANVAS_H) {
              if (lineMask[ny * CANVAS_W + nx] <= 90) {
                seedX = nx;
                seedY = ny;
                foundSeed = true;
              }
            }
          }
        }
      }
      if (!foundSeed) return;
    }

    pushUndoSnapshot();

    const [targetR, targetG, targetB] = hexToRgb(hexColor);
    const visited = new Uint8Array(CANVAS_W * CANVAS_H);
    const stack = new Int32Array(CANVAS_W * CANVAS_H);
    let sp = 0;

    const seedIdx = seedY * CANVAS_W + seedX;
    visited[seedIdx] = 1;
    stack[sp++] = seedIdx;

    const WALL_THRESHOLD = 95; // lineMask > 95 acts as an outline boundary

    while (sp > 0) {
      const curr = stack[--sp];
      const cx = curr % CANVAS_W;
      const cy = (curr - cx) / CANVAS_W;

      const [r, g, b] = getPencilTexturedRgb(cx, cy, targetR, targetG, targetB, usePencilTexture);
      const cIdx = curr * 3;
      colorLayer[cIdx] = r;
      colorLayer[cIdx + 1] = g;
      colorLayer[cIdx + 2] = b;

      // 4-connected neighbors + 1px dilation into anti-aliased boundary edges
      const neighbors = [
        cx > 0 ? curr - 1 : -1,
        cx < CANVAS_W - 1 ? curr + 1 : -1,
        cy > 0 ? curr - CANVAS_W : -1,
        cy < CANVAS_H - 1 ? curr + CANVAS_W : -1,
      ];

      for (let i = 0; i < 4; i++) {
        const nIdx = neighbors[i];
        if (nIdx === -1 || visited[nIdx]) continue;
        if (lineMask[nIdx] <= WALL_THRESHOLD) {
          visited[nIdx] = 1;
          stack[sp++] = nIdx;
        } else {
          // Dilate 1px into the anti-aliased black outline so there is no white halo!
          visited[nIdx] = 2;
          const nx = nIdx % CANVAS_W;
          const ny = (nIdx - nx) / CANVAS_W;
          const [er, eg, eb] = getPencilTexturedRgb(nx, ny, targetR, targetG, targetB, usePencilTexture);
          const ncIdx = nIdx * 3;
          colorLayer[ncIdx] = er;
          colorLayer[ncIdx + 1] = eg;
          colorLayer[ncIdx + 2] = eb;
        }
      }
    }

    renderDisplayCanvas();
  };

  // Paint a circular brush dab along (x0, y0) -> (x1, y1)
  const paintStrokeSegment = (x0: number, y0: number, x1: number, y1: number) => {
    const colorLayer = colorLayerRef.current;
    if (!colorLayer) return;

    const isEraser = tool === 'eraser';
    const [baseR, baseG, baseB] = isEraser ? [255, 255, 255] : hexToRgb(selectedColor);
    const radius = brushSize;
    const rSq = radius * radius;

    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / Math.max(2, radius * 0.28)));

    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      const cx = Math.round(x0 + (x1 - x0) * t);
      const cy = Math.round(y0 + (y1 - y0) * t);

      const minY = Math.max(0, cy - radius);
      const maxY = Math.min(CANVAS_H - 1, cy + radius);
      const minX = Math.max(0, cx - radius);
      const maxX = Math.min(CANVAS_W - 1, cx + radius);

      for (let py = minY; py <= maxY; py++) {
        const dy = py - cy;
        const rowOffset = py * CANVAS_W;
        for (let px = minX; px <= maxX; px++) {
          const dx = px - cx;
          if (dx * dx + dy * dy <= rSq) {
            const cIdx = (rowOffset + px) * 3;
            if (isEraser) {
              colorLayer[cIdx] = 255;
              colorLayer[cIdx + 1] = 255;
              colorLayer[cIdx + 2] = 255;
            } else {
              const [r, g, b] = getPencilTexturedRgb(px, py, baseR, baseG, baseB, usePencilTexture);
              colorLayer[cIdx] = r;
              colorLayer[cIdx + 1] = g;
              colorLayer[cIdx + 2] = b;
            }
          }
        }
      }
    }
  };

  const getCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number; normX: number; normY: number } => {
    const canvas = displayCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return {
      x: normX * CANVAS_W,
      y: normY * CANVAS_H,
      normX,
      normY,
    };
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isLoadingCanvas) return;
    if (isControlsOpen) {
      setIsControlsOpen(false);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y, normX, normY } = getCanvasCoords(e);

    if (tool === 'puzzle') {
      if (isHiddenObjects) {
        // Check if user tapped any hidden object in the scene (or its icon in the bottom checklist)
        for (const obj of HIDDEN_OBJECTS_LIST) {
          const hitScene = obj.targets.some((t) => Math.hypot(normX - t.x, normY - t.y) <= t.r * 1.25);
          const hitBank = Math.hypot(normX - obj.bankPos.x, normY - obj.bankPos.y) <= 0.042;
          if (hitScene || hitBank) {
            setHintTargetId(null);
            if (!foundObjects.includes(obj.id)) {
              const next = [...foundObjects, obj.id];
              setFoundObjects(next);
              if (next.length === HIDDEN_OBJECTS_LIST.length) {
                showToast('🎉 Amazing! You found all 10 hidden objects! Open Tools & Colors to color!');
              } else {
                showToast(`${obj.emoji} Found ${obj.label}! (${next.length}/${HIDDEN_OBJECTS_LIST.length})`);
              }
            } else {
              showToast(`${obj.emoji} You already found ${obj.label}!`);
            }
            return;
          }
        }
        showToast('🔍 Tap a hidden object, or open Tools & Colors below to color!');
        return;
      }

      if (isWordSearch) {
        const cell = getNearestGridCell(normX, normY);
        if (cell) {
          setDragStartCell(cell);
          setDragCurrentCell(cell);
          return;
        }
        showToast('🔤 Drag across letters in the grid, or open Tools & Colors below to color!');
        return;
      }
    }

    if (tool === 'bucket') {
      performBucketFill(x, y, selectedColor);
      return;
    }

    if (tool === 'brush' || tool === 'eraser') {
      pushUndoSnapshot();
      isDrawingRef.current = true;
      lastPointRef.current = { x, y };
      paintStrokeSegment(x, y, x, y);
      renderDisplayCanvas();
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isLoadingCanvas) return;
    const { x, y, normX, normY } = getCanvasCoords(e);

    if (tool === 'puzzle' && isWordSearch && dragStartCell) {
      const cell = getNearestGridCell(normX, normY);
      if (cell && (cell.row !== dragCurrentCell?.row || cell.col !== dragCurrentCell?.col)) {
        setDragCurrentCell(cell);
      }
      return;
    }

    if ((tool === 'brush' || tool === 'eraser') && isDrawingRef.current && lastPointRef.current) {
      paintStrokeSegment(lastPointRef.current.x, lastPointRef.current.y, x, y);
      lastPointRef.current = { x, y };
      renderDisplayCanvas();
    }
  };

  const handleCanvasPointerUp = () => {
    if (tool === 'puzzle' && isWordSearch && dragStartCell && dragCurrentCell) {
      const snapped = snapToValidWordLine(
        dragStartCell.row,
        dragStartCell.col,
        dragCurrentCell.row,
        dragCurrentCell.col
      );
      const forwardWord = snapped.letters;
      const reverseWord = forwardWord.split('').reverse().join('');

      const matched = WORD_SEARCH_PLACEMENTS.find(
        (wp) => wp.word === forwardWord || wp.word === reverseWord
      );

      if (matched) {
        setHintTargetId(null);
        if (!foundWords.includes(matched.word)) {
          const next = [...foundWords, matched.word];
          setFoundWords(next);
          if (next.length === WORD_SEARCH_PLACEMENTS.length) {
            showToast('🎉 Spooktacular! You found all 10 Halloween words! Now color the characters!');
          } else {
            showToast(`✨ Found "${matched.word}"! (${next.length}/${WORD_SEARCH_PLACEMENTS.length})`);
          }
        } else {
          showToast(`✓ You already found "${matched.word}"!`);
        }
      }

      setDragStartCell(null);
      setDragCurrentCell(null);
      return;
    }

    isDrawingRef.current = false;
    lastPointRef.current = null;
  };

  const handleHint = () => {
    if (isHiddenObjects) {
      const remaining = HIDDEN_OBJECTS_LIST.filter((o) => !foundObjects.includes(o.id));
      if (remaining.length === 0) {
        showToast('🎉 All 10 hidden objects have been found!');
        return;
      }
      const nextHint = remaining[0];
      setTool('puzzle');
      setHintTargetId(nextHint.id);
      setIsControlsOpen(false);
      showToast(`💡 Hint: Look for the ${nextHint.emoji} ${nextHint.label} inside the dashed gold circle!`);
    } else if (isWordSearch) {
      const remaining = WORD_SEARCH_PLACEMENTS.filter((w) => !foundWords.includes(w.word));
      if (remaining.length === 0) {
        showToast('🎉 All 10 words have been found!');
        return;
      }
      const nextHint = remaining[0];
      setTool('puzzle');
      setHintTargetId(nextHint.word);
      setIsControlsOpen(false);
      showToast(`💡 Hint: Look for the start of "${nextHint.word}" inside the dashed gold circle!`);
    }
  };

  const handleSaveJpg = () => {
    const canvas = displayCanvasRef.current;
    if (!canvas || !worksheet) return;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.94);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = worksheet.jpgFilename.replace('.jpg', '-colored.jpg');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('⬇ Saved your colored worksheet JPG!');
  };

  const handlePrintCreation = () => {
    const canvas = displayCanvasRef.current;
    if (!canvas || !worksheet) return;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.94);
    const escapedTitle = worksheet.title.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const printHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapedTitle}</title>
  <style>
    @page { size: letter portrait; margin: 0; }
    html, body { width: 100%; height: 100%; margin: 0; padding: 0; background: #fff; overflow: hidden; }
    .wrap { width: 100%; height: 100vh; display: flex; align-items: center; justify-content: center; }
    img { max-width: 100%; max-height: 96vh; object-fit: contain; display: block; }
  </style>
</head>
<body>
  <div class="wrap"><img id="pimg" src="${dataUrl}" alt="${escapedTitle}" /></div>
  <script>
    var img = document.getElementById('pimg');
    function go() { setTimeout(function() { window.focus(); window.print(); }, 100); }
    if (img.complete) go(); else img.onload = go;
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
  };

  if (!worksheet) return null;

  const activeToolLabel =
    tool === 'puzzle'
      ? isHiddenObjects
        ? '🔍 Find Objects'
        : '🔤 Find Words'
      : tool === 'bucket'
      ? '🪣 Tap Fill'
      : tool === 'brush'
      ? '🖍️ Crayon'
      : '🧽 Eraser';

  return (
    <div
      className={`digital-worksheet-modal-backdrop${embedded ? ' is-embedded' : ''}`}
      role={embedded ? undefined : 'dialog'}
      aria-modal={embedded ? undefined : true}
      aria-label={embedded ? undefined : `Interactive Digital Activity: ${worksheet.title}`}
      onClick={(e) => {
        if (!embedded && e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`digital-worksheet-modal${embedded ? ' is-embedded' : ''}`}>
        {/* Top Studio Header */}
        <header className="digital-worksheet-header">
          <div className="digital-worksheet-title-group">
            <select
              className="digital-worksheet-switcher"
              aria-label="Select digital activity worksheet"
              value={worksheet.id}
              onChange={(e) => {
                const found = allWorksheets.find((w) => w.id === e.target.value);
                if (found) onSelectWorksheet(found);
              }}
            >
              {allWorksheets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.badge.split(' ')[0]} {w.title}
                </option>
              ))}
            </select>
          </div>

          <div className="digital-worksheet-header-actions">
            {isHiddenObjects && (
              <div className="digital-puzzle-progress">
                <span>🔍 {foundObjects.length} / {HIDDEN_OBJECTS_LIST.length} Found</span>
                <button type="button" className="digital-hint-btn" onClick={handleHint}>
                  💡 Hint
                </button>
              </div>
            )}
            {isWordSearch && (
              <div className="digital-puzzle-progress">
                <span>🔤 {foundWords.length} / {WORD_SEARCH_PLACEMENTS.length} Words</span>
                <button type="button" className="digital-hint-btn" onClick={handleHint}>
                  💡 Hint
                </button>
              </div>
            )}

            <button
              type="button"
              className="digital-worksheet-close-btn"
              onClick={onClose}
              aria-label={embedded ? 'Back to games' : 'Close Digital Activity Studio'}
              title={embedded ? 'Back to games' : 'Close'}
            >
              {embedded ? '←' : '✕'}
            </button>
          </div>
        </header>

        {/* Full-Page Main Worksheet Stage + Floating Popover Controls Panel */}
        <div className="digital-worksheet-body">
          <div className="digital-worksheet-stage">
            {statusToast && (
              <div className="digital-worksheet-toast" role="status" aria-live="polite">
                {statusToast}
              </div>
            )}

            <div className="digital-canvas-frame">
              {isLoadingCanvas && (
                <div className="digital-canvas-loading">Loading interactive worksheet…</div>
              )}
              <canvas
                ref={displayCanvasRef}
                width={CANVAS_W}
                height={CANVAS_H}
                className={`digital-worksheet-canvas tool-${tool}`}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerCancel={handleCanvasPointerUp}
              />
            </div>

            {/* Popover Panel for Controls, Colors & Checklist */}
            {isControlsOpen && (
              <aside
                className="digital-controls-popover"
                aria-label="Worksheet Tools and Colors"
              >
                <div className="digital-popover-header">
                  <span className="digital-popover-title">🎨 Tools &amp; Options</span>
                  <button
                    type="button"
                    className="digital-popover-close"
                    onClick={() => setIsControlsOpen(false)}
                    aria-label="Close tools panel"
                  >
                    ✕
                  </button>
                </div>

                {/* Mode / Tool Selection */}
                <div className="digital-tool-section">
                  <span className="digital-section-label">Mode</span>
                  <div className="digital-tool-grid">
                    {hasPuzzleMode && (
                      <button
                        type="button"
                        className={`digital-tool-btn ${tool === 'puzzle' ? 'is-active' : ''}`}
                        onClick={() => setTool('puzzle')}
                      >
                        <span>{isHiddenObjects ? '🔍' : '🔤'}</span>
                        <span>{isHiddenObjects ? 'Find Objects' : 'Find Words'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className={`digital-tool-btn ${tool === 'bucket' ? 'is-active' : ''}`}
                      onClick={() => setTool('bucket')}
                    >
                      <span>🪣</span>
                      <span>Tap Fill</span>
                    </button>
                    <button
                      type="button"
                      className={`digital-tool-btn ${tool === 'brush' ? 'is-active' : ''}`}
                      onClick={() => setTool('brush')}
                    >
                      <span>🖍️</span>
                      <span>Crayon</span>
                    </button>
                    <button
                      type="button"
                      className={`digital-tool-btn ${tool === 'eraser' ? 'is-active' : ''}`}
                      onClick={() => setTool('eraser')}
                    >
                      <span>🧽</span>
                      <span>Eraser</span>
                    </button>
                  </div>

                  {(tool === 'brush' || tool === 'eraser') && (
                    <div className="digital-brush-size-row">
                      <span className="digital-section-label">Brush Size</span>
                      <div className="digital-size-buttons">
                        {[
                          { label: 'S', size: 9 },
                          { label: 'M', size: 18 },
                          { label: 'L', size: 32 },
                        ].map((opt) => (
                          <button
                            key={opt.label}
                            type="button"
                            className={`digital-size-btn ${brushSize === opt.size ? 'is-active' : ''}`}
                            onClick={() => setBrushSize(opt.size)}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <label className="digital-texture-toggle">
                    <input
                      type="checkbox"
                      checked={usePencilTexture}
                      onChange={(e) => setUsePencilTexture(e.target.checked)}
                    />
                    <span>✨ Colored-Pencil Texture</span>
                  </label>
                </div>

                {/* Crayon Color Palette */}
                <div className="digital-tool-section">
                  <span className="digital-section-label">Crayon Colors</span>
                  <div className="digital-color-grid">
                    {CRAYON_PALETTE.map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        className={`digital-color-swatch ${
                          selectedColor.toLowerCase() === c.hex.toLowerCase() && tool !== 'eraser'
                            ? 'is-selected'
                            : ''
                        }`}
                        style={{ backgroundColor: c.hex }}
                        title={c.name}
                        aria-label={c.name}
                        onClick={() => {
                          setSelectedColor(c.hex);
                          if (tool === 'puzzle' || tool === 'eraser') {
                            setTool('bucket');
                          }
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* Interactive Puzzle Checklist (for Hidden Objects or Word Search) */}
                {isHiddenObjects && (
                  <div className="digital-tool-section digital-checklist-section">
                    <span className="digital-section-label">
                      Hidden Objects ({foundObjects.length}/10) — Tap for Hint
                    </span>
                    <div className="digital-checklist-chips">
                      {HIDDEN_OBJECTS_LIST.map((obj) => {
                        const isFound = foundObjects.includes(obj.id);
                        return (
                          <button
                            key={obj.id}
                            type="button"
                            className={`digital-checklist-chip ${isFound ? 'is-found' : ''}`}
                            onClick={() => {
                              if (!isFound) {
                                setTool('puzzle');
                                setHintTargetId(obj.id);
                                setIsControlsOpen(false);
                                showToast(`💡 Look for ${obj.emoji} ${obj.label} inside the dashed gold circle!`);
                              }
                            }}
                          >
                            <span>{isFound ? '✓' : obj.emoji}</span>
                            <span>{obj.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {isWordSearch && (
                  <div className="digital-tool-section digital-checklist-section">
                    <span className="digital-section-label">
                      Word Bank ({foundWords.length}/10) — Tap for Hint
                    </span>
                    <div className="digital-checklist-chips">
                      {WORD_SEARCH_PLACEMENTS.map((wp) => {
                        const isFound = foundWords.includes(wp.word);
                        return (
                          <button
                            key={wp.word}
                            type="button"
                            className={`digital-checklist-chip ${isFound ? 'is-found' : ''}`}
                            onClick={() => {
                              if (!isFound) {
                                setTool('puzzle');
                                setHintTargetId(wp.word);
                                setIsControlsOpen(false);
                                showToast(`💡 Look for the start of "${wp.word}" inside the dashed gold circle!`);
                              }
                            }}
                          >
                            <span>{isFound ? '✓' : '🎃'}</span>
                            <span>{wp.word}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="digital-tool-section digital-history-row">
                  <button
                    type="button"
                    className={`digital-history-btn digital-reset-btn ${confirmReset ? 'is-confirming' : ''}`}
                    onClick={handleResetAll}
                    title="Clear all coloring and reset puzzle"
                  >
                    {confirmReset ? 'Confirm Reset?' : '🗑️ Reset Page'}
                  </button>
                </div>
              </aside>
            )}
          </div>
        </div>

        {/* Bottom Studio Footer Bar */}
        <footer className="digital-worksheet-footer">
          <div className="digital-footer-left">
            <button
              type="button"
              className={`digital-popover-toggle-btn ${isControlsOpen ? 'is-open' : ''}`}
              onClick={() => setIsControlsOpen((prev) => !prev)}
              aria-expanded={isControlsOpen}
            >
              <span
                className="digital-active-color-dot"
                style={{
                  backgroundColor: tool === 'eraser' ? '#ffffff' : selectedColor,
                }}
              />
              <span>🎨 Tools &amp; Colors ({activeToolLabel})</span>
              <span>{isControlsOpen ? '▾' : '▴'}</span>
            </button>

            <button
              type="button"
              className="digital-history-btn"
              onClick={handleUndo}
              disabled={undoCount === 0}
              title="Undo coloring step"
            >
              ↶ Undo
            </button>
            <button
              type="button"
              className="digital-history-btn"
              onClick={handleRedo}
              disabled={redoCount === 0}
              title="Redo coloring step"
            >
              ↷ Redo
            </button>
          </div>

          <div className="digital-footer-right">
            <button
              type="button"
              className="worksheet-action-btn worksheet-print-btn"
              onClick={handlePrintCreation}
              title="Print your colored worksheet"
            >
              🖨️ Print
            </button>
            <button
              type="button"
              className="worksheet-action-btn worksheet-download-btn"
              onClick={handleSaveJpg}
              title="Download your colored worksheet as JPG"
            >
              ⬇ Save JPG
            </button>
          </div>
        </footer>

        <iframe
          ref={printFrameRef}
          title="Digital Worksheet Print Frame"
          className="worksheet-print-iframe"
          aria-hidden="true"
        />
      </div>
    </div>
  );
};
