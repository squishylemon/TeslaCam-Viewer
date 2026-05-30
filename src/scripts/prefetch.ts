/**
 * Warm HTTP cache for clip video files before the user opens the player.
 *
 * Homepage hover  → first segment only (instant open).
 * Click / viewer  → remaining segments for that clip in the background.
 */

const CAM_ORDER = ['front', 'left', 'right', 'back'] as const;

const prefetchedFirstSegment = new Set<string>();
const prefetchedClipBodies = new Set<string>();
const inflightUrls = new Set<string>();
const warmVideos: HTMLVideoElement[] = [];

/** Per-segment camera files (matches TeslaEvent groups). */
export interface SegmentCams {
  cams: Partial<Record<string, string>>;
}

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

function clipKey(type: string, event: string): string {
  return `${type}/${event}`;
}

/** URLs for all cameras in one segment group. */
export function segmentUrls(
  type: string,
  event: string,
  cams: Partial<Record<string, string>>,
): string[] {
  return CAM_ORDER.map((c) => cams[c])
    .filter((f): f is string => Boolean(f))
    .map((f) => videoApiUrl(type, event, f));
}

/** URLs for all cameras in the first segment group. */
export function firstSegmentUrls(
  type: string,
  event: string,
  cams: Partial<Record<string, string>>,
): string[] {
  return segmentUrls(type, event, cams);
}

export interface PrefetchFirstSegmentOptions {
  /** Warm hidden <video> elements (homepage hover). */
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
  const key = clipKey(type, event);
  if (prefetchedFirstSegment.has(key)) return;
  const urls = firstSegmentUrls(type, event, cams);
  if (urls.length === 0) return;
  prefetchedFirstSegment.add(key);
  for (const url of urls) {
    prefetchVideo(url, 1024 * 1024);
    if (warm) warmVideoElement(url);
  }
  if (cacheDuration && urls[0]) {
    cacheFirstSegmentDuration(type, event, urls[0]);
  }
}

/** Collect video URLs for segment groups [fromIndex .. end). */
export function urlsForSegmentGroups(
  type: string,
  event: string,
  groups: SegmentCams[],
  fromIndex = 0,
): string[] {
  const urls: string[] = [];
  for (let i = fromIndex; i < groups.length; i++) {
    urls.push(...segmentUrls(type, event, groups[i].cams));
  }
  return urls;
}

export interface PrefetchRemainingOptions {
  /** First segment index to prefetch (default 1 = skip segment already warmed on hover). */
  fromIndex?: number;
  /** Parallel Range fetches (default 6). */
  concurrency?: number;
  /** Bytes per file to pull into cache (default 2 MiB). */
  bytes?: number;
}

/**
 * Prefetch video bytes for later segments of the clip currently being viewed.
 * Safe to call from homepage click (mousedown) and from the player on load.
 */
export function prefetchRemainingSegments(
  type: string,
  event: string,
  groups: SegmentCams[],
  options: PrefetchRemainingOptions = {},
): void {
  const fromIndex = options.fromIndex ?? 1;
  if (fromIndex >= groups.length) return;

  const bodyKey = `${clipKey(type, event)}:body`;
  if (prefetchedClipBodies.has(bodyKey)) return;

  const urls = urlsForSegmentGroups(type, event, groups, fromIndex);
  if (urls.length === 0) return;

  prefetchedClipBodies.add(bodyKey);
  const concurrency = options.concurrency ?? 6;
  const bytes = options.bytes ?? 2 * 1024 * 1024;
  void runPrefetchPool(urls, concurrency, bytes);
}

/** Start loading all non-first segments as soon as the player opens. */
export function scheduleCurrentClipPrefetch(
  type: string,
  event: string,
  groups: SegmentCams[],
): void {
  if (groups.length <= 1) return;
  prefetchRemainingSegments(type, event, groups, {
    fromIndex: 1,
    concurrency: 8,
    bytes: 2 * 1024 * 1024,
  });
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
    if (warmVideos.length < 8) warmVideos.push(v);
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

/** Fetch the first N bytes of a video so Range requests hit cache on the player page. */
function prefetchVideo(url: string, bytes = 1024 * 1024): void {
  if (inflightUrls.has(url)) return;
  inflightUrls.add(url);
  fetch(url, {
    headers: { Range: `bytes=0-${bytes - 1}` },
    credentials: 'same-origin',
  })
    .catch(() => {})
    .finally(() => inflightUrls.delete(url));
}

async function runPrefetchPool(
  urls: string[],
  concurrency: number,
  bytes: number,
): Promise<void> {
  let idx = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, urls.length) },
    async () => {
      while (idx < urls.length) {
        if (document.hidden) {
          await waitUntilVisible();
        }
        const url = urls[idx++];
        prefetchVideo(url, bytes);
        await pause(16);
      }
    },
  );
  await Promise.all(workers);
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
