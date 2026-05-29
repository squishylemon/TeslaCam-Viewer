/**
 * Warm HTTP cache for clip video files before the user opens the player.
 */

const CAM_ORDER = ['front', 'left', 'right', 'back'] as const;

const prefetchedClips = new Set<string>();
const inflightUrls = new Set<string>();
const warmVideos: HTMLVideoElement[] = [];

function activeVehicleId(): string {
  return document.documentElement.dataset.vehicleId?.trim() ?? '';
}

function eventsApiUrl(): string {
  const vehicle = activeVehicleId();
  return vehicle
    ? `/api/events.json?light=1&vehicle=${encodeURIComponent(vehicle)}`
    : '/api/events.json?light=1';
}

export function videoApiUrl(
  type: string,
  event: string,
  file: string,
): string {
  const base = `/api/video?type=${encodeURIComponent(type)}&event=${encodeURIComponent(
    event,
  )}&file=${encodeURIComponent(file)}`;
  const vehicle = activeVehicleId();
  return vehicle ? `${base}&vehicle=${encodeURIComponent(vehicle)}` : base;
}

/** URLs for all cameras in the first segment group. */
export function firstSegmentUrls(
  type: string,
  event: string,
  cams: Partial<Record<string, string>>,
): string[] {
  return CAM_ORDER.map((c) => cams[c])
    .filter((f): f is string => Boolean(f))
    .map((f) => videoApiUrl(type, event, f));
}

export interface PrefetchFirstSegmentOptions {
  /** Warm hidden <video> elements (off for bulk background prefetch). */
  warm?: boolean;
  /** Probe and cache segment duration in sessionStorage. */
  cacheDuration?: boolean;
}

/** Prefetch the first segment (all cameras) for a clip. Idempotent per clip. */
export function prefetchFirstSegment(
  type: string,
  event: string,
  cams: Partial<Record<string, string>>,
  options: PrefetchFirstSegmentOptions = {},
): void {
  const { warm = true, cacheDuration = true } = options;
  const key = `${type}/${event}`;
  if (prefetchedClips.has(key)) return;
  const urls = firstSegmentUrls(type, event, cams);
  if (urls.length === 0) return;
  prefetchedClips.add(key);
  for (const url of urls) {
    prefetchVideo(url);
    if (warm) warmVideoElement(url);
  }
  if (cacheDuration && urls[0]) {
    cacheFirstSegmentDuration(type, event, urls[0]);
  }
}

/** Hidden <video> warm-up so the player page reuses the same buffered data. */
function warmVideoElement(url: string): void {
  if (inflightUrls.has(`v:${url}`)) return;
  inflightUrls.add(`v:${url}`);
  const v = warmVideos.pop() ?? document.createElement('video');
  v.preload = 'auto';
  v.muted = true;
  const release = () => {
    v.removeAttribute('src');
    v.load();
    if (warmVideos.length < 6) warmVideos.push(v);
    inflightUrls.delete(`v:${url}`);
  };
  v.addEventListener('loadeddata', release, { once: true });
  v.addEventListener('error', release, { once: true });
  v.src = url;
}

/** Store first-segment duration so the player can skip an initial probe. */
function cacheFirstSegmentDuration(
  type: string,
  event: string,
  url: string,
): void {
  const key = `tc-dur:${type}/${event}`;
  if (sessionStorage.getItem(key)) return;
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.muted = true;
  const done = () => {
    if (v.duration > 0 && Number.isFinite(v.duration)) {
      sessionStorage.setItem(key, String(v.duration));
    }
    v.removeAttribute('src');
    v.load();
  };
  v.addEventListener('loadedmetadata', done, { once: true });
  v.addEventListener('error', done, { once: true });
  v.src = url;
}

export function cachedFirstSegmentDuration(
  type: string,
  event: string,
): number | null {
  const raw = sessionStorage.getItem(`tc-dur:${type}/${event}`);
  if (!raw) return null;
  const d = Number.parseFloat(raw);
  return d > 0 && Number.isFinite(d) ? d : null;
}

