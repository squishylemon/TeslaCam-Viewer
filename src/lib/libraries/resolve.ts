import fs from 'node:fs';
import { defaultTeslacamDir } from '../site-config';
import { listVehicles, vehicleClipRoot, type Vehicle } from '../vehicles';
import { getLibraryLocation, getLibrarySettings, listLibraryLocations } from './store';
import { resolveLocationRoot, unmountLocation, type MountableLocation } from './mount';
import { BUILTIN_LOCATION_ID } from './types';
import { decodeVehicleId, encodeVehicleId } from './vehicle-id';

export interface ResolvedLibraryRoot {
  id: string;
  name: string;
  rootPath: string;
}

let cachedRoots: ResolvedLibraryRoot[] = [];

export function getCachedLibraryRoots(): ResolvedLibraryRoot[] {
  return cachedRoots;
}

export function clearLibrariesCache(): void {
  cachedRoots = [];
}

async function buildLibraryRoots(): Promise<ResolvedLibraryRoot[]> {
  const settings = await getLibrarySettings();
  const roots: ResolvedLibraryRoot[] = [];

  if (settings.builtinSftpEnabled) {
    const builtinPath = defaultTeslacamDir();
    if (fs.existsSync(builtinPath)) {
      roots.push({
        id: BUILTIN_LOCATION_ID,
        name: 'Built-in upload',
        rootPath: builtinPath,
      });
    }
  }

  const locations = await listLibraryLocations();
  for (const loc of locations) {
    if (!loc.enabled) continue;
    try {
      const full = await getLibraryLocation(loc.id);
      if (!full) continue;
      const mountable: MountableLocation = {
        ...full,
        smbUsername: full.smbUsername,
        smbPasswordEnc: full.smbPasswordEnc,
      };
      const rootPath = resolveLocationRoot(mountable);
      roots.push({ id: loc.id, name: loc.name, rootPath });
    } catch (err) {
      console.error(`[libraries] Skipping "${loc.name}" (${loc.id}):`, err);
    }
  }

  return roots;
}

export async function refreshLocationMounts(): Promise<void> {
  const locations = await listLibraryLocations();
  for (const loc of locations) {
    if (!loc.enabled) {
      unmountLocation(loc.id);
      continue;
    }
    try {
      const full = await getLibraryLocation(loc.id);
      if (!full) continue;
      resolveLocationRoot({
        ...full,
        smbUsername: full.smbUsername,
        smbPasswordEnc: full.smbPasswordEnc,
      });
    } catch (err) {
      console.error(`[libraries] Mount failed for ${loc.name}:`, err);
    }
  }
}

export async function refreshLibraries(): Promise<ResolvedLibraryRoot[]> {
  await refreshLocationMounts();
  cachedRoots = await buildLibraryRoots();
  return cachedRoots;
}

export function listAllVehicles(): Vehicle[] {
  const roots = cachedRoots;
  const out: Vehicle[] = [];
  const multiLib = roots.length > 1;

  for (const lib of roots) {
    const vehicles = listVehicles(lib.rootPath);
    const prefix = multiLib ? `${lib.name} · ` : '';
    for (const v of vehicles) {
      out.push({
        ...v,
        id: encodeVehicleId(lib.id, v.id),
        label: `${prefix}${v.label}`,
        locationId: lib.id,
        locationName: lib.name,
      });
    }
  }

  return out;
}

export function clipRootForVehicle(vehicleId: string): string | null {
  const { locationId, folderId } = decodeVehicleId(vehicleId);
  const lib = cachedRoots.find((r) => r.id === locationId);
  if (!lib) return null;
  return vehicleClipRoot(lib.rootPath, folderId);
}
