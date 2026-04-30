'use strict';

/**
 * renderer.js — High-performance puzzle renderer
 *
 * Performance architecture:
 *
 * 1. PRE-SCALE SOURCE ONCE PER FRAME
 *    Each tick, the raw media source (video/img) is drawn once into a puzzle-sized
 *    OffscreenCanvas. Every piece then blits from this cheap offscreen — no repeated
 *    full-resolution drawImage calls. Uses transferToImageBitmap() for zero-copy
 *    GPU texture transfer (Chrome-optimised).
 *
 * 2. LIVE PER-EDGE BORDERS
 *    Each frame, only edges facing a different group are stroked — internal seams
 *    between snapped pieces are skipped. On solve, borders fade to zero over 2s.
 *
 * 3. CLIP-ONCE PER PIECE via cached Path2D + ctx.setTransform()
 *    Path2D objects are built at origin and reused. setTransform() repositions
 *    them without rebuilding. The clipping region is the only per-frame Path2D
 *    operation — one clip + one drawImage per piece.
 *
 * 4. SINGLE rAF LOOP owned entirely by Renderer.
 *    MediaPlayer exposes getSource() — no rAF in MediaPlayer at all.
 *    Engine updates piece positions on pointer events (sync, no rAF needed).
 */

const OUTLINE_COLOR       = 'rgba(0,0,0,0.65)';
const OUTLINE_WIDTH       = 1.4;
const DRAG_OUTLINE_COLOR  = 'rgba(232,197,71,0.85)';
const DRAG_OUTLINE_WIDTH  = 2.0;
const GHOST_ALPHA         = 0.18;
const GHOST_BORDER_COLOR  = 'rgba(255,255,255,0.06)';
const GHOST_BORDER_WIDTH  = 1.5;
const SHADOW_BLUR         = 16;
const SHADOW_OFFSET_Y     = 6;

const EDGES     = ['top', 'right', 'bottom', 'left'];
const EDGE_DIR  = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
const EMPTY_SET = new Set();

class Renderer {
  constructor(canvas, player, engine) {
    this._canvas  = canvas;
    this._ctx     = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
    this._player  = player;
    this._engine  = engine;

    this._pathCache    = new PathCache();
    this._srcOffscreen  = null;
    this._lastBitmap    = null;

    this._showGhost = false;
    this._rafId     = null;
    this._running   = false;
    this._solvedAt  = null;
    this._bgColor   = '#0d0e10';
    this._boundTick = this._tick.bind(this);
  }

  /* ── Lifecycle ── */

  setup(cols, rows, pw, ph, puzX, puzY, puzW, puzH, wsW, wsH) {
    this._cols = cols; this._rows = rows;
    this._pw = pw; this._ph = ph;
    this._puzX = puzX; this._puzY = puzY;
    this._puzW = puzW; this._puzH = puzH;
    this._wsW  = wsW;  this._wsH  = wsH;

    this._canvas.width  = wsW;
    this._canvas.height = wsH;

    this._pathCache.reset(pw, ph);
    this._solvedAt = null;
    this._staticSrc = null;
    this._srcOC = null;
    this._srcCtx = null;
    if (this._lastBitmap) { this._lastBitmap.close(); this._lastBitmap = null; }
  }

  setBgColor(c) { this._bgColor = c; }

  start() {
    this._running = true;
    if (!this._rafId) this._rafId = requestAnimationFrame(this._boundTick);
  }

  stop() {
    this._running = false;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (this._lastBitmap) { this._lastBitmap.close(); this._lastBitmap = null; }
  }

  toggleGhost() { this._showGhost = !this._showGhost; return this._showGhost; }

  solve() {
    this._solvedAt = performance.now();
    setTimeout(() => { this._onSolved?.(); }, 1800);
  }

  onSolved(cb) { this._onSolved = cb; }

  getPathCache() { return this._pathCache; }

  /* ── Main render tick ── */

  _tick() {
    if (!this._running) return;
    this._rafId = requestAnimationFrame(this._boundTick);
    this._drawFrame();
  }

