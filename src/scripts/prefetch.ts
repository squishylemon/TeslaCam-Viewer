/**
 * Homepage clip warm-up (first segment) + shared URL helpers.
 */

import {
  primeFast,
  primeMany,
} from './stream-cache';

const CAM_ORDER = ['front', 'left', 'right', 'back'] as const;

const prefetchedFirstSegment = new Set<string>();
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

export function segmentUrls(
  type: string,
  event: string,
  cams: Partial<Record<string, string>>,
): string[] {
  return CAM_ORDER.map((c) => cams[c])
    .filter((f): f is string => Boolean(f))
    .map((f) => videoApiUrl(type, event, f));
}

export function firstSegmentUrls(
  type: string,
  event: string,
  cams: Partial<Record<string, string>>,
): string[] {
  return segmentUrls(type, event, cams);
}

export interface PrefetchFirstSegmentOptions {
  warm?: boolean;
  cacheDuration?: boolean;
}

/**
 * Hover: prime first segment (head + tail ranges in Cache API) for instant open.
 */
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

  void primeMany(urls, urls.length);

  if (warm) {
    for (const url of urls) warmVideoElement(url);
  }
  if (cacheDuration && urls[0]) {
    cacheFirstSegmentDuration(type, event, urls[0]);
  }
}

/** Click: fast-prime every segment (not full files) before navigation. */
export function prefetchClipFast(
  type: string,
  event: string,
  groups: SegmentCams[],
): void {
  const urls: string[] = [];
  for (const g of groups) {
    urls.push(...segmentUrls(type, event, g.cams));
  }
  if (urls.length === 0) return;
  void primeMany(urls, 8);
}

function warmVideoElement(url: string): void {
  const v = warmVideos.pop() ?? document.createElement('video');
  v.preload = 'auto';
  v.muted = true;
  const release = () => {
    if (warmVideos.length < 12) warmVideos.push(v);
  };
  v.addEventListener('loadeddata', release, { once: true });
  v.addEventListener('error', release, { once: true });
  v.src = url;
}

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

let homepageWarmStarted = false;

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

export function scheduleWarmHomepage(): void {
  const run = () => warmHomepage({ includeHtml: true, force: true });

  if ('requestIdleCallback' in window) {
    requestIdleCallback(run, { timeout: 1200 });
  } else {
    window.setTimeout(run, 250);
  }
}
