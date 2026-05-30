import { ClipStreamCoordinator } from './clip-stream';
import { cachedFirstSegmentDuration, videoApiUrl } from './prefetch';
import { getStreamTier, waitVideoPlayable } from './stream-cache';

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
  const overlayText = document.getElementById('overlay-text')!;
  const overlayProgressBar = document.getElementById('overlay-progress-bar')!;

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

  const stream = ClipStreamCoordinator.groupsFromPlayer(data.type, data.id, groups);

  let segmentEndHandled = false;
  let segmentSwitchToken = 0;

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

  function setLoading(active: boolean): void {
    root.dataset.loading = active ? 'true' : 'false';
  }

  function setOverlayMessage(message: string, pct?: number): void {
    overlayText.textContent = message;
    if (pct != null) overlayProgressBar.style.width = `${pct}%`;
  }

  interface ClipFileEntry {
    file: string;
    url: string;
    groupIndex: number;
  }

  function listAllClipFiles(): ClipFileEntry[] {
    const out: ClipFileEntry[] = [];
    groups.forEach((g, groupIndex) => {
      for (const c of CAM_ORDER) {
        const file = g.files[c];
        if (file) out.push({ file, url: videoUrl(file), groupIndex });
      }
    });
    return out;
  }

  function probeDuration(url: string): Promise<number> {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      const done = (d: number) => {
        v.removeAttribute('src');
        v.load();
        resolve(d);
      };
      v.addEventListener(
        'loadedmetadata',
        () => {
          const d =
            v.duration > 0 && Number.isFinite(v.duration) ? v.duration : 0;
          done(d);
        },
        { once: true },
      );
      v.addEventListener('error', () => done(0), { once: true });
      v.src = url;
    });
  }

  function applyDurationsFromMap(durations: Map<string, number>): void {
    for (let i = 0; i < groups.length; i++) {
      const clock = clockCam(i);
      const clockFile = clock ? groups[i].files[clock] : undefined;
      const fromClock = clockFile ? durations.get(clockFile) : undefined;
      if (fromClock && fromClock > 0) {
        groups[i].duration = fromClock;
        continue;
      }
      for (const c of availableCams(i)) {
        const f = groups[i].files[c];
        const d = f ? durations.get(f) : undefined;
        if (d && d > 0) {
          groups[i].duration = d;
          break;
        }
      }
    }
    recomputeOffsets();
    timeTotal.textContent = fmt(total);
    computeEventOffset();
    renderMarkers();
  }

  async function probeTimelineDurations(): Promise<void> {
    const entries = listAllClipFiles();
    const durations = new Map<string, number>();
    const tasks = entries.map((entry) => async () => {
      const d = await probeDuration(entry.url);
      if (d > 0) durations.set(entry.file, d);
    });
    await runPool(tasks, 6);
    applyDurationsFromMap(durations);
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

  function isGroupDecoded(i: number): boolean {
    const cams = availableCams(i);
    if (cams.length === 0) return true;
    return cams.every((c) => videos[c].readyState >= HTMLMediaElement.HAVE_FUTURE_DATA);
  }

  async function waitForGroupVideos(groupIndex: number, timeoutMs = 4_000): Promise<void> {
    const cams = availableCams(groupIndex);
    await Promise.all(
      cams.map((c) => {
        const file = groups[groupIndex].files[c]!;
        const url = videoUrl(file);
        return waitVideoPlayable(videos[c], url, timeoutMs);
      }),
    );
  }

  function bufferLabelForSegment(index: number): string {
    const urls = stream.urlsForSegment(index);
    const tier = urls[0] ? getStreamTier(urls[0]) : 'idle';
    if (tier === 'full' || tier === 'stretch') return 'Buffering HD…';
    if (tier === 'fast') return 'Buffering…';
    return 'Loading segment…';
  }

  // --- Group loading ------------------------------------------------------
  function loadGroup(i: number, localTime = 0, resumePlaying = playing): void {
    currentIndex = clamp(i, 0, groups.length - 1);
    segmentEndHandled = false;
    const g = groups[currentIndex];
    let srcChanged = false;

    for (const c of CAM_ORDER) {
      const file = g.files[c];
      const v = videos[c];
      if (file) {
        wraps[c].classList.remove('empty');
        const src = videoUrl(file);
        v.preload = 'auto';
        if (loadedFile[c] !== file || v.src !== src) {
          v.src = src;
          loadedFile[c] = file;
          srcChanged = true;
        }
        v.playbackRate = rate;
        v.muted = muted;
      } else {
        wraps[c].classList.add('empty');
        if (loadedFile[c]) {
          v.removeAttribute('src');
          v.load();
          loadedFile[c] = undefined;
          srcChanged = true;
        }
      }
    }

    pendingSeekLocal = localTime;

    const startPlayback = () => {
      applyPendingSeek();
      if (resumePlaying) playAll();
    };

    applyPendingSeek();
    if (resumePlaying && isGroupDecoded(currentIndex)) startPlayback();
  }

  async function switchToGroup(
    i: number,
    localTime: number,
    resumePlaying: boolean,
  ): Promise<void> {
    const token = ++segmentSwitchToken;
    const needsNetwork = i !== currentIndex;

    if (needsNetwork) {
      setLoading(true);
      setOverlayMessage(bufferLabelForSegment(i), 15);
      await stream.focusSegment(i);
      if (token !== segmentSwitchToken) return;
    }

    loadGroup(i, localTime, false);
    await waitForGroupVideos(i, needsNetwork ? 6_000 : 2_000);
    if (token !== segmentSwitchToken) return;

    if (needsNetwork) setLoading(false);
    if (resumePlaying) playAll();
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
      void switchToGroup(i, local, resume);
    } else {
      pendingSeekLocal = local;
      applyPendingSeek();
      if (resume) playAll();
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
      void switchToGroup(currentIndex + 1, 0, playing);
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
  const cachedDur = cachedFirstSegmentDuration(data.type, data.id);
  if (cachedDur) groups[0].duration = cachedDur;
  recomputeOffsets();
  timeTotal.textContent = fmt(total);
  applyRate();
  computeEventOffset();
  renderMarkers();
  setLoading(true);
  setOverlayMessage('Starting playback…', 8);

  void (async () => {
    await stream.primeFirstSegment();
    setOverlayMessage('Starting playback…', 35);
    loadGroup(0, 0, false);
    await waitForGroupVideos(0, 3_500);
    setLoading(false);
    startAutoplay();
    requestAnimationFrame(frame);

    void stream.primeAllFast();
    void probeTimelineDurations();
    stream.startBackgroundPipeline();
  })();

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
