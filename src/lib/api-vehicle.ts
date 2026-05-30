import type { APIContext } from 'astro';
import { clipRootForVehicle } from './libraries/resolve';
import { setVehicleCookie, vehicleFromRequest } from './vehicle-context';

/** Resolve vehicle id for API routes from query param or cookie. */
export function apiVehicleId(context: APIContext): string {
  const { active } = vehicleFromRequest(context.url, context.cookies);
  if (active?.id) return active.id;

  const query = context.url.searchParams.get('vehicle')?.trim();
  if (query && clipRootForVehicle(query)) return query;

  return '';
}

/** Persist ?vehicle= from API requests when valid. */
export function syncVehicleCookieFromQuery(context: APIContext): void {
  const query = context.url.searchParams.get('vehicle');
  if (query === null) return;
  const { active } = vehicleFromRequest(context.url, context.cookies);
  if (active?.id) setVehicleCookie(context.cookies, active.id);
}
