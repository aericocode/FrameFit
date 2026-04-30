'use strict';

/**
 * media.js — MediaPlayer
 *
 * Responsibilities:
 *  - Manage a queue of video/image/gif sources
 *  - Expose a live HTMLVideoElement or HTMLImageElement as the draw source
 *  - Fire onReady(width, height) when a new source is loaded and drawable
 *  - NO requestAnimationFrame loop — the renderer owns the loop and pulls
 *    from getSource() each frame
 *
 * Why no rAF here: having two rAF loops (player + renderer) caused them to
 * fight each other and tank FPS. The renderer calls getSource() on its own
 * tick and drawImage from the live element — browsers handle video texture
 * upload efficiently this way.
 */
class MediaPlayer {
  constructor() {
    this._queue   = [];
    this._idx     = 0;
    this._type    = null;   // 'video' | 'image'
    this._onReady = null;   // cb(width, height)
    this._queueListeners = [];

    this._vid = document.createElement('video');
    this._vid.crossOrigin  = 'anonymous';
    this._vid.playsInline  = true;
    this._vid.loop         = false;
    this._vid.volume       = 0.7;
    this._vid.style.display = 'none';
    document.body.appendChild(this._vid);

    this._img = document.createElement('img');
    this._img.crossOrigin  = 'anonymous';
    this._img.style.display = 'none';
    document.body.appendChild(this._img);

    this._vid.addEventListener('ended', () => this._advance());
    this._vid.addEventListener('error', () => {
      console.warn('MediaPlayer: video error, skipping');
      this._advance();
    });
  }

  /* ── Public API ── */

  onReady(cb) { this._onReady = cb; }
  onQueueChange(cb) { this._queueListeners.push(cb); }

  getSource() {
    if (!this._queue.length) return null;
    return this._type === 'video' ? this._vid : this._img;
  }

  get width() {
    return this._type === 'video'
      ? this._vid.videoWidth
      : (this._img.naturalWidth || 0);
  }

  get height() {
    return this._type === 'video'
      ? this._vid.videoHeight
      : (this._img.naturalHeight || 0);
  }

  get hasMedia() { return this._queue.length > 0; }
  get currentIndex() { return this._idx; }
  get queueLength()  { return this._queue.length; }

  setVolume(v) { this._vid.volume = Math.max(0, Math.min(1, v)); }

  togglePlay() {
    if (!this._vid.src) return;
    this._vid.paused ? this._vid.play().catch(()=>{}) : this._vid.pause();
  }

  seekTo(pct) {
    if (!this._vid.duration) return;
    this._vid.currentTime = pct * this._vid.duration;
  }

  seek(delta) {
    if (!this._vid.duration) return;
    this._vid.currentTime = Math.max(0, Math.min(this._vid.duration, this._vid.currentTime + delta));
  }

  setSpeed(rate) { this._vid.playbackRate = Math.max(0.1, Math.min(4, rate)); }

  getVideoEl() { return this._type === 'video' ? this._vid : null; }

  addFile(file) {
    const src  = URL.createObjectURL(file);
    const kind = this._kindFromFile(file);
    this._queue.push({ src, kind, name: file.name });
    this._notifyQueue();
  }

  removeAt(i) {
    if (this._queue[i]?.src.startsWith('blob:')) {
      URL.revokeObjectURL(this._queue[i].src);
    }
    this._queue.splice(i, 1);
    if (this._idx >= this._queue.length) {
      this._idx = Math.max(0, this._queue.length - 1);
    }
    this._notifyQueue();
  }

  clearAll() {
    this._queue.forEach(q => { if (q.src.startsWith('blob:')) URL.revokeObjectURL(q.src); });
    this._queue = [];
    this._idx   = 0;
    this._vid.pause(); this._vid.src = '';
    this._img.src = '';
    this._type = null;
    this._notifyQueue();
  }

  start() { this._loadCurrent(); }

  next() { this._goTo(this._idx + 1); }
  prev() { this._goTo(this._idx - 1); }

  getQueue() { return this._queue; }

  /* ── Private ── */

  _notifyQueue() {
    this._updateCounterUI();
    this._queueListeners.forEach(cb => cb(this._queue));
  }

  _advance() {
    this._idx = (this._idx + 1) % Math.max(this._queue.length, 1);
    this._loadCurrent();
  }

  _goTo(i) {
    const len = Math.max(this._queue.length, 1);
    this._idx = ((i % len) + len) % len;
    this._loadCurrent();
  }

  _loadCurrent() {
    if (!this._queue.length) return;
    const item = this._queue[this._idx];
    this._updateCounterUI();

    if (item.kind === 'video') {
      this._type = 'video';
      this._img.src = '';
      this._vid.src = item.src;
      this._vid.load();
      this._vid.play().catch(() => {});

      const onLoaded = () => {
        this._vid.removeEventListener('loadeddata', onLoaded);
        this._onReady?.(this._vid.videoWidth, this._vid.videoHeight);
      };
      this._vid.addEventListener('loadeddata', onLoaded);

    } else {
      this._type = 'image';
      this._vid.pause(); this._vid.src = '';

      if (this._img.src === item.src && this._img.complete && this._img.naturalWidth > 0) {
        this._onReady?.(this._img.naturalWidth, this._img.naturalHeight);
        return;
      }

      this._img.onload = () => {
        this._onReady?.(this._img.naturalWidth, this._img.naturalHeight);
      };
      this._img.onerror = () => {
        console.warn('MediaPlayer: image load error', item.src);
        this._advance();
      };
      this._img.src = item.src;
    }
  }

  _kindFromFile(f) {
    return (f.type.startsWith('video/') || /\.(mp4|webm|ogg|mov)$/i.test(f.name))
      ? 'video' : 'image';
  }

  _updateCounterUI() {
    const el = document.getElementById('mctr');
    if (el) {
      el.textContent = this._queue.length
        ? `${this._idx + 1}/${this._queue.length}`
        : '—';
    }
  }
}