/** Fetch the first ~1 MiB of a video so Range requests hit cache on the player page. */
function prefetchVideo(url: string): void {
  if (inflightUrls.has(url)) return;
  inflightUrls.add(url);
  fetch(url, {
    headers: { Range: 'bytes=0-1048575' },
    credentials: 'same-origin',
  })
    .catch(() => {})
    .finally(() => inflightUrls.delete(url));
}

interface CatalogClip {
  type: string;
  id: string;
  cams: Partial<Record<string, string>>;
}

const HOME_PREFETCH_KEY = 'tc-home-prefetched';
let backgroundPrefetchStarted = false;

/** After the player is ready, warm the homepage and remaining clips in the background. */
export function schedulePostLoadPrefetch(
  currentType: string,
  currentId: string,
): void {
  if (backgroundPrefetchStarted) return;
  backgroundPrefetchStarted = true;

  const run = () => {
    prefetchHomepage();
    void prefetchCatalogClips(currentType, currentId);
  };

  if ('requestIdleCallback' in window) {
    requestIdleCallback(run, { timeout: 4000 });
  } else {
    window.setTimeout(run, 2000);
  }
}

function prefetchHomepage(): void {
  if (sessionStorage.getItem(HOME_PREFETCH_KEY)) return;
  sessionStorage.setItem(HOME_PREFETCH_KEY, '1');
  warmHomepage({ includeHtml: true });
}

let homepageWarmStarted = false;

/**
 * Prime TeslaCam catalog cache and optionally prefetch the homepage HTML.
 * Call from Settings so "All clips" reuses a warm server scan.
 */
export function warmHomepage(opts: { includeHtml?: boolean; force?: boolean } = {}): void {
  const { includeHtml = true, force = false } = opts;
  if (!force && homepageWarmStarted && !includeHtml) return;
  if (!force) homepageWarmStarted = true;

  void fetch(eventsApiUrl(), {
    credentials: 'same-origin',
    priority: 'low',
  }).catch(() => {});

  if (!includeHtml) return;

  if (!document.querySelector('link[rel="prefetch"][href="/"]')) {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = '/';
    document.head.appendChild(link);
  }

  void fetch('/', { credentials: 'same-origin', priority: 'low' }).catch(() => {});
}

/** Idle warm when viewing Settings (catalog + homepage). */
export function scheduleWarmHomepage(): void {
  const run = () => warmHomepage({ includeHtml: true, force: true });

  if ('requestIdleCallback' in window) {
    requestIdleCallback(run, { timeout: 1200 });
  } else {
    window.setTimeout(run, 250);
  }
}

async function prefetchCatalogClips(
  currentType: string,
  currentId: string,
): Promise<void> {
  let clips: CatalogClip[] = [];
  try {
    const res = await fetch(eventsApiUrl(), {
      credentials: 'same-origin',
    });
    if (!res.ok) return;
    const data = (await res.json()) as { events?: CatalogClip[] };
    clips = data.events ?? [];
  } catch {
    return;
  }

  const currentKey = `${currentType}/${currentId}`;
  const queue = clips.filter((c) => {
    const key = `${c.type}/${c.id}`;
    return key !== currentKey && Object.keys(c.cams ?? {}).length > 0;
  });

  const CLIPS_PER_BATCH = 2;
  const BATCH_PAUSE_MS = 80;

  for (let i = 0; i < queue.length; i += CLIPS_PER_BATCH) {
    if (document.hidden) {
      await waitUntilVisible();
    }
    const batch = queue.slice(i, i + CLIPS_PER_BATCH);
    for (const clip of batch) {
      prefetchFirstSegment(clip.type, clip.id, clip.cams, {
        warm: false,
        cacheDuration: false,
      });
    }
    if (i + CLIPS_PER_BATCH < queue.length) {
      await pause(BATCH_PAUSE_MS);
    }
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function waitUntilVisible(): Promise<void> {
  if (!document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    const onVisible = () => {
      if (!document.hidden) {
        document.removeEventListener('visibilitychange', onVisible);
        resolve();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
  });
}
