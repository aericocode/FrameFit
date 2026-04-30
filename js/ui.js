'use strict';

/**
 * ui.js — UIController
 *
 * Owns all DOM interaction:
 *  - Toolbar (start, ghost, fit, gather, playback, volume, speed, BG color)
 *  - Media modal (drop zone, queue list, footer actions)
 *  - Empty-state landing (no media yet — full-workspace drop zone)
 *  - Ready-state overlay (media loaded, prompt to start)
 *  - Win screen
 *
 * Wires user events back to App via callbacks (set in `bindHandlers`).
 */
class UIController {
  constructor(player) {
    this._player = player;

    // Callbacks (set by App)
    this._onStartRequested = null;
    this._onPiecesChange   = null;
    this._onGhostToggle    = null;
    this._onFit            = null;
    this._onGather         = null;
    this._onBgChange       = null;

    // Pending-confirm state on Start button
    this._pendingNew = false;

    // App state Ui needs to know
    this._gameActive = false;
  }

  bindHandlers(handlers) {
    Object.assign(this, {
      _onStartRequested: handlers.onStartRequested,
      _onPiecesChange:   handlers.onPiecesChange,
      _onGhostToggle:    handlers.onGhostToggle,
      _onFit:            handlers.onFit,
      _onGather:         handlers.onGather,
      _onBgChange:       handlers.onBgChange,
    });
  }

  /* ── Public state setters ── */

  setGameActive(active) {
    this._gameActive = active;
    document.body.classList.toggle('game-active', active);
    this._refreshLandingState();
    this._updateStartButton();
  }

  /* ── Init ── */

  init() {
    this._bindToolbar();
    this._bindModal();
    this._bindLanding();
    this._bindWin();
    this._initBgSwatches();
    this._renderQueueUI();
    this._updatePieceLabel();
    this._refreshLandingState();

    // Player → UI: queue list re-renders, empty state may flip
    this._player.onQueueChange(() => {
      this._renderQueueUI();
      this._refreshLandingState();
    });
  }

  /* ── Landing states (empty / ready / hidden) ──
   * empty:  no media, no game     → show drop-zone landing
   * ready:  media loaded, no game → show "Start Puzzle" overlay
   * hidden: game running          → show neither
   */
  _refreshLandingState() {
    const empty  = document.getElementById('empty');
    const ready  = document.getElementById('ready');

    if (this._gameActive) {
      empty.classList.add('hidden');
      ready.classList.add('hidden');
      return;
    }

    if (this._player.hasMedia) {
      empty.classList.add('hidden');
      ready.classList.remove('hidden');
      const cnt = this._player.queueLength;
      document.getElementById('readyCount').textContent = cnt;
    } else {
      empty.classList.remove('hidden');
      ready.classList.add('hidden');
    }
  }

  /* ── Toolbar ── */

  _bindToolbar() {
    document.getElementById('bMedia').addEventListener('click', () => this._openMediaModal());
    document.getElementById('bStart').addEventListener('click', () => this._handleStartClick());

    const slider = document.getElementById('iPieces');
    slider.addEventListener('input', () => {
      this._updatePieceLabel();
      this._onPiecesChange?.(parseInt(slider.value));
    });

    const bGhost = document.getElementById('bGhost');
    bGhost.addEventListener('click', () => {
      const on = this._onGhostToggle?.() ?? false;
      bGhost.classList.toggle('tk-btn--primary', on);
    });

    document.getElementById('bFit').addEventListener('click',    () => this._onFit?.());
    document.getElementById('bGather').addEventListener('click', () => this._onGather?.());

    // Playback controls
    document.getElementById('bPrev').addEventListener('click',   () => this._player.prev());
    document.getElementById('bNext').addEventListener('click',   () => this._player.next());
    document.getElementById('bBack10').addEventListener('click', () => this._player.seek(-10));
    document.getElementById('bFwd10').addEventListener('click',  () => this._player.seek(10));
    document.getElementById('bPlayPause').addEventListener('click', () => this._player.togglePlay());

    // Volume
    const vol = document.getElementById('vol');
    vol.addEventListener('input', () => {
      this._player.setVolume(parseFloat(vol.value));
      this._updateVolIcon(parseFloat(vol.value));
    });
    document.getElementById('vol-ic').addEventListener('click', () => {
      const v = parseFloat(vol.value) > 0 ? 0 : 0.7;
      vol.value = v;
      this._player.setVolume(v);
      this._updateVolIcon(v);
    });

    // Speed
    const speed    = document.getElementById('speed');
    const speedLbl = document.getElementById('speed-lbl');
    speed.addEventListener('input', () => {
      const r = parseFloat(speed.value);
      this._player.setSpeed(r);
      speedLbl.textContent = Number.isInteger(r) ? r + '×' : parseFloat(r.toFixed(2)) + '×';
    });
    speedLbl.addEventListener('click', () => {
      speed.value = 1;
      this._player.setSpeed(1);
      speedLbl.textContent = '1×';
    });

    // Scrub bar
    const trackWrap = document.getElementById('pb-track-wrap');
    let scrubbing = false;
    const scrubTo = (e) => {
      const rect = trackWrap.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this._player.seekTo(pct);
    };
    trackWrap.addEventListener('mousedown', (e) => { scrubbing = true; scrubTo(e); });
    window.addEventListener('mousemove',    (e) => { if (scrubbing) scrubTo(e); });
    window.addEventListener('mouseup',      ()  => { scrubbing = false; });

    setInterval(() => this._updatePlaybackUI(), 100);

    // Info popover
    const pop = document.getElementById('infoPop');
    const bInfo = document.getElementById('bInfo');
    bInfo.addEventListener('click', e => {
      e.stopPropagation();
      pop.classList.toggle('show');
    });
    document.addEventListener('click', e => {
      if (!pop.contains(e.target) && e.target !== bInfo) pop.classList.remove('show');
    });
  }

