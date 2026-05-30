/**
 * Progressive video streaming cache: fast head/tail prime → play → full file in background.
 * Uses the Cache API so homepage hover warms the same bytes the player reads.
 */

const CACHE_NAME = 'tc-stream-v1';

/** First chunk — start playback quickly. */
export const PRIME_HEAD_BYTES = 3 * 1024 * 1024;
/** Many Tesla MP4s have moov at the end — prime the tail for metadata/seek. */
export const PRIME_TAIL_BYTES = 1 * 1024 * 1024;
/** Mid tier before full download. */
export const STRETCH_BYTES = 12 * 1024 * 1024;

export type StreamTier = 'idle' | 'fast' | 'stretch' | 'full';

interface FileStreamState {
  tier: StreamTier;
  fullPromise?: Promise<void>;
}

const fileState = new Map<string, FileStreamState>();
const inflight = new Set<string>();

function stateFor(url: string): FileStreamState {
  let s = fileState.get(url);
  if (!s) {
    s = { tier: 'idle' };
    fileState.set(url, s);
  }
  return s;
}

function tierRank(t: StreamTier): number {
  return { idle: 0, fast: 1, stretch: 2, full: 3 }[t];
}

function setTier(url: string, tier: StreamTier): void {
  const s = stateFor(url);
  if (tierRank(tier) >= tierRank(s.tier)) s.tier = tier;
}

async function cacheOpen(): Promise<Cache> {
  return caches.open(CACHE_NAME);
}

function rangeRequest(url: string, start: number, end: number): Request {
  return new Request(url, {
    headers: { Range: `bytes=${start}-${end}` },
  });
}

function suffixRangeRequest(url: string, suffixBytes: number): Request {
  return new Request(url, {
    headers: { Range: `bytes=-${suffixBytes}` },
  });
}

async function putRange(url: string, start: number, end: number): Promise<boolean> {
  const key = `${url}#${start}-${end}`;
  if (inflight.has(key)) return false;
  inflight.add(key);
  try {
    const cache = await cacheOpen();
    const req = rangeRequest(url, start, end);
    if (await cache.match(req)) return true;
    const res = await fetch(req, { credentials: 'same-origin' });
    if (res.ok || res.status === 206) {
      await cache.put(req, res);
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    inflight.delete(key);
  }
}

async function putSuffix(url: string, suffixBytes: number): Promise<boolean> {
  const key = `${url}#tail-${suffixBytes}`;
  if (inflight.has(key)) return false;
  inflight.add(key);
  try {
    const cache = await cacheOpen();
    const req = suffixRangeRequest(url, suffixBytes);
    if (await cache.match(req)) return true;
    const res = await fetch(req, { credentials: 'same-origin' });
    if (res.ok || res.status === 206) {
      await cache.put(req, res);
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    inflight.delete(key);
  }
}

/** Fast prime: beginning + end of file (instant start on most MP4s). */
export async function primeFast(url: string): Promise<void> {
  const s = stateFor(url);
  if (tierRank(s.tier) >= tierRank('fast')) return;
  await Promise.all([
    putRange(url, 0, PRIME_HEAD_BYTES - 1),
    putSuffix(url, PRIME_TAIL_BYTES),
  ]);
  setTier(url, 'fast');
}

/** Larger buffer before full file. */
export async function primeStretch(url: string): Promise<void> {
  const s = stateFor(url);
  if (tierRank(s.tier) >= tierRank('stretch')) return;
  await primeFast(url);
  await putRange(url, 0, STRETCH_BYTES - 1);
  setTier(url, 'stretch');
}

/** Full file — best seek/stutter-free playback within a segment. */
export function upgradeFull(url: string): Promise<void> {
  const s = stateFor(url);
  if (s.tier === 'full') return s.fullPromise ?? Promise.resolve();
  if (s.fullPromise) return s.fullPromise;

  s.fullPromise = (async () => {
    try {
      const cache = await cacheOpen();
      const req = new Request(url);
      const hit = await cache.match(req);
      if (!hit) {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (res.ok) await cache.put(req, res.clone());
      }
      setTier(url, 'full');
    } catch {
      /* keep partial tier */
    }
  })();

  return s.fullPromise;
}

export function getStreamTier(url: string): StreamTier {
  return stateFor(url).tier;
}

export async function primeMany(urls: string[], concurrency = 6): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (i < urls.length) {
      const url = urls[i++]!;
      await primeFast(url);
    }
  });
  await Promise.all(workers);
}

export async function stretchMany(urls: string[], concurrency = 4): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (i < urls.length) {
      const url = urls[i++]!;
      await primeStretch(url);
    }
  });
  await Promise.all(workers);
}

export function upgradeMany(urls: string[], concurrency = 3): void {
  let i = 0;
  const run = async () => {
    while (i < urls.length) {
      const url = urls[i++]!;
      await upgradeFull(url);
    }
  };
  for (let w = 0; w < Math.min(concurrency, urls.length); w++) void run();
}

/** Wait until a <video> can start from cached ranges (does not require full file). */
export function waitVideoPlayable(
  video: HTMLVideoElement,
  url: string,
  timeoutMs = 5_000,
): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onReady);
      window.clearTimeout(timer);
      resolve();
    };
    const onReady = () => finish();
    const timer = window.setTimeout(finish, timeoutMs);

    if (video.src === url && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      finish();
      return;
    }
    video.addEventListener('loadeddata', onReady, { once: true });
    video.addEventListener('canplay', onReady, { once: true });
    video.addEventListener('error', onReady, { once: true });
  });
}
