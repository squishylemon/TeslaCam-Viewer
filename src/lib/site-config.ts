import fs from 'node:fs';
import path from 'node:path';
import { isLegacyClipRoot, listVehicles } from './vehicles';

export function defaultTeslacamDir(): string {
  const env = process.env.TESLACAM_DIR?.trim();
  if (env) return path.resolve(env);
  return path.resolve(process.cwd(), 'data', 'TeslaCam');
}

/** TeslaCam root on this server (clips uploaded via SFTP land here). */
export function effectiveTeslacamDir(): string {
  return defaultTeslacamDir();
}

export function validateTeslacamDir(dir: string): {
  valid: boolean;
  error?: string;
  savedCount?: number;
  sentryCount?: number;
  vehicleCount?: number;
  layout?: 'legacy' | 'vehicles';
} {
  const resolved = path.resolve(dir.trim());
  if (!fs.existsSync(resolved)) {
    return {
      valid: false,
      error: 'Clip folder not found yet. Upload TeslaCam footage via SFTP (see Settings).',
    };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { valid: false, error: 'Cannot read clip folder.' };
  }
  if (!stat.isDirectory()) {
    return { valid: false, error: 'Clip path is not a directory.' };
  }

  const vehicles = listVehicles(resolved);
  if (vehicles.length === 0) {
    const legacy = isLegacyClipRoot(resolved);
    return {
      valid: false,
      error: legacy
        ? 'No clip events found in SavedClips or SentryClips.'
        : 'No vehicle folders yet. Upload folders like MX_Name, MY_Name, MS_Name, or M3_Name (each with SavedClips and SentryClips inside).',
      savedCount: 0,
      sentryCount: 0,
      vehicleCount: 0,
    };
  }

  const savedCount = vehicles.reduce((n, v) => n + v.savedCount, 0);
  const sentryCount = vehicles.reduce((n, v) => n + v.sentryCount, 0);
  const layout = vehicles.length === 1 && vehicles[0].id === '' ? 'legacy' : 'vehicles';

  return {
    valid: true,
    savedCount,
    sentryCount,
    vehicleCount: vehicles.length,
    layout,
  };
}
