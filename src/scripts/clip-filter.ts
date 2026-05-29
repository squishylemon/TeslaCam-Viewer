/**
 * Client-side clip search scoring and filter helpers.
 */

export interface ClipMeta {
  type: string;
  id: string;
  timestamp: string;
  city: string;
  street: string;
  reason: string;
  reasonPretty: string;
  segments: number;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const MONTH_SHORT = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

export function prettyReason(reason: string): string {
  if (!reason) return '';
  return reason.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function passesDateRange(
  timestamp: string,
  from: string,
  to: string,
): boolean {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return true;
  if (from) {
    const start = new Date(`${from}T00:00:00`);
    if (!Number.isNaN(start.getTime()) && d < start) return false;
  }
  if (to) {
    const end = new Date(`${to}T23:59:59.999`);
    if (!Number.isNaN(end.getTime()) && d > end) return false;
  }
  return true;
}

export function passesLocation(city: string, selected: string): boolean {
  if (!selected) return true;
  return city.toLowerCase() === selected.toLowerCase();
}

/** Score one search token against a clip (higher = stronger match). */
export function scoreToken(token: string, clip: ClipMeta): number {
  const t = token.trim().toLowerCase();
  if (!t) return 0;

  const d = new Date(clip.timestamp);
  const validDate = !Number.isNaN(d.getTime());
  const city = clip.city.toLowerCase();
  const street = clip.street.toLowerCase();
  const reason = clip.reason.toLowerCase();
  const pretty = clip.reasonPretty.toLowerCase();
  const id = clip.id.toLowerCase();
  const seg = clip.segments;

  if (/^\d+$/.test(t)) {
    const n = Number.parseInt(t, 10);
    let best = 0;
    if (validDate && d.getDate() === n) best = Math.max(best, 120);
    else if (validDate && String(d.getDate()).includes(t)) best = Math.max(best, 88);
    if (validDate && d.getMonth() + 1 === n) best = Math.max(best, 72);
    if (seg === n) best = Math.max(best, 42);
    else if (String(seg).includes(t)) best = Math.max(best, 22);
    if (validDate && d.getHours() === n) best = Math.max(best, 38);
    if (validDate && d.getMinutes() === n) best = Math.max(best, 32);
    if (validDate && d.getFullYear() === n) best = Math.max(best, 55);
    if (validDate && String(d.getFullYear()).includes(t)) best = Math.max(best, 28);
    return best;
  }

  if (validDate) {
    const iso = clip.timestamp.slice(0, 10);
    const folder = id.replace(/_/g, '-').slice(0, 10);
    if (iso.includes(t) || folder.includes(t)) return 78;
    for (let i = 0; i < MONTHS.length; i++) {
      if (
        (MONTHS[i].includes(t) || MONTH_SHORT[i].includes(t)) &&
        d.getMonth() === i
      ) {
        return 82;
      }
    }
  }

  if (city.includes(t)) return 76;
  if (street.includes(t)) return 72;
  if (reason.includes(t) || pretty.includes(t)) return 58;
  if (id.includes(t)) return 48;
  if (clip.type.toLowerCase().includes(t)) return 40;
  if (t === 'saved' && clip.type === 'SavedClips') return 65;
  if (t === 'sentry' && clip.type === 'SentryClips') return 65;

  return 0;
}

export function matchesSearch(query: string, clip: ClipMeta): boolean {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((tok) => scoreToken(tok, clip) > 0);
}

/** Sum of per-token scores — used to sort results (day-of-month ranks above segment count). */
export function searchRelevance(query: string, clip: ClipMeta): number {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return 0;
  return tokens.reduce((sum, tok) => sum + scoreToken(tok, clip), 0);
}

export function readClipMeta(card: HTMLElement): ClipMeta {
  return {
    type: card.dataset.type || '',
    id: card.dataset.id || '',
    timestamp: card.dataset.timestamp || '',
    city: card.dataset.city || '',
    street: card.dataset.street || '',
    reason: card.dataset.reason || '',
    reasonPretty: card.dataset.reasonPretty || '',
    segments: Number.parseInt(card.dataset.segments || '0', 10) || 0,
  };
}
