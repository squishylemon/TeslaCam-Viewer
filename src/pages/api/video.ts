import type { APIRoute } from 'astro';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { apiVehicleId, syncVehicleCookieFromQuery } from '../../lib/api-vehicle';
import { safeResolve } from '../../lib/teslacam';

export const prerender = false;

const CONTENT_TYPE = 'video/mp4';

export const GET: APIRoute = (context) => {
  syncVehicleCookieFromQuery(context);
  const { url, request } = context;
  const type = url.searchParams.get('type') ?? '';
  const event = url.searchParams.get('event') ?? '';
  const fileName = url.searchParams.get('file') ?? '';
  const vehicleId = apiVehicleId(context);

  const file = safeResolve(type, event, fileName, vehicleId);
  if (!file) return new Response('Not found', { status: 404 });

  const stat = fs.statSync(file);
  const total = stat.size;
  const range = request.headers.get('range');

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) {
      return new Response('Invalid range', {
        status: 416,
        headers: { 'Content-Range': `bytes */${total}` },
      });
    }

    let start = match[1] ? parseInt(match[1], 10) : 0;
    let end = match[2] ? parseInt(match[2], 10) : total - 1;

    // Handle suffix range: bytes=-N (last N bytes).
    if (!match[1] && match[2]) {
      start = Math.max(0, total - parseInt(match[2], 10));
      end = total - 1;
    }

    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start > end ||
      start >= total
    ) {
      return new Response('Range not satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${total}` },
      });
    }

    end = Math.min(end, total - 1);
    const chunkSize = end - start + 1;
    const stream = Readable.toWeb(
      fs.createReadStream(file, { start, end }),
    ) as unknown as ReadableStream;

    return new Response(stream, {
      status: 206,
      headers: {
        'Content-Type': CONTENT_TYPE,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  const stream = Readable.toWeb(
    fs.createReadStream(file),
  ) as unknown as ReadableStream;

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': CONTENT_TYPE,
      'Content-Length': String(total),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
