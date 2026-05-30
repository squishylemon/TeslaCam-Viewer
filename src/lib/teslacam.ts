import fs from 'node:fs';
import path from 'node:path';
import { clipRootForVehicle } from './libraries/resolve';
import { effectiveTeslacamDir } from './site-config';
import { vehicleClipRoot } from './vehicles';

/** The two clip categories we care about (RecentClips is ignored). */
export const CLIP_TYPES = ['SavedClips', 'SentryClips'] as const;
export type ClipType = (typeof CLIP_TYPES)[number];

/** Logical camera positions exposed to the UI. */
export type Camera = 'front' | 'left' | 'right' | 'back';
export const CAMERAS: Camera[] = ['front', 'left', 'right', 'back'];

/** Map a Tesla file-name camera suffix to a logical camera position. */
const SUFFIX_TO_CAMERA: Record<string, Camera> = {
  front: 'front',
  back: 'back',
  left_repeater: 'left',
  right_repeater: 'right',
};

/** e.g. 2025-12-10_18-55-03 */
const EVENT_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;
/** e.g. 2025-12-10_18-43-48-back.mp4 */
const FILE_RE =
  /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-(front|back|left_repeater|right_repeater)\.mp4$/;

export interface SegmentGroup {
  /** Leading timestamp shared by the cameras in this segment, e.g. 2025-12-10_18-43-48 */
  t: string;
  /** File name per camera (relative to the event folder), when present. */
  cams: Partial<Record<Camera, string>>;
}

export interface TeslaEvent {
  type: ClipType;
  id: string;
  /** ISO-ish timestamp from event.json, else derived from the folder name. */
  timestamp: string;
  /** Raw event.json trigger timestamp (Sentry); '' when unavailable. */
  eventTime: string;
  city: string;
  street: string;
  reason: string;
  /** Camera index that triggered the event (Sentry); '' when unavailable. */
  camera: string;
  /** Estimated location from event.json; '' when unavailable. */
  lat: string;
  lon: string;
  hasThumb: boolean;
  groups: SegmentGroup[];
}

interface EventJson {
  timestamp?: string;
  city?: string;
  street?: string;
  reason?: string;
  camera?: string;
  est_lat?: string;
  est_lon?: string;
}

/** Resolve clip root for a vehicle (empty id = legacy flat library). */
export function teslaCamRoot(vehicleId = ''): string {
  if (vehicleId) {
    const rooted = clipRootForVehicle(vehicleId);
    if (rooted) return rooted;
  }
  return vehicleClipRoot(effectiveTeslacamDir(), vehicleId);
}

/** Clear cached clip listings (after library path or vehicle changes). */
export function clearTeslacamCache(): void {
  cache.clear();
}

function isClipType(value: string): value is ClipType {
  return (CLIP_TYPES as readonly string[]).includes(value);
}

/** Convert a folder name like 2025-12-10_18-55-03 into an ISO string. */
function folderToIso(name: string): string {
  const [date, time] = name.split('_');
  if (!date || !time) return name;
  return `${date}T${time.replace(/-/g, ':')}`;
}

interface CacheEntry {
  events: TeslaEvent[];
  expires: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_MS = 120_000;

function cacheKey(type: ClipType, vehicleId: string): string {
  return `${vehicleId}\0${type}`;
}

/** List all events for a clip type, grouped by segment timestamp, newest first. */
export function listEvents(type: ClipType, vehicleId = ''): TeslaEvent[] {
  const key = cacheKey(type, vehicleId);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.events;

  const dir = path.join(teslaCamRoot(vehicleId), type);
  const events: TeslaEvent[] = [];

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !EVENT_RE.test(entry.name)) continue;
    const eventDir = path.join(dir, entry.name);

    let files: string[] = [];
    try {
      files = fs.readdirSync(eventDir);
    } catch {
      continue;
    }

    const groupMap = new Map<string, SegmentGroup>();
    for (const file of files) {
      const m = FILE_RE.exec(file);
      if (!m) continue;
      const [, t, suffix] = m;
      const camera = SUFFIX_TO_CAMERA[suffix];
      if (!camera) continue;
      let group = groupMap.get(t);
      if (!group) {
        group = { t, cams: {} };
        groupMap.set(t, group);
      }
      group.cams[camera] = file;
    }

    const groups = [...groupMap.values()].sort((a, b) => a.t.localeCompare(b.t));
    if (groups.length === 0) continue;

    const meta = readEventJson(eventDir);
    const hasThumb = fs.existsSync(path.join(eventDir, 'thumb.png'));

    events.push({
      type,
      id: entry.name,
      timestamp: meta.timestamp || folderToIso(entry.name),
      eventTime: meta.timestamp || '',
      city: meta.city || '',
      street: meta.street || '',
      reason: meta.reason || '',
      camera: meta.camera || '',
      lat: meta.est_lat || '',
      lon: meta.est_lon || '',
      hasThumb,
      groups,
    });
  }

  events.sort((a, b) => b.id.localeCompare(a.id));
  cache.set(key, { events, expires: Date.now() + CACHE_MS });
  return events;
}

function readEventJson(eventDir: string): EventJson {
  try {
    const raw = fs.readFileSync(path.join(eventDir, 'event.json'), 'utf8');
    return JSON.parse(raw) as EventJson;
  } catch {
    return {};
  }
}

/** Find a single event by type + id. */
export function getEvent(
  type: ClipType,
  id: string,
  vehicleId = '',
): TeslaEvent | undefined {
  return listEvents(type, vehicleId).find((e) => e.id === id);
}

/**
 * Build a Google Maps URL for the given coordinates, or null when the values
 * are missing/invalid (including the 0,0 "null island" placeholder).
 */
export function mapsUrl(lat: string, lon: string): string | null {
  const la = Number.parseFloat(lat);
  const lo = Number.parseFloat(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la === 0 && lo === 0) return null;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  return `https://www.google.com/maps/search/?api=1&query=${la},${lo}`;
}

/**
 * Safely resolve a file inside an event folder, guarding against traversal.
 * `file` may be a media file (mp4) or "thumb.png". Returns an absolute path
 * known to live inside the validated event directory, or null if invalid.
 */
export function safeResolve(
  type: string,
  event: string,
  file: string,
  vehicleId = '',
): string | null {
  if (!isClipType(type)) return null;
  if (!EVENT_RE.test(event)) return null;
  if (file !== 'thumb.png' && !FILE_RE.test(file)) return null;

  const root = teslaCamRoot(vehicleId);
  const eventDir = path.resolve(path.join(root, type, event));
  const target = path.resolve(path.join(eventDir, file));

  // Ensure the resolved target stays within the event directory.
  const rel = path.relative(eventDir, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (!fs.existsSync(target)) return null;
  return target;
}
