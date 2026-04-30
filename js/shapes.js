'use strict';

/**
 * shapes.js — Puzzle piece shape generation.
 *
 * Edge Table — single source of truth for every shared edge.
 *
 * Architecture:
 *   Each interior edge is stored ONCE in a flat Map keyed by canonical ID.
 *   Horizontal edges (between rows):  key = `h:${col}:${row}`  (edge below row `row`)
 *   Vertical edges   (between cols):  key = `v:${col}:${row}`  (edge right of col `col`)
 *
 *   Value: +1 (tab protrudes in the "positive" direction) or -1 (blank).
 *   "Positive" direction:
 *     vertical edge   → tab protrudes RIGHT  (into col+1)
 *     horizontal edge → tab protrudes DOWN   (into row+1)
 *
 * When building a piece's path, each edge looks up its direction:
 *   right  edge of (c,r): vertEdge(c, r)           → d > 0: tab right
 *   left   edge of (c,r): vertEdge(c-1, r)  negated → d < 0 means tab went right = blank on left
 *   bottom edge of (c,r): horizEdge(c, r)           → d > 0: tab down
 *   top    edge of (c,r): horizEdge(c, r-1) negated → d < 0 means tab went down = blank on top
 *
 * Because each edge is stored once, the two pieces sharing it always see the same shape.
 */
class EdgeTable {
  constructor() {
    this._v = new Map(); // vertical edges   (right side of col c)
    this._h = new Map(); // horizontal edges (bottom side of row r)
  }

  /** Generate all edges for a cols×rows grid. Randomised, one direction per edge. */
  generate(cols, rows) {
    this._v.clear();
    this._h.clear();
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols - 1; c++)
        this._v.set(`${c}:${r}`, Math.random() < 0.5 ? 1 : -1);
    for (let r = 0; r < rows - 1; r++)
      for (let c = 0; c < cols; c++)
        this._h.set(`${c}:${r}`, Math.random() < 0.5 ? 1 : -1);
  }

  right(c, r)  { return this._v.get(`${c}:${r}`)   ??  0; }
  bottom(c, r) { return this._h.get(`${c}:${r}`)   ??  0; }
  left(c, r)   { return this._v.get(`${c-1}:${r}`) ?? 0; }
  top(c, r)    { return this._h.get(`${c}:${r-1}`) ?? 0; }
}

// Singleton — created once, passed into PathCache.reset()
const edgeTable = new EdgeTable();

// ── Shape constants ──
const TAB_DEPTH = 0.28;
const NECK      = 0.18;
const HEAD      = 0.25;

/**
 * Build a Path2D for piece (col, row).
 * Uses edgeTable for all edge directions — guaranteed consistent with neighbors.
 * Path at origin (0,0), piece size pw×ph.
 */
function buildPiecePath(pw, ph, col, row, cols, rows) {
  const p  = new Path2D();
  const mx = pw / 2, my = ph / 2;
  const et = edgeTable;

  p.moveTo(0, 0);

  // ── TOP edge ──
  if (row > 0) {
    const d = et.top(col, row) * ph * TAB_DEPTH;
    p.lineTo(mx - pw * NECK, 0);
    p.bezierCurveTo(mx - pw * NECK, d * 0.5,  mx - pw * HEAD, d,  mx, d);
    p.bezierCurveTo(mx + pw * HEAD, d,         mx + pw * NECK, d * 0.5,  mx + pw * NECK, 0);
  }
  p.lineTo(pw, 0);

  // ── RIGHT edge ──
  if (col < cols - 1) {
    const d = et.right(col, row) * pw * TAB_DEPTH;
    p.lineTo(pw, my - ph * NECK);
    p.bezierCurveTo(pw + d * 0.5, my - ph * NECK,  pw + d, my - ph * HEAD,  pw + d, my);
    p.bezierCurveTo(pw + d, my + ph * HEAD,         pw + d * 0.5, my + ph * NECK,  pw, my + ph * NECK);
  }
  p.lineTo(pw, ph);

  // ── BOTTOM edge ──
  if (row < rows - 1) {
    const d = et.bottom(col, row) * ph * TAB_DEPTH;
    p.lineTo(mx + pw * NECK, ph);
    p.bezierCurveTo(mx + pw * NECK, ph + d * 0.5,  mx + pw * HEAD, ph + d,  mx, ph + d);
    p.bezierCurveTo(mx - pw * HEAD, ph + d,         mx - pw * NECK, ph + d * 0.5,  mx - pw * NECK, ph);
  }
  p.lineTo(0, ph);

  // ── LEFT edge ──
  if (col > 0) {
    const d = et.left(col, row) * pw * TAB_DEPTH;
    p.lineTo(0, my + ph * NECK);
    p.bezierCurveTo(d * 0.5, my + ph * NECK,  d, my + ph * HEAD,  d, my);
    p.bezierCurveTo(d, my - ph * HEAD,         d * 0.5, my - ph * NECK,  0, my - ph * NECK);
  }

  p.closePath();
  return p;
}

