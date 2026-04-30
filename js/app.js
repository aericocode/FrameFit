'use strict';

/**
 * app.js — Application orchestrator
 *
 * Wires MediaPlayer → PuzzleEngine → Renderer → UIController together.
 * Owns the puzzle start/reset lifecycle and layout math.
 */

// Pre-computed piece count steps: each entry is a total count.
// Cols/rows are computed from media aspect ratio at start time.
window.PIECE_STEPS = [
  6, 12, 20, 30, 42, 56, 80, 110, 140, 180, 220, 260, 300, 350, 400, 500, 650, 800
];

const WS_PAD = 1.5;   // workspace = puzzle * (1 + 2*WS_PAD) on each axis

class App {
  constructor() {
    this._player    = new MediaPlayer();
    this._canvas    = document.getElementById('c');
    this._ws        = document.getElementById('ws');
    this._engine    = new PuzzleEngine(this._canvas, this._ws);
    this._renderer  = new Renderer(this._canvas, this._player, this._engine);
    this._ui        = new UIController(this._player);

    // Engine and renderer share path cache (engine for hit-testing)
    this._engine.setPathCache(this._renderer.getPathCache());

    this._active  = false;
    this._mediaW  = 0;
    this._mediaH  = 0;
    this._bgColor = '#1e1f22';
  }

  init() {
    this._ui.bindHandlers({
      onStartRequested: () => this._startPuzzle(),
      onGhostToggle:    () => this._renderer.toggleGhost(),
      onFit:            () => this._engine.fitView(),
      onGather:         () => this._engine.gather(),
      onBgChange:       (c) => this._setBg(c),
    });
    this._ui.init();

    // If user clears all media mid-game, end the active game
    this._player.onQueueChange((q) => {
      if (this._active && q.length === 0) this._stopActiveGame();
    });

    // Set initial BG from CSS default
    this._setBg(getComputedStyle(document.documentElement).getPropertyValue('--tk-bg').trim() || '#1e1f22');
  }

  _stopActiveGame() {
    this._renderer.stop();
    this._engine.reset();
    this._active = false;
    this._ui.setGameActive(false);
    this._ui.hideWinScreen();
    this._canvas.classList.remove('active');
    // Clear the canvas
    this._canvas.width = 1; this._canvas.height = 1;
  }

  /* ── Puzzle lifecycle ── */

  async _startPuzzle() {
    if (!this._player.hasMedia) return;

    const stepIdx = parseInt(document.getElementById('iPieces').value);
    const target  = window.PIECE_STEPS[this._clamp(stepIdx, 0, window.PIECE_STEPS.length - 1)];

    // Stop previous game
    this._renderer.stop();
    this._active = false;
    this._ui.setGameActive(false);
    this._ui.hideWinScreen();
    this._canvas.classList.remove('active');

    // Load media, wait for first frame dimensions
    const { w, h } = await this._loadMedia();
    this._mediaW = w; this._mediaH = h;

    // Compute grid + layout
    const { cols, rows } = this._bestGrid(target, this._mediaW, this._mediaH);
    const layout = this._computeLayout(cols, rows, this._mediaW, this._mediaH);

    // Generate fresh edge directions, then reset path cache
    edgeTable.generate(layout.cols, layout.rows);
    this._renderer.getPathCache().reset(layout.pw, layout.ph);

    // Init engine
    this._engine.init(layout);
    this._engine.fitView();

    this._engine.onSnap(()      => this._ui.flashSnap());
    this._engine.onWin(elapsed  => this._onWin(elapsed));
    this._engine.onProgress(i   => this._ui.setProgress(i));

    this._renderer.setup(
      layout.cols, layout.rows, layout.pw, layout.ph,
      layout.puzX, layout.puzY, layout.puzW, layout.puzH,
      layout.wsW,  layout.wsH
    );
    this._renderer.setBgColor(this._bgColor);

    this._ui.setProgress({ done: 0, total: cols * rows - 1, pct: 0 });

    this._active = true;
    this._ui.setGameActive(true);
    this._canvas.classList.add('active');

    this._renderer.start();
  }

  /**
   * Find cols × rows closest to target piece count while keeping pieces ~square.
   */
  _bestGrid(target, mediaW, mediaH) {
    const aspect = mediaW / mediaH;
    let bestCols = 4, bestRows = Math.max(2, Math.round(target / 4));
    let bestScore = Infinity;

    const maxC = Math.ceil(Math.sqrt(target * 2));
    for (let c = 2; c <= maxC; c++) {
      const r = Math.max(2, Math.round(target / c));
      const total = c * r;
      if (total < 4) continue;

      const pieceAspect = aspect * r / c;
      const squareness  = Math.abs(Math.log(pieceAspect));
      const countError  = Math.abs(total - target) / target;
      const score       = squareness + countError * 0.5;

      if (score < bestScore) {
        bestScore = score;
        bestCols  = c;
        bestRows  = r;
      }
    }
    return { cols: bestCols, rows: bestRows };
  }

  _loadMedia() {
    return new Promise(resolve => {
      this._player.onReady((w, h) => {
        this._mediaW = w; this._mediaH = h;
        resolve({ w, h });
      });
      this._player.start();
    });
  }

  _computeLayout(cols, rows, mediaW, mediaH) {
    const sw = this._ws.clientWidth;
    const sh = this._ws.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const maxPuzW = sw * 0.55 * dpr;
    const maxPuzH = sh * 0.65 * dpr;
    const scale   = Math.min(maxPuzW / mediaW, maxPuzH / mediaH, 1);

    const pw = Math.max(20, Math.round((mediaW * scale) / cols));
    const ph = Math.max(20, Math.round((mediaH * scale) / rows));

    const puzW = pw * cols;
    const puzH = ph * rows;
    const wsW  = Math.round(puzW * (1 + 2 * WS_PAD));
    const wsH  = Math.round(puzH * (1 + 2 * WS_PAD));
    const puzX = Math.round((wsW - puzW) / 2);
    const puzY = Math.round((wsH - puzH) / 2);

    return { cols, rows, pw, ph, puzW, puzH, wsW, wsH, puzX, puzY };
  }

  _onWin(elapsed) {
    this._ui.showWin(elapsed);
    this._renderer.solve();
    this._renderer.onSolved(() => {
      this._ui.showWinScreen();
    });
  }

  _setBg(color) {
    this._bgColor = color;
    document.documentElement.style.setProperty('--tk-bg', color);
    this._renderer.setBgColor(color);
  }

  _clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
}

window.addEventListener('load', () => new App().init());
