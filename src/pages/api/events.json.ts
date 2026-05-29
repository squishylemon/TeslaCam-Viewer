import type { APIRoute } from 'astro';
import { apiVehicleId, syncVehicleCookieFromQuery } from '../../lib/api-vehicle';
import { CLIP_TYPES, listEvents, type ClipType } from '../../lib/teslacam';

export const prerender = false;

export const GET: APIRoute = (context) => {
  syncVehicleCookieFromQuery(context);
  const { url } = context;
  const typeParam = url.searchParams.get('type');
  const types: ClipType[] =
    typeParam && (CLIP_TYPES as readonly string[]).includes(typeParam)
      ? [typeParam as ClipType]
      : [...CLIP_TYPES];

  const vehicleId = apiVehicleId(context);
  const events = types.flatMap((t) => listEvents(t, vehicleId));
  const light = url.searchParams.get('light') === '1';

  const body = light
    ? {
        events: events.map((ev) => ({
          type: ev.type,
          id: ev.id,
          cams: ev.groups[0]?.cams ?? {},
        })),
      }
    : { events };

  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
};