  _drawFrame() {
    const ctx    = this._ctx;
    const src    = this._player.getSource();
    const state  = this._engine.getState();

    let srcBitmap = this._lastBitmap;
    if (src) {
      const fresh = this._prescaleSource(src);
      if (fresh) srcBitmap = fresh;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this._bgColor;
    ctx.fillRect(0, 0, this._wsW, this._wsH);

    if (srcBitmap) {
      ctx.strokeStyle = GHOST_BORDER_COLOR;
      ctx.lineWidth   = GHOST_BORDER_WIDTH;
      ctx.strokeRect(this._puzX, this._puzY, this._puzW, this._puzH);
    }

    if (this._showGhost && srcBitmap) {
      ctx.globalAlpha = GHOST_ALPHA;
      ctx.drawImage(srcBitmap, this._puzX, this._puzY);
      ctx.globalAlpha = 1;
    }

    const dragIds = state.dragGid != null
      ? (state.groups.get(state.dragGid) ?? EMPTY_SET)
      : EMPTY_SET;

    let borderAlpha = 1;
    if (this._solvedAt !== null) {
      const elapsed = (performance.now() - this._solvedAt) / 1000;
      borderAlpha = Math.max(0, 1 - elapsed / 2);
    }

    if (borderAlpha <= 0 && srcBitmap && state.pieces.length > 0) {
      const p0 = state.pieces[0];
      ctx.drawImage(srcBitmap, p0.x - p0.col * this._pw, p0.y - p0.row * this._ph);
      return;
    }

    for (const pc of state.pieces) {
      this._drawPiece(ctx, pc, srcBitmap, dragIds.has(pc.id), state.groups, state.pieceById, borderAlpha);
    }
  }

  _drawPiece(ctx, pc, srcBitmap, isDragged, groups, pieceById, borderAlpha = 1) {
    const path = this._pathCache.get(pc.col, pc.row, this._cols, this._rows);

    if (isDragged) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, pc.x, pc.y);
      ctx.shadowColor   = 'rgba(0,0,0,0.75)';
      ctx.shadowBlur    = SHADOW_BLUR;
      ctx.shadowOffsetY = SHADOW_OFFSET_Y;
      ctx.shadowOffsetX = 3;
      ctx.fillStyle = 'rgba(0,0,0,0.001)';
      ctx.fill(path);
      ctx.restore();
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, pc.x, pc.y);
    ctx.clip(path);

    if (srcBitmap) {
      const ovf  = Math.ceil(Math.max(this._pw, this._ph) * TAB_DEPTH + 2);
      const srcX = Math.max(0, pc.col * this._pw - ovf);
      const srcY = Math.max(0, pc.row * this._ph - ovf);
      const srcR = Math.min(this._puzW, (pc.col + 1) * this._pw + ovf);
      const srcB = Math.min(this._puzH, (pc.row + 1) * this._ph + ovf);
      const srcW = srcR - srcX;
      const srcH = srcB - srcY;
      const dstX = srcX - pc.col * this._pw;
      const dstY = srcY - pc.row * this._ph;
      ctx.drawImage(srcBitmap, srcX, srcY, srcW, srcH, dstX, dstY, srcW, srcH);
    } else {
      ctx.fillStyle = `hsl(${(pc.col + pc.row) * 41}, 18%, 18%)`;
      const ovf = Math.ceil(Math.max(this._pw, this._ph) * 0.4);
      ctx.fillRect(-ovf, -ovf, this._pw + ovf * 2, this._ph + ovf * 2);
    }

    ctx.restore();

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, pc.x, pc.y);

    if (borderAlpha <= 0) { ctx.restore(); return; }
    ctx.globalAlpha = borderAlpha;
    if (isDragged) {
      ctx.strokeStyle = DRAG_OUTLINE_COLOR;
      ctx.lineWidth   = DRAG_OUTLINE_WIDTH;
    } else {
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth   = OUTLINE_WIDTH;
    }

    for (const edge of EDGES) {
      const [dc, dr] = EDGE_DIR[edge];
      const nc = pc.col + dc, nr = pc.row + dr;
      if (nc >= 0 && nc < this._cols && nr >= 0 && nr < this._rows) {
        const nbId = nr * this._cols + nc;
        const nb   = pieceById.get(nbId);
        if (nb && nb.gid === pc.gid) continue;
      }
      const ep = this._pathCache.getEdge(pc.col, pc.row, this._cols, this._rows, edge);
      ctx.stroke(ep);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ── Source pre-scaling ── */

  _prescaleSource(src) {
    let srcW, srcH;
    const isVideo = src instanceof HTMLVideoElement;
    if (isVideo) {
      srcW = src.videoWidth;  srcH = src.videoHeight;
      if (!srcW || !srcH || src.readyState < 2) return null;
    } else {
      srcW = src.naturalWidth; srcH = src.naturalHeight;
      if (!srcW || !srcH) return null;
      if (this._lastBitmap && this._staticSrc === src) return null;
      this._staticSrc = src;
    }

    if (!this._srcOC || this._srcOC.width !== this._puzW || this._srcOC.height !== this._puzH) {
      this._srcOC  = new OffscreenCanvas(this._puzW, this._puzH);
      this._srcCtx = this._srcOC.getContext('2d', { alpha: false });
    }

    this._srcCtx.drawImage(src, 0, 0, srcW, srcH, 0, 0, this._puzW, this._puzH);

    if (this._lastBitmap) this._lastBitmap.close();
    this._lastBitmap = this._srcOC.transferToImageBitmap();
    return this._lastBitmap;
  }
}
