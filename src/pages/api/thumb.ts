import type { APIRoute } from 'astro';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { apiVehicleId, syncVehicleCookieFromQuery } from '../../lib/api-vehicle';
import { safeResolve } from '../../lib/teslacam';

export const prerender = false;

export const GET: APIRoute = (context) => {
  syncVehicleCookieFromQuery(context);
  const { url } = context;
  const type = url.searchParams.get('type') ?? '';
  const event = url.searchParams.get('event') ?? '';
  const vehicleId = apiVehicleId(context);

  const file = safeResolve(type, event, 'thumb.png', vehicleId);
  if (!file) return new Response('Not found', { status: 404 });

  const stat = fs.statSync(file);
  const stream = Readable.toWeb(
    fs.createReadStream(file),
  ) as unknown as ReadableStream;

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(stat.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