  _handleStartClick() {
    if (!this._player.hasMedia) {
      this._openMediaModal();
      return;
    }

    const btn = document.getElementById('bStart');
    if (this._gameActive && !this._pendingNew) {
      this._pendingNew = true;
      btn.innerHTML = this._iconPlay() + ' Confirm?';
      btn.classList.remove('tk-btn--primary');
      btn.classList.add('tk-btn--warning');
      setTimeout(() => {
        if (this._pendingNew) {
          this._pendingNew = false;
          this._updateStartButton();
        }
      }, 3000);
      return;
    }
    this._pendingNew = false;
    this._onStartRequested?.();
  }

  _updateStartButton() {
    const btn = document.getElementById('bStart');
    btn.classList.remove('tk-btn--warning');
    if (this._gameActive) {
      btn.innerHTML = this._iconPlay() + ' New';
      btn.classList.remove('tk-btn--primary');
    } else {
      btn.innerHTML = this._iconPlay() + ' Start';
      btn.classList.toggle('tk-btn--primary', this._player.hasMedia);
    }
  }

  _iconPlay() {
    return `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 3l9 5-9 5V3z"/></svg>`;
  }

  _updatePieceLabel() {
    const idx = parseInt(document.getElementById('iPieces').value);
    const count = window.PIECE_STEPS[Math.max(0, Math.min(window.PIECE_STEPS.length - 1, idx))];
    document.getElementById('pc-lbl').textContent = count;
  }

  /* ── BG Swatches ── */

  _initBgSwatches() {
    const btn      = document.getElementById('bgBtn');
    const pop      = document.getElementById('bgPop');
    const trigger  = document.getElementById('bgSwatch');
    const custom   = document.getElementById('bgCustom');
    const swatches = document.querySelectorAll('.bg-sw');

    const apply = (color) => {
      trigger.style.background = color;
      custom.value = color;
      swatches.forEach(s => s.classList.toggle('on', s.dataset.bg === color));
      this._onBgChange?.(color);
    };

    btn.addEventListener('click', e => {
      e.stopPropagation();
      pop.classList.toggle('show');
    });
    document.addEventListener('click', e => {
      if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        pop.classList.remove('show');
      }
    });

    swatches.forEach(s => {
      s.addEventListener('click', () => apply(s.dataset.bg));
    });
    swatches[0]?.classList.add('on');

