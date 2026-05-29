import fs from 'node:fs';
import path from 'node:path';
import { effectiveTeslacamDir } from './site-config';

export const MODEL_CODES = ['MX', 'MS', 'MY', 'M3'] as const;
export type ModelCode = (typeof MODEL_CODES)[number];

export const MODEL_LABELS: Record<ModelCode, string> = {
  MX: 'Model X',
  MS: 'Model S',
  MY: 'Model Y',
  M3: 'Model 3',
};

const CLIP_TYPES = ['SavedClips', 'SentryClips'] as const;
const VEHICLE_FOLDER_RE = /^(MX|MS|MY|M3)_(.+)$/;

export interface Vehicle {
  /** Folder name under the library root, e.g. MX_Family. Empty for legacy flat layout. */
  id: string;
  model: ModelCode | null;
  /** Display name from the folder suffix (after the first underscore). */
  name: string;
  /** Human-readable model name. */
  label: string;
  savedCount: number;
  sentryCount: number;
}

function isModelCode(value: string): value is ModelCode {
  return (MODEL_CODES as readonly string[]).includes(value);
}

function countEventFolders(dir: string): number {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).length;
  } catch {
    return 0;
  }
}

function clipCountsAt(root: string): { savedCount: number; sentryCount: number } {
  return {
    savedCount: countEventFolders(path.join(root, 'SavedClips')),
    sentryCount: countEventFolders(path.join(root, 'SentryClips')),
  };
}

/** True when SavedClips and/or SentryClips live directly under `root`. */
export function isLegacyClipRoot(root: string): boolean {
  const { savedCount, sentryCount } = clipCountsAt(root);
  return savedCount > 0 || sentryCount > 0;
}

/** Directory that contains SavedClips / SentryClips for a vehicle (or legacy root). */
export function vehicleClipRoot(libraryRoot: string, vehicleId: string): string {
  if (!vehicleId) return libraryRoot;
  return path.join(libraryRoot, vehicleId);
}

function vehicleFromFolder(
  folderName: string,
  model: ModelCode,
  displayName: string,
  clipRoot: string,
): Vehicle | null {
  const { savedCount, sentryCount } = clipCountsAt(clipRoot);
  if (savedCount === 0 && sentryCount === 0) return null;
  return {
    id: folderName,
    model,
    name: displayName,
    label: MODEL_LABELS[model],
    savedCount,
    sentryCount,
  };
}

/** Scan the configured TeslaCam library for vehicle folders (MX_Name, etc.) or legacy layout. */
export function listVehicles(libraryRoot?: string): Vehicle[] {
  const root = path.resolve(libraryRoot ?? effectiveTeslacamDir());

  if (isLegacyClipRoot(root)) {
    const { savedCount, sentryCount } = clipCountsAt(root);
    return [
      {
        id: '',
        model: null,
        name: 'TeslaCam',
        label: 'All clips',
        savedCount,
        sentryCount,
      },
    ];
  }

  const vehicles: Vehicle[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = VEHICLE_FOLDER_RE.exec(entry.name);
    if (!match) continue;
    const [, modelRaw, namePart] = match;
    if (!isModelCode(modelRaw) || !namePart) continue;
    const clipRoot = path.join(root, entry.name);
    const v = vehicleFromFolder(entry.name, modelRaw, namePart.replace(/_/g, ' '), clipRoot);
    if (v) vehicles.push(v);
  }

  vehicles.sort((a, b) => {
    const modelOrder = MODEL_CODES.indexOf(a.model ?? 'M3') - MODEL_CODES.indexOf(b.model ?? 'M3');
    if (modelOrder !== 0) return modelOrder;
    return a.name.localeCompare(b.name);
  });

  return vehicles;
}

export function findVehicle(vehicles: Vehicle[], id: string | null | undefined): Vehicle | undefined {
  if (id === null || id === undefined) return undefined;
  return vehicles.find((v) => v.id === id);
}
