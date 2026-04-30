'use strict';

/**
 * engine.js — PuzzleEngine
 *
 * Responsibilities:
 *  - Piece positions and group membership
 *  - Mouse/pointer drag handling (updates positions synchronously)
 *  - Snap detection on piece release
 *  - Viewport pan + zoom (CSS transform on the canvas element)
 *  - Win detection
 *  - Exposes getState() for the renderer to read each frame
 *
 * No rendering, no rAF. Pure state machine.
 *
 * Group merging strategy:
 *   When piece A is dropped near piece B, we align ALL of B's group to A's group
 *   by computing the offset between B's current position and its expected position
 *   relative to A. This is "local snapping" — pieces lock based on their relative
 *   offsets, not their absolute position in the puzzle.
 */
class PuzzleEngine {
  constructor(canvasEl, wsEl) {
    this._canvas = canvasEl;
    this._ws     = wsEl;

    // Viewport
    this._vx = 0; this._vy = 0; this._vs = 1;

    // Drag state
    this._drag = null;   // { gid, startWX, startWY, origPositions: Map<id,{x,y}> }
    this._pan  = null;   // { sx, sy, vx0, vy0 }
    this._spaceDown = false;

    // Callbacks
    this._onSnap = null;
    this._onWin  = null;
    this._onProgress = null;

    this._bindEvents();
  }

  /* ── Setup ── */