    custom.addEventListener('input', () => apply(custom.value));
  }

  /* ── Playback UI ── */

  _updatePlaybackUI() {
    const vid = this._player.getVideoEl();
    if (!vid || !vid.duration) return;

    const pct = vid.currentTime / vid.duration;
    const fill  = document.getElementById('pb-fill');
    const thumb = document.getElementById('pb-thumb');
    const pctStr = (pct * 100).toFixed(2) + '%';
    if (fill)  fill.style.width = pctStr;
    if (thumb) thumb.style.left = pctStr;

    document.getElementById('pb-time').textContent = this._fmtTime(vid.currentTime);
    document.getElementById('pb-dur').textContent  = this._fmtTime(vid.duration);

    const isPlaying = !vid.paused && !vid.ended;
    const icoPlay  = document.getElementById('ico-play');
    const icoPause = document.getElementById('ico-pause');
    if (icoPlay)  icoPlay.style.display  = isPlaying ? 'none' : '';
    if (icoPause) icoPause.style.display = isPlaying ? '' : 'none';
  }

  _updateVolIcon(v) {
    const waves = document.getElementById('vol-waves');
    if (waves) waves.style.opacity = v > 0 ? '1' : '0';
  }

  _fmtTime(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }

  /* ── Media modal ── */

  _openMediaModal() {
    document.getElementById('mOv').classList.add('show');
    // Show warning if a game is active
    document.getElementById('warnBanner').classList.toggle('show', this._gameActive);
  }

  _closeMediaModal() {
    document.getElementById('mOv').classList.remove('show');
  }

  _bindModal() {
    const ov = document.getElementById('mOv');
    document.getElementById('bModalClose').addEventListener('click', () => this._closeMediaModal());
    document.getElementById('bCancel').addEventListener('click',     () => this._closeMediaModal());
    ov.addEventListener('click', e => { if (e.target === ov) this._closeMediaModal(); });

    // Esc to close
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && ov.classList.contains('show')) this._closeMediaModal();
    });

    // Drop zone
    const dz = document.getElementById('dz');
    const fi = document.getElementById('fi');
    dz.addEventListener('click', () => fi.click());
    fi.addEventListener('change', e => {
      [...e.target.files].forEach(f => this._player.addFile(f));
      fi.value = '';
    });
    dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('dgo'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dgo'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('dgo');
      [...e.dataTransfer.files].forEach(f => this._player.addFile(f));
    });

    // Footer actions
    document.getElementById('bClear').addEventListener('click', () => {
      this._player.clearAll();
    });

    document.getElementById('bDone').addEventListener('click', () => {
      this._closeMediaModal();
      // If game is not active and we have media, also kick off a start prompt — handled by ready state.
    });
  }

  _renderQueueUI() {
    const list = document.getElementById('mqList');
    const ctr  = document.getElementById('qctr');
    if (!list) return;

    const q = this._player.getQueue();
    ctr.textContent = `${q.length} item${q.length !== 1 ? 's' : ''}`;
    list.innerHTML  = '';

    q.forEach((item, i) => {
      const d = document.createElement('div'); d.className = 'mi';
      d.innerHTML = `
        <span class="tk-badge tk-badge--square">${item.kind}</span>
        <span class="minm" title="${item.name}">${item.name}</span>
        <span class="midl" data-i="${i}" title="Remove">✕</span>
      `;
      d.querySelector('.midl').addEventListener('click', () => {
        this._player.removeAt(i);
      });
      list.appendChild(d);
    });

    // Enable/disable Done & Clear buttons based on queue state
    document.getElementById('bDone').disabled  = q.length === 0;
    document.getElementById('bClear').disabled = q.length === 0;
  }

  /* ── Landing (empty-state) drag/drop ── */

  _bindLanding() {
    const empty = document.getElementById('empty');
    const panel = empty.querySelector('.panel');
    const fi    = document.getElementById('fi');

    panel.addEventListener('click', () => fi.click());

    // Allow drop directly on the empty-state landing
    empty.addEventListener('dragover', e => { e.preventDefault(); empty.classList.add('dragover'); });
    empty.addEventListener('dragleave', e => {
      // Only clear if leaving the empty container
      if (e.target === empty) empty.classList.remove('dragover');
    });
    empty.addEventListener('drop', e => {
      e.preventDefault();
      empty.classList.remove('dragover');
      [...e.dataTransfer.files].forEach(f => this._player.addFile(f));
    });

    // Empty-state "Browse" button
    document.getElementById('bEmptyBrowse')?.addEventListener('click', () => fi.click());

    // Ready-state Start button
    document.getElementById('bReadyStart').addEventListener('click', () => {
      this._onStartRequested?.();
    });
    // Ready-state "Manage Media" link
    document.getElementById('bReadyMedia').addEventListener('click', () => {
      this._openMediaModal();
    });
  }

  /* ── Win screen ── */

  _bindWin() {
    document.getElementById('bWinNew').addEventListener('click', () => {
      document.getElementById('win').classList.remove('show');
      this._openMediaModal();
    });
    document.getElementById('bWinDismiss').addEventListener('click', () => {
      document.getElementById('win').classList.remove('show');
    });
  }

  showWin(elapsedSec) {
    const m = Math.floor(elapsedSec / 60), s = elapsedSec % 60;
    document.getElementById('wtime').textContent = `Completed in ${m}m ${s}s`;
  }

  showWinScreen() {
    document.getElementById('win').classList.add('show');
  }

  hideWinScreen() {
    document.getElementById('win').classList.remove('show');
  }

  /* ── Progress ── */

  setProgress({ done, total, pct }) {
    document.getElementById('plbl').textContent = Math.round(pct * 100) + '%';
  }

  /* ── Snap flash ── */

  flashSnap() {
    const d = document.createElement('div'); d.className = 'sf';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 400);
  }
}