/**
 * Build a Path2D for one edge only (used for selective border drawing).
 * Same coordinate convention as buildPiecePath.
 */
function buildEdgePath(pw, ph, col, row, cols, rows, edge) {
  const p  = new Path2D();
  const mx = pw / 2, my = ph / 2;
  const et = edgeTable;

  if (edge === 'top') {
    p.moveTo(0, 0);
    if (row > 0) {
      const d = et.top(col, row) * ph * TAB_DEPTH;
      p.lineTo(mx - pw * NECK, 0);
      p.bezierCurveTo(mx - pw * NECK, d * 0.5, mx - pw * HEAD, d, mx, d);
      p.bezierCurveTo(mx + pw * HEAD, d, mx + pw * NECK, d * 0.5, mx + pw * NECK, 0);
    }
    p.lineTo(pw, 0);

  } else if (edge === 'right') {
    p.moveTo(pw, 0);
    if (col < cols - 1) {
      const d = et.right(col, row) * pw * TAB_DEPTH;
      p.lineTo(pw, my - ph * NECK);
      p.bezierCurveTo(pw + d * 0.5, my - ph * NECK, pw + d, my - ph * HEAD, pw + d, my);
      p.bezierCurveTo(pw + d, my + ph * HEAD, pw + d * 0.5, my + ph * NECK, pw, my + ph * NECK);
    }
    p.lineTo(pw, ph);

  } else if (edge === 'bottom') {
    p.moveTo(pw, ph);
    if (row < rows - 1) {
      const d = et.bottom(col, row) * ph * TAB_DEPTH;
      p.lineTo(mx + pw * NECK, ph);
      p.bezierCurveTo(mx + pw * NECK, ph + d * 0.5, mx + pw * HEAD, ph + d, mx, ph + d);
      p.bezierCurveTo(mx - pw * HEAD, ph + d, mx - pw * NECK, ph + d * 0.5, mx - pw * NECK, ph);
    }
    p.lineTo(0, ph);

  } else { // left
    p.moveTo(0, ph);
    if (col > 0) {
      const d = et.left(col, row) * pw * TAB_DEPTH;
      p.lineTo(0, my + ph * NECK);
      p.bezierCurveTo(d * 0.5, my + ph * NECK, d, my + ph * HEAD, d, my);
      p.bezierCurveTo(d, my - ph * HEAD, d * 0.5, my - ph * NECK, 0, my - ph * NECK);
    }
    p.lineTo(0, 0);
  }
  return p;
}

/**
 * PathCache — stores Path2Ds rebuilt only when pw/ph/edgeTable changes.
 */
class PathCache {
  constructor() {
    this._cache = new Map();
    this._edges = new Map();
    this._pw = 0; this._ph = 0;
  }

  reset(pw, ph) {
    this._cache.clear();
    this._edges.clear();
    this._pw = pw; this._ph = ph;
  }

  get(col, row, cols, rows) {
    const id = row * 10000 + col;
    if (!this._cache.has(id))
      this._cache.set(id, buildPiecePath(this._pw, this._ph, col, row, cols, rows));
    return this._cache.get(id);
  }

  getEdge(col, row, cols, rows, edge) {
    const key = `${col},${row},${edge}`;
    if (!this._edges.has(key))
      this._edges.set(key, buildEdgePath(this._pw, this._ph, col, row, cols, rows, edge));
    return this._edges.get(key);
  }
}
