import type { APIContext } from 'astro';
import {
  readVehicleCookie,
  resolveActiveVehicle,
  setVehicleCookie,
} from './vehicle-context';
import { listVehicles } from './vehicles';

/** Resolve vehicle id for API routes from query param or cookie. */
export function apiVehicleId(context: APIContext): string {
  const vehicles = listVehicles();
  const query = context.url.searchParams.get('vehicle');
  const cookie = readVehicleCookie(context.cookies);
  const active = resolveActiveVehicle(vehicles, query, cookie);
  return active?.id ?? '';
}

/** Persist ?vehicle= from API requests when valid. */
export function syncVehicleCookieFromQuery(context: APIContext): void {
  const query = context.url.searchParams.get('vehicle');
  if (query === null) return;
  const vehicles = listVehicles();
  const active = resolveActiveVehicle(vehicles, query, null);
  if (active?.id) setVehicleCookie(context.cookies, active.id);
}
