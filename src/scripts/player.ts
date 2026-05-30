import {
  cachedFirstSegmentDuration,
  schedulePostLoadPrefetch,
  videoApiUrl,
} from './prefetch';

/**
 * TeslaCam synced multi-camera player.
 *
 * Treats an event's per-camera segments as one continuous "virtual timeline".
 * One camera per segment acts as the clock; the other three are kept in sync.
 * Supports play/pause, scrub, skip, prev/next segment, variable speed,
 * hold-to-rewind, mute, fullscreen and keyboard shortcuts.
 */

type CamKey = 'front' | 'left' | 'right' | 'back';
const CAM_ORDER: CamKey[] = ['front', 'left', 'right', 'back'];

interface RawGroup {
  t: string;
  cams: Partial<Record<CamKey, string>>;
}
interface ClipData {
  type: string;
  id: string;
  eventTime?: string;
  groups: RawGroup[];
}
interface Group {
  t: string;
  files: Partial<Record<CamKey, string>>;
  duration: number;
  offset: number;
}

const root = document.getElementById('player');
if (root) init(root);

function init(root: HTMLElement): void {
  const data: ClipData = JSON.parse(root.dataset.clip || '{}');
  if (!data.groups || data.groups.length === 0) return;

  const videoUrl = (file: string): string =>
    videoApiUrl(data.type, data.id, file);

  // --- Elements -----------------------------------------------------------
  const stage = root.querySelector<HTMLElement>('.stage')!;
  const videos: Record<CamKey, HTMLVideoElement> = {
    front: document.getElementById('cam-front') as HTMLVideoElement,
    left: document.getElementById('cam-left') as HTMLVideoElement,
    right: document.getElementById('cam-right') as HTMLVideoElement,
    back: document.getElementById('cam-back') as HTMLVideoElement,
  };
  const wraps: Record<CamKey, HTMLElement> = {
    front: root.querySelector('.cam-front')!,
    left: root.querySelector('.cam-left')!,
    right: root.querySelector('.cam-right')!,
    back: root.querySelector('.cam-back')!,
  };

  const btnPlay = document.getElementById('btn-play')!;
  const btnPrev = document.getElementById('btn-prev')!;
  const btnNext = document.getElementById('btn-next')!;
  const btnBack10 = document.getElementById('btn-back10')!;
  const btnFwd10 = document.getElementById('btn-fwd10')!;
  const btnRewind = document.getElementById('btn-rewind')!;
  const btnMute = document.getElementById('btn-mute')!;
  const btnFs = document.getElementById('btn-fs')!;
  const btnRate = document.getElementById('btn-rate')!;
  const btnEvent = document.getElementById('btn-event')!;

  const track = document.getElementById('track')!;
  const progressEl = document.getElementById('progress')!;
  const bufferedEl = document.getElementById('buffered')!;
  const handleEl = document.getElementById('handle')!;
  const markersEl = document.getElementById('markers')!;
  const timeCurrent = document.getElementById('time-current')!;
  const timeTotal = document.getElementById('time-total')!;

  // --- State --------------------------------------------------------------
  const groups: Group[] = data.groups.map((g) => ({
    t: g.t,
    files: g.cams,
    duration: 60,
    offset: 0,
  }));
  let total = 0;
  let currentIndex = 0;
  let playing = false;
  let scrubbing = false;
  let rewinding = false;
  let muted = true;
  let rate = 1;
  const loadedFile: Partial<Record<CamKey, string>> = {};
  let pendingSeekLocal: number | null = null;
  // Virtual-timeline position (seconds) where the Sentry event was triggered.
  let eventOffset: number | null = null;

  // Pool of off-screen <video> elements used to warm the next group's files
  // (all four cameras) so segment transitions are seamless.
  const preloaders: HTMLVideoElement[] = Array.from({ length: 4 }, () => {
    const v = document.createElement('video');
    v.preload = 'auto';
    v.muted = true;
    return v;
  });
  let preloadedFor = -1;
  let segmentEndHandled = false;

  // --- Helpers ------------------------------------------------------------
  const clamp = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, v));

  function clockCam(i: number): CamKey | null {
    const g = groups[i];
    for (const c of CAM_ORDER) if (g.files[c]) return c;
    return null;
  }
  function clockVideo(i: number): HTMLVideoElement | null {
    const c = clockCam(i);
    return c ? videos[c] : null;
  }

  function availableCams(i: number): CamKey[] {
    return CAM_ORDER.filter((c) => groups[i].files[c]);
  }

  function fmt(sec: number): string {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const s = Math.floor(sec % 60);
    const m = Math.floor((sec / 60) % 60);
    const h = Math.floor(sec / 3600);
    const ss = String(s).padStart(2, '0');
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
    return `${m}:${ss}`;
  }

  /** Parse a Tesla segment timestamp ("2025-12-08_08-34-48") to epoch ms. */
  function parseTeslaTime(t: string): number {
    const m = /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/.exec(t);
    if (!m) return NaN;
    return Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}`);
  }

  /**
   * Map the event/save time onto the virtual timeline. For Sentry clips this
   * is when the event triggered; for Saved clips it is when the user tapped
   * save. Segments are contiguous real-time recordings, so the offset is simply
   * the wall-clock gap from the first segment's start.
   */
  function computeEventOffset(): void {
    if (!data.eventTime) return;
    const start = parseTeslaTime(groups[0].t);
    const trigger = Date.parse(data.eventTime);
    if (!isFinite(start) || !isFinite(trigger)) return;
    const off = (trigger - start) / 1000;
    // Allow a grace window: a Saved clip's tap can land slightly past the end
    // of the buffered footage. Anything within range is clamped onto the bar.
    if (off >= -5 && off <= total + 180) eventOffset = clamp(off, 0, total);
  }

  function globalTime(): number {
    const v = clockVideo(currentIndex);
    const local = v ? v.currentTime : 0;
    return clamp(
      groups[currentIndex].offset + local,
      0,
      total || groups[currentIndex].offset + local,
    );
  }

  // --- Timeline probing ---------------------------------------------------
  function recomputeOffsets(): void {
    let acc = 0;
    for (const g of groups) {
      g.offset = acc;
      acc += g.duration;
    }
    total = acc;
  }

  async function probeGroup(i: number): Promise<void> {
    const g = groups[i];
    const file = CAM_ORDER.map((c) => g.files[c]).find(Boolean);
    if (file) {
      const d = await probeOne(videoUrl(file));
      if (d && isFinite(d) && d > 0) g.duration = d;
    }
  }

  function waitFirstGroupReady(): Promise<void> {
    const cams = availableCams(0);
    if (cams.length === 0) return Promise.resolve();
    return Promise.all(
      cams.map(
        (c) =>
          new Promise<void>((resolve) => {
            const v = videos[c];
            const finish = () => resolve();
            if (v.readyState >= 2) return finish();
            v.addEventListener('loadeddata', finish, { once: true });
            v.addEventListener('error', finish, { once: true });
            window.setTimeout(finish, 8000);
          }),
      ),
    ).then(() => {});
  }

  /** Read segment duration from the on-screen videos (no extra network fetch). */
  function bindDurationFromActiveGroup(i: number): void {
    const cv = clockVideo(i);
    if (!cv) return;
    const apply = () => {
      const d = cv.duration;
      if (d > 0 && Number.isFinite(d)) {
        groups[i].duration = d;
        recomputeOffsets();
        timeTotal.textContent = fmt(total);
        computeEventOffset();
        renderMarkers();
      }
    };
    if (cv.readyState >= 1) apply();
    else cv.addEventListener('loadedmetadata', apply, { once: true });
  }

  /** Muted autoplay once the first segment can render (browser-friendly). */
  function startAutoplay(): void {
    playAll();
    for (const c of availableCams(0)) {
      const v = videos[c];
      if (v.paused) {
        v.addEventListener('canplay', () => v.play().catch(() => {}), {
          once: true,
        });
      }
    }
  }

  /** Probe segments after the first frame is visible; low concurrency avoids starving playback. */
  async function probeTimelineAfterFirstFrame(): Promise<void> {
    await waitFirstGroupReady();
    startAutoplay();
    bindDurationFromActiveGroup(0);

    if (groups.length <= 1) {
      schedulePostLoadPrefetch(data.type, data.id);
      return;
    }

    const tasks = groups.slice(1).map((_, idx) => async () => {
      await probeGroup(idx + 1);
      recomputeOffsets();
      timeTotal.textContent = fmt(total);
      computeEventOffset();
      renderMarkers();
    });
    await runPool(tasks, 2);
    recomputeOffsets();
    timeTotal.textContent = fmt(total);
    computeEventOffset();
    renderMarkers();
    schedulePostLoadPrefetch(data.type, data.id);
  }

  function probeOne(url: string): Promise<number> {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      const cleanup = () => {
        v.removeAttribute('src');
        v.load();
      };
      v.addEventListener(
        'loadedmetadata',
        () => {
          const d = v.duration;
          cleanup();
          resolve(d);
        },
        { once: true },
      );
      v.addEventListener(
        'error',
        () => {
          cleanup();
          resolve(0);
        },
        { once: true },
      );
      v.src = url;
    });
  }

  async function runPool(
    tasks: Array<() => Promise<void>>,
    size: number,
  ): Promise<void> {
    let idx = 0;
    const workers = Array.from({ length: Math.min(size, tasks.length) }, async () => {
      while (idx < tasks.length) {
        const my = idx++;
        await tasks[my]();
      }
    });
    await Promise.all(workers);
  }

  /** Start playback once the active group's videos can decode frames. */
  function playWhenReady(onReady: () => void): void {
    const cams = availableCams(currentIndex);
    if (cams.length === 0) {
      onReady();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      onReady();
    };
    let pending = cams.length;
    const done = () => {
      pending -= 1;
      if (pending <= 0) finish();
    };
    for (const c of cams) {
      const v = videos[c];
      if (v.readyState >= 2) done();
      else {
        v.addEventListener('canplay', done, { once: true });
        v.addEventListener('error', done, { once: true });
      }
    }
    window.setTimeout(finish, 12_000);
  }

  // --- Group loading ------------------------------------------------------
  function loadGroup(i: number, localTime = 0, resumePlaying = playing): void {
    currentIndex = clamp(i, 0, groups.length - 1);
    segmentEndHandled = false;
    const g = groups[currentIndex];

    for (const c of CAM_ORDER) {
      const file = g.files[c];
      const v = videos[c];
      if (file) {
        wraps[c].classList.remove('empty');
        // Eagerly buffer the active group so playback starts quickly.
        v.preload = 'auto';
        if (loadedFile[c] !== file) {
          v.src = videoUrl(file);
          v.load();
          loadedFile[c] = file;
        }
        v.playbackRate = rate;
        v.muted = muted;
      } else {
        wraps[c].classList.add('empty');
        if (loadedFile[c]) {
          v.removeAttribute('src');
          v.load();
          loadedFile[c] = undefined;
        }
      }
    }

    pendingSeekLocal = localTime;
    applyPendingSeek();

    bindDurationFromActiveGroup(currentIndex);

    if (resumePlaying) {
      playWhenReady(() => {
        applyPendingSeek();
        playAll();
      });
    }
  }

  function applyPendingSeek(): void {
    if (pendingSeekLocal == null) return;
    const target = pendingSeekLocal;
    let ready = true;
    for (const c of availableCams(currentIndex)) {
      const v = videos[c];
      if (v.readyState >= 1) {
        try {
          v.currentTime = target;
        } catch {
          ready = false;
        }
      } else {
        ready = false;
        v.addEventListener(
          'loadedmetadata',
          () => {
            try {
              v.currentTime = pendingSeekLocal ?? target;
            } catch {
              /* ignore */
            }
          },
          { once: true },
        );
      }
    }
    if (ready) pendingSeekLocal = null;
  }

  // --- Seeking ------------------------------------------------------------
  function seekGlobal(t: number, opts: { keepPaused?: boolean } = {}): void {
    t = clamp(t, 0, total);
    let i = groups.findIndex(
      (g) => t >= g.offset && t < g.offset + g.duration,
    );
    if (i === -1) i = groups.length - 1;
    const local = clamp(t - groups[i].offset, 0, groups[i].duration);

    const resume = opts.keepPaused ? false : playing;
    if (i !== currentIndex) {
      loadGroup(i, local, resume);
    } else {
      pendingSeekLocal = local;
      applyPendingSeek();
    }
    updateUI();
  }

  // --- Playback -----------------------------------------------------------
  function playAll(): void {
    playing = true;
    root.dataset.playing = 'true';
    for (const c of availableCams(currentIndex)) {
      videos[c].playbackRate = rate;
      videos[c].play().catch(() => {});
    }
  }
  function pauseAll(): void {
    playing = false;
    root.dataset.playing = 'false';
    for (const c of CAM_ORDER) videos[c].pause();
  }
  function togglePlay(): void {
    if (playing) pauseAll();
    else {
      if (globalTime() >= total - 0.25) seekGlobal(0);
      playAll();
    }
  }

  function advanceGroup(): void {
    if (segmentEndHandled) return;
    segmentEndHandled = true;
    if (currentIndex < groups.length - 1) {
      preloadedFor = -1;
      loadGroup(currentIndex + 1, 0, playing);
    } else {
      pauseAll();
    }
  }

  /** Fallback when `ended` does not fire (browser / SMB edge cases). */
  function checkSegmentEnd(): void {
    if (!playing || scrubbing || rewinding || segmentEndHandled) return;
    const cv = clockVideo(currentIndex);
    if (!cv) return;
    const dur = cv.duration;
    if (!dur || !Number.isFinite(dur) || dur <= 0) return;
    if (cv.currentTime < dur - 0.2) return;
    advanceGroup();
  }

  // --- Sync + UI loop -----------------------------------------------------
  function syncDrift(): void {
    if (scrubbing || rewinding) return;
    const cv = clockVideo(currentIndex);
    if (!cv) return;
    const t = cv.currentTime;
    for (const c of availableCams(currentIndex)) {
      const v = videos[c];
      if (v === cv) continue;
      if (Math.abs(v.currentTime - t) > 0.25 && !v.seeking) {
        try {
          v.currentTime = t;
        } catch {
          /* ignore */
        }
      }
      if (playing && v.paused) v.play().catch(() => {});
    }
  }

  function maybePreloadNext(): void {
    const cv = clockVideo(currentIndex);
    if (!cv || !playing) return;
    const dur = groups[currentIndex].duration;
    const remaining = dur - cv.currentTime;
    const next = currentIndex + 1;
    // Warm all four cameras of the next group once we're past the halfway
    // point (or within 8s of the end), so the transition is seamless.
    const trigger = remaining < 8 || cv.currentTime > dur * 0.5;
    if (trigger && next < groups.length && preloadedFor !== next) {
      const files = CAM_ORDER.map((c) => groups[next].files[c]).filter(
        Boolean,
      ) as string[];
      files.forEach((file, idx) => {
        const v = preloaders[idx % preloaders.length];
        v.src = videoUrl(file);
        v.load();
      });
      preloadedFor = next;
    }
  }

  function updateUI(): void {
    const g = globalTime();
    const pct = total > 0 ? (g / total) * 100 : 0;
    progressEl.style.width = `${pct}%`;
    handleEl.style.left = `${pct}%`;
    timeCurrent.textContent = fmt(g);

    const cv = clockVideo(currentIndex);
    if (cv && cv.buffered.length) {
      try {
        const end = cv.buffered.end(cv.buffered.length - 1);
        const bufG = groups[currentIndex].offset + end;
        bufferedEl.style.width = `${total > 0 ? (bufG / total) * 100 : 0}%`;
      } catch {
        /* ignore */
      }
    }
  }

  let lastTs = 0;
  function frame(ts: number): void {
    const dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;

    if (rewinding) {
      const speed = 4 * rate; // rewind multiplier
      let t = globalTime() - speed * dt;
      if (t <= 0) {
        t = 0;
        stopRewind();
      }
      seekGlobal(t, { keepPaused: true });
    } else {
      syncDrift();
      checkSegmentEnd();
      maybePreloadNext();
    }
    updateUI();
    requestAnimationFrame(frame);
  }

  function startRewind(): void {
    if (rewinding) return;
    rewinding = true;
    btnRewind.classList.add('active');
    for (const c of CAM_ORDER) videos[c].pause();
  }
  function stopRewind(): void {
    if (!rewinding) return;
    rewinding = false;
    btnRewind.classList.remove('active');
    if (playing) playAll();
  }

  // --- Event wiring -------------------------------------------------------
  for (const c of CAM_ORDER) {
    videos[c].addEventListener('ended', (e) => {
      if (e.target === clockVideo(currentIndex) && !rewinding) advanceGroup();
    });
    videos[c].addEventListener('timeupdate', () => {
      if (videos[c] === clockVideo(currentIndex)) checkSegmentEnd();
    });
  }

  btnPlay.addEventListener('click', togglePlay);
  btnPrev.addEventListener('click', () => {
    // If we're more than 1.5s into a segment, restart it; else go to previous.
    const into = globalTime() - groups[currentIndex].offset;
    if (into > 1.5 || currentIndex === 0) seekGlobal(groups[currentIndex].offset);
    else seekGlobal(groups[currentIndex - 1].offset);
  });
  btnNext.addEventListener('click', () => {
    if (currentIndex < groups.length - 1)
      seekGlobal(groups[currentIndex + 1].offset);
  });
  btnBack10.addEventListener('click', () => seekGlobal(globalTime() - 10));
  btnFwd10.addEventListener('click', () => seekGlobal(globalTime() + 10));
  btnEvent.addEventListener('click', () => {
    if (eventOffset != null) seekGlobal(eventOffset);
  });

  const rewindDown = (e: Event) => {
    e.preventDefault();
    startRewind();
  };
  btnRewind.addEventListener('mousedown', rewindDown);
  btnRewind.addEventListener('touchstart', rewindDown, { passive: false });
  window.addEventListener('mouseup', stopRewind);
  window.addEventListener('touchend', stopRewind);

  const RATES = [0.25, 0.5, 1, 1.5, 2];
  const applyRate = () => {
    for (const c of CAM_ORDER) videos[c].playbackRate = rate;
    btnRate.textContent = `${rate}×`;
  };
  btnRate.addEventListener('click', () => {
    const idx = RATES.indexOf(rate);
    rate = RATES[(idx + 1) % RATES.length];
    applyRate();
  });

  btnMute.addEventListener('click', () => {
    muted = !muted;
    for (const c of CAM_ORDER) videos[c].muted = muted;
    root.dataset.muted = String(muted);
  });

  btnFs.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else root.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    root.dataset.fullscreen = String(!!document.fullscreenElement);
  });

  // Camera focus toggle: expand a single camera to fill the stage (solo),
  // click again (or the same camera) to return to the grid.
  root.querySelectorAll<HTMLButtonElement>('.cam-focus').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = b.dataset.focusTarget || 'front';
      if (stage.dataset.solo === target) delete stage.dataset.solo;
      else stage.dataset.solo = target;
    });
  });

  // Scrubbing.
  const seekFromPointer = (clientX: number) => {
    const rect = track.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    seekGlobal(ratio * total, { keepPaused: true });
  };
  let wasPlayingBeforeScrub = false;
  track.addEventListener('pointerdown', (e) => {
    scrubbing = true;
    root.dataset.scrubbing = 'true';
    wasPlayingBeforeScrub = playing;
    pauseAll();
    track.setPointerCapture(e.pointerId);
    seekFromPointer(e.clientX);
  });
  track.addEventListener('pointermove', (e) => {
    if (scrubbing) seekFromPointer(e.clientX);
  });
  const endScrub = () => {
    if (!scrubbing) return;
    scrubbing = false;
    root.dataset.scrubbing = 'false';
    if (wasPlayingBeforeScrub) playAll();
  };
  track.addEventListener('pointerup', endScrub);
  track.addEventListener('pointercancel', endScrub);

  // Keyboard shortcuts.
  document.addEventListener('keydown', (e) => {
    if (
      e.target instanceof HTMLElement &&
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)
    )
      return;
    switch (e.key.toLowerCase()) {
      case ' ':
      case 'k':
        e.preventDefault();
        togglePlay();
        break;
      case 'arrowleft':
      case 'j':
        e.preventDefault();
        seekGlobal(globalTime() - 10);
        break;
      case 'arrowright':
      case 'l':
        e.preventDefault();
        seekGlobal(globalTime() + 10);
        break;
      case 'p':
        btnPrev.click();
        break;
      case 'n':
        btnNext.click();
        break;
      case 'm':
        btnMute.dispatchEvent(new Event('click'));
        break;
      case 'f':
        btnFs.dispatchEvent(new Event('click'));
        break;
      case 'e':
        if (eventOffset != null) {
          e.preventDefault();
          seekGlobal(eventOffset);
        }
        break;
    }
  });

  // --- Boot ---------------------------------------------------------------
  // Show the player immediately (prefetch + default segment lengths). Timeline
  // refines in the background with no blocking overlay.
  const cachedDur = cachedFirstSegmentDuration(data.type, data.id);
  if (cachedDur) groups[0].duration = cachedDur;
  recomputeOffsets();
  timeTotal.textContent = fmt(total);
  loadGroup(0, 0, false);
  applyRate();
  computeEventOffset();
  renderMarkers();
  requestAnimationFrame(frame);
  void probeTimelineAfterFirstFrame();

  function renderMarkers(): void {
    delete track.dataset.hasEvent;
    track.style.removeProperty('--event-pct');
    if (total <= 0) return;
    markersEl.innerHTML = '';
    for (let i = 1; i < groups.length; i++) {
      const m = document.createElement('div');
      m.className = 'mark';
      m.style.left = `${(groups[i].offset / total) * 100}%`;
      markersEl.appendChild(m);
    }
    if (eventOffset != null) {
      const isSentry = data.type === 'SentryClips';
      const pct = total > 0 ? (eventOffset / total) * 100 : 0;
      track.dataset.hasEvent = 'true';
      track.style.setProperty('--event-pct', `${pct}%`);

      const labelEl = btnEvent.querySelector('.event-label');
      if (labelEl) labelEl.textContent = isSentry ? 'Event' : 'Save';
      btnEvent.title = `Skip to ${isSentry ? 'event' : 'save'} (E)`;
      btnEvent.hidden = false;
    }
  }
}
