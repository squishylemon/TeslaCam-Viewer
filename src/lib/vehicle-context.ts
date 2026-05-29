import type { AstroCookies } from 'astro';
import { findVehicle, listVehicles, type Vehicle } from './vehicles';

export const VEHICLE_COOKIE = 'tc_vehicle';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function readVehicleCookie(cookies: AstroCookies): string | null {
  const raw = cookies.get(VEHICLE_COOKIE)?.value?.trim();
  return raw ?? null;
}

export function setVehicleCookie(cookies: AstroCookies, vehicleId: string): void {
  cookies.set(VEHICLE_COOKIE, vehicleId, {
    path: '/',
    maxAge: COOKIE_MAX_AGE,
    sameSite: 'lax',
    httpOnly: false,
  });
}

export function clearVehicleCookie(cookies: AstroCookies): void {
  cookies.delete(VEHICLE_COOKIE, { path: '/' });
}

/**
 * Pick the active vehicle from query (?vehicle=), cookie, or the sole vehicle when only one exists.
 */
export function resolveActiveVehicle(
  vehicles: Vehicle[],
  queryVehicle: string | null,
  cookieVehicle: string | null,
): Vehicle | null {
  const candidates = [queryVehicle, cookieVehicle].filter(
    (v): v is string => v !== null && v !== undefined,
  );

  for (const id of candidates) {
    const found = findVehicle(vehicles, id);
    if (found) return found;
  }

  if (vehicles.length === 1) return vehicles[0];
  return null;
}

export function vehiclesForLibrary(): Vehicle[] {
  return listVehicles();
}

export function vehicleFromRequest(
  url: URL,
  cookies: AstroCookies,
): { vehicles: Vehicle[]; active: Vehicle | null } {
  const vehicles = vehiclesForLibrary();
  const queryVehicle = url.searchParams.get('vehicle');
  const cookieVehicle = readVehicleCookie(cookies);
  const active = resolveActiveVehicle(vehicles, queryVehicle, cookieVehicle);
  return { vehicles, active };
}