  init(cfg) {
    const { cols, rows, pw, ph, puzX, puzY, puzW, puzH, wsW, wsH } = cfg;
    this._cols = cols; this._rows = rows;
    this._pw = pw; this._ph = ph;
    this._puzX = puzX; this._puzY = puzY;
    this._puzW = puzW; this._puzH = puzH;
    this._wsW  = wsW;  this._wsH  = wsH;

    this._pieces    = [];
    this._pieceById = new Map();
    this._groups    = new Map();
    this._gidSeq    = 1;
    this._t0        = Date.now();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const id  = r * cols + c;
        const gid = this._gidSeq++;
        this._groups.set(gid, new Set([id]));

        const { x, y } = this._randomScatterPos(pw, ph, wsW, wsH, puzX, puzY, puzW, puzH);
        const pc = { id, col: c, row: r, x, y, gid };
        this._pieces.push(pc);
        this._pieceById.set(id, pc);
      }
    }

    this._drag = null;
    this._pan  = null;
  }

  reset() {
    this._pieces    = [];
    this._pieceById = new Map();
    this._groups    = new Map();
    this._drag      = null;
    this._pan       = null;
  }

  onSnap(cb)     { this._onSnap = cb; }
  onWin(cb)      { this._onWin = cb; }
  onProgress(cb) { this._onProgress = cb; }

  /* ── State accessor ── */

  getState() {
    return {
      pieces:    this._pieces    ?? [],
      groups:    this._groups    ?? new Map(),
      pieceById: this._pieceById ?? new Map(),
      dragGid:   this._drag?.gid ?? null,
    };
  }

  /* ── Viewport ── */

  fitView() {
    const sw = this._ws.clientWidth;
    const sh = this._ws.clientHeight;
    if (!this._wsW || !this._wsH) return;
    this._vs = Math.min(sw / this._wsW, sh / this._wsH) * 0.88;
    this._vx = (sw - this._wsW * this._vs) / 2;
    this._vy = (sh - this._wsH * this._vs) / 2;
    this._applyVP();
  }

  _applyVP() {
    this._canvas.style.transform = `translate(${this._vx}px,${this._vy}px) scale(${this._vs})`;
  }

  _screenToWS(sx, sy) {
    return {
      x: (sx - this._vx) / this._vs,
      y: (sy - this._vy) / this._vs,
    };
  }

  /* ── Event binding ── */

  _bindEvents() {
    const ws = this._ws;
    ws.addEventListener('mousedown',  this._onDown.bind(this));
    ws.addEventListener('mousemove',  this._onMove.bind(this));
    ws.addEventListener('mouseup',    this._onUp.bind(this));
    ws.addEventListener('mouseleave', this._onUp.bind(this));
    ws.addEventListener('wheel',      this._onWheel.bind(this), { passive: false });
    window.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); this._spaceDown = true; } });
    window.addEventListener('keyup',   e => { if (e.code === 'Space') this._spaceDown = false; });
  }

  _wsRect() { return this._ws.getBoundingClientRect(); }

  _onDown(e) {
    if (e.button === 2) return;
    const rect = this._wsRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (this._spaceDown || e.button === 1) {
      this._startPan(sx, sy); return;
    }
    if (!this._pieces?.length) { this._startPan(sx, sy); return; }

    const wp  = this._screenToWS(sx, sy);
    const hit = this._hitTest(wp.x, wp.y);
    if (!hit) { this._startPan(sx, sy); return; }

    const gid     = hit.gid;
    const members = this._groups.get(gid);
    const orig    = new Map();
    members.forEach(pid => {
      const p = this._pieceById.get(pid);
      orig.set(pid, { x: p.x, y: p.y });
    });

    this._drag = { gid, startWX: wp.x, startWY: wp.y, origPositions: orig };

    const dragged = this._pieces.filter(p => members.has(p.id));
    const rest    = this._pieces.filter(p => !members.has(p.id));
    this._pieces  = [...rest, ...dragged];

    this._ws.style.cursor = 'grabbing';
  }

  _onMove(e) {
    const rect = this._wsRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (this._pan) {
      this._vx = this._pan.vx0 + sx - this._pan.sx;
      this._vy = this._pan.vy0 + sy - this._pan.sy;
      this._applyVP();
      return;
    }

    if (!this._drag) return;
    const wp = this._screenToWS(sx, sy);
    const dx = wp.x - this._drag.startWX;
    const dy = wp.y - this._drag.startWY;

    const members = this._groups.get(this._drag.gid);
    members.forEach(pid => {
      const o  = this._drag.origPositions.get(pid);
      const pc = this._pieceById.get(pid);
      pc.x = o.x + dx;
      pc.y = o.y + dy;
    });
  }

  _onUp() {
    this._ws.style.cursor = '';
    this._ws.classList.remove('pan');
    if (this._pan) { this._pan = null; return; }
    if (this._drag) {
      this._trySnap(this._drag.gid);
      this._drag = null;
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const rect = this._wsRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const f  = e.deltaY > 0 ? 0.88 : 1.14;
    const ns = Math.max(0.04, Math.min(8, this._vs * f));
    this._vx = sx - (sx - this._vx) * (ns / this._vs);
    this._vy = sy - (sy - this._vy) * (ns / this._vs);
    this._vs = ns;
    this._applyVP();
  }

  _startPan(sx, sy) {
    this._pan = { sx, sy, vx0: this._vx, vy0: this._vy };
    this._ws.classList.add('pan');
  }

  /* ── Hit testing ── */

  _hitTest(wx, wy) {
    if (!this._hitCtx) {
      const oc = new OffscreenCanvas(1, 1);
      this._hitCtx = oc.getContext('2d');
    }

    const TAB_FRAC = 0.32;
    const ox = this._pw * TAB_FRAC;
    const oy = this._ph * TAB_FRAC;

    // Pass 1: precise Path2D shape test
    for (let i = this._pieces.length - 1; i >= 0; i--) {
      const pc = this._pieces[i];
      if (wx < pc.x - ox || wx > pc.x + this._pw + ox) continue;
      if (wy < pc.y - oy || wy > pc.y + this._ph + oy) continue;
      const localX = wx - pc.x;
      const localY = wy - pc.y;
      const path = this._pathCache().get(pc.col, pc.row, this._cols, this._rows);
      if (this._hitCtx.isPointInPath(path, localX, localY)) return pc;
    }

    // Pass 2: padded bounding box fallback
    const PAD = Math.max(this._pw, this._ph) * 0.12;
    const fx = ox + PAD;
    const fy = oy + PAD;
    for (let i = this._pieces.length - 1; i >= 0; i--) {
      const pc = this._pieces[i];
      if (wx < pc.x - fx || wx > pc.x + this._pw + fx) continue;
      if (wy < pc.y - fy || wy > pc.y + this._ph + fy) continue;
      return pc;
    }

    return null;
  }

  _pathCache() { return this._pc; }
  setPathCache(pc) { this._pc = pc; }

  /* ── Snap engine ── */

  get SNAP_DIST() { return Math.max(14, Math.min(28, (this._pw + this._ph) * 0.08)); }

  _trySnap(gid) {
    let members = this._groups.get(gid);
    if (!members) return;

    let snapped = false;
    let found   = true;

    while (found) {
      found = false;
      members = this._groups.get(gid);
      if (!members) break;

      for (const pid of members) {
        const pc  = this._pieceById.get(pid);
        const nbs = this._neighbors(pc.col, pc.row);

        for (const nb of nbs) {
          const nbId = nb.r * this._cols + nb.c;
          const nbPc = this._pieceById.get(nbId);
          if (!nbPc || members.has(nbPc.id)) continue;

          const expX = pc.x + nb.dc * this._pw;
          const expY = pc.y + nb.dr * this._ph;
          const dist = Math.hypot(nbPc.x - expX, nbPc.y - expY);

          if (dist < this.SNAP_DIST) {
            this._mergeGroups(gid, nbPc.gid, pc, nb.dc, nb.dr);
            snapped = true;
            found   = true;
            break;
          }
        }
        if (found) break;
      }
    }

    if (snapped) {
      this._onSnap?.();
      this._onProgress?.(this._progressInfo());
      this._checkWin();
    }
  }

  _neighbors(col, row) {
    const out = [];
    if (col > 0)            out.push({ c: col-1, r: row,   dc: -1, dr:  0 });
    if (col < this._cols-1) out.push({ c: col+1, r: row,   dc:  1, dr:  0 });
    if (row > 0)            out.push({ c: col,   r: row-1, dc:  0, dr: -1 });
    if (row < this._rows-1) out.push({ c: col,   r: row+1, dc:  0, dr:  1 });
    return out;
  }

  _mergeGroups(gidA, gidB, anchorA, dc, dr) {
    const nbId = (anchorA.row + dr) * this._cols + (anchorA.col + dc);
    const nbPc = this._pieceById.get(nbId);

    const ox = (anchorA.x + dc * this._pw) - nbPc.x;
    const oy = (anchorA.y + dr * this._ph) - nbPc.y;

    const bMembers = this._groups.get(gidB);
    const aMembers = this._groups.get(gidA);

    bMembers.forEach(pid => {
      const p = this._pieceById.get(pid);
      p.x  += ox;
      p.y  += oy;
      p.gid = gidA;
      aMembers.add(pid);
    });
    this._groups.delete(gidB);
  }

  _checkWin() {
    if (this._groups.size === 1) {
      const elapsed = Math.round((Date.now() - this._t0) / 1000);
      this._onWin?.(elapsed);
    }
  }

  _progressInfo() {
    const total = this._cols * this._rows - 1;
    const done  = this._cols * this._rows - this._groups.size;
    return { done, total, pct: total > 0 ? done / total : 0 };
  }

  /* ── Gather ── */

  gather() {
    if (!this._pieces?.length) return;

    let bigGid = null, bigSize = 0;
    for (const [gid, members] of this._groups) {
      if (members.size > bigSize) { bigSize = members.size; bigGid = gid; }
    }

    const pad   = Math.max(this._pw, this._ph);
    const zoneX = this._puzX - pad;
    const zoneY = this._puzY - pad;
    const zoneR = this._puzX + this._puzW + pad;
    const zoneB = this._puzY + this._puzH + pad;

    const LERP = 0.6;
    const moved = new Set();

    for (const pc of this._pieces) {
      if (pc.gid === bigGid || moved.has(pc.gid)) continue;
      moved.add(pc.gid);

      const cx = pc.x + this._pw / 2;
      const cy = pc.y + this._ph / 2;

      const tx = Math.max(zoneX + this._pw / 2, Math.min(zoneR - this._pw / 2, cx));
      const ty = Math.max(zoneY + this._ph / 2, Math.min(zoneB - this._ph / 2, cy));

      if (cx === tx && cy === ty) continue;

      const dx = (tx - cx) * LERP;
      const dy = (ty - cy) * LERP;

      const members = this._groups.get(pc.gid);
      members.forEach(pid => {
        const p = this._pieceById.get(pid);
        p.x += dx;
        p.y += dy;
      });
    }
  }

  /* ── Scatter ── */

  _randomScatterPos(pw, ph, wsW, wsH, puzX, puzY, puzW, puzH) {
    const margin = Math.max(pw, ph) * 0.5;
    const clearX0 = puzX - pw * 1.5;
    const clearX1 = puzX + puzW + pw * 0.5;
    const clearY0 = puzY - ph * 1.5;
    const clearY1 = puzY + puzH + ph * 0.5;

    let x, y, attempts = 0;
    do {
      x = margin + Math.random() * (wsW - pw - margin * 2);
      y = margin + Math.random() * (wsH - ph - margin * 2);
      attempts++;
    } while (
      attempts < 12 &&
      x > clearX0 && x < clearX1 &&
      y > clearY0 && y < clearY1
    );

    return { x, y };
  }
}
