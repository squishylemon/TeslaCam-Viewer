import { prefetchFirstSegment, prefetchRemainingSegments, type SegmentCams } from './prefetch';
import {
  matchesSearch,
  passesDateRange,
  passesLocation,
  readClipMeta,
  searchRelevance,
} from './clip-filter';

const HOVER_PREFETCH_MS = 50;
const SCROLL_IDLE_MS = 120;

let prefetchTimer = 0;
let scrollIdleTimer = 0;
let isScrolling = false;

function cancelHoverPrefetch(): void {
  window.clearTimeout(prefetchTimer);
  prefetchTimer = 0;
}

function readPrefetchGroups(card: HTMLAnchorElement): SegmentCams[] | null {
  const raw = card.dataset.prefetchGroups;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SegmentCams[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Hover: warm first segment only. */
function runHoverPrefetch(card: HTMLAnchorElement): void {
  const type = card.dataset.prefetchType;
  const id = card.dataset.prefetchId;
  const raw = card.dataset.prefetchCams;
  if (!type || !id || !raw) return;
  try {
    const cams = JSON.parse(raw) as Partial<Record<string, string>>;
    prefetchFirstSegment(type, id, cams);
  } catch {
    /* ignore */
  }
}

/** Click: start loading later segments before navigation. */
function runClickPrefetch(card: HTMLAnchorElement): void {
  const type = card.dataset.prefetchType;
  const id = card.dataset.prefetchId;
  if (!type || !id) return;
  runHoverPrefetch(card);
  const groups = readPrefetchGroups(card);
  if (groups && groups.length > 1) {
    prefetchRemainingSegments(type, id, groups, { fromIndex: 1, concurrency: 8 });
  }
}

function wirePrefetch(): void {
  window.addEventListener(
    'scroll',
    () => {
      isScrolling = true;
      cancelHoverPrefetch();
      window.clearTimeout(scrollIdleTimer);
      scrollIdleTimer = window.setTimeout(() => {
        isScrolling = false;
      }, SCROLL_IDLE_MS);
    },
    { passive: true },
  );

  document.querySelectorAll<HTMLAnchorElement>('.card[data-prefetch-type]').forEach(
    (card) => {
      const scheduleHoverPrefetch = () => {
        cancelHoverPrefetch();
        if (isScrolling) return;
        prefetchTimer = window.setTimeout(() => {
          if (isScrolling) return;
          runHoverPrefetch(card);
        }, HOVER_PREFETCH_MS);
      };
      card.addEventListener('mouseenter', scheduleHoverPrefetch);
      card.addEventListener('focus', scheduleHoverPrefetch);
      card.addEventListener('mousedown', () => runClickPrefetch(card));
      card.addEventListener('touchstart', () => runClickPrefetch(card), {
        passive: true,
      });
      card.addEventListener('mouseleave', cancelHoverPrefetch);
      card.addEventListener('blur', cancelHoverPrefetch);
    },
  );
}

// --- Filter / search -------------------------------------------------------

interface CardAnchor {
  parent: Element;
  index: number;
}

const cardAnchors = new Map<HTMLElement, CardAnchor>();

function captureCardAnchors(panel: HTMLElement): void {
  panel.querySelectorAll<HTMLElement>('.card').forEach((card) => {
    if (!cardAnchors.has(card)) {
      const parent = card.parentElement!;
      cardAnchors.set(card, {
        parent,
        index: [...parent.children].indexOf(card),
      });
    }
  });
}

/** Put month-grid cards back in original order (safe after search-grid moves). */
function restoreCardLayout(panel: HTMLElement): void {
  const monthsView = panel.querySelector<HTMLElement>('.months-view');
  const searchView = panel.querySelector<HTMLElement>('.search-view');
  if (monthsView) monthsView.hidden = false;
  if (searchView) searchView.hidden = true;

  const byParent = new Map<Element, { card: HTMLElement; index: number }[]>();

  for (const card of panel.querySelectorAll<HTMLElement>('.card')) {
    const anchor = cardAnchors.get(card);
    if (!anchor) continue;
    let list = byParent.get(anchor.parent);
    if (!list) {
      list = [];
      byParent.set(anchor.parent, list);
    }
    list.push({ card, index: anchor.index });
  }

  for (const [parent, list] of byParent) {
    list.sort((a, b) => a.index - b.index);
    for (const { card } of list) parent.appendChild(card);
  }
}

function applyPanelFilters(panel: HTMLElement): void {
  const q = (document.getElementById('search-q') as HTMLInputElement).value;
  const from = (document.getElementById('date-from') as HTMLInputElement).value;
  const to = (document.getElementById('date-to') as HTMLInputElement).value;
  const loc = (document.getElementById('filter-location') as HTMLSelectElement)
    .value;

  const cards = [...panel.querySelectorAll<HTMLElement>('.card')];
  const searching = q.trim().length > 0;

  const matched: { card: HTMLElement; score: number }[] = [];

  for (const card of cards) {
    const meta = readClipMeta(card);
    const ok =
      passesDateRange(meta.timestamp, from, to) &&
      passesLocation(meta.city, loc) &&
      matchesSearch(q, meta);

    if (!ok) {
      card.hidden = true;
      continue;
    }

    if (searching) {
      matched.push({ card, score: searchRelevance(q, meta) });
      card.hidden = false;
    } else {
      card.hidden = false;
    }
  }

  const monthsView = panel.querySelector<HTMLElement>('.months-view');
  const searchView = panel.querySelector<HTMLElement>('.search-view');
  const searchGrid = panel.querySelector<HTMLElement>('.search-grid');
  const emptyEl = panel.querySelector<HTMLElement>('.filter-empty');

  if (searching && searchView && searchGrid) {
    if (monthsView) monthsView.hidden = true;
    searchView.hidden = false;
    matched.sort((a, b) => b.score - a.score);
    for (const { card } of matched) searchGrid.appendChild(card);
  } else {
    restoreCardLayout(panel);
  }

  panel.querySelectorAll<HTMLElement>('.month').forEach((month) => {
    const visible = [...month.querySelectorAll<HTMLElement>('.card')].some(
      (c) => !c.hidden,
    );
    month.hidden = searching || !visible;
  });

  const visibleCount = cards.filter((c) => !c.hidden).length;
  if (emptyEl) {
    emptyEl.hidden = visibleCount > 0;
  }

}

function visibleCountForPanel(panelKey: string): number {
  const panel = document.querySelector<HTMLElement>(
    `.panel[data-panel="${panelKey}"]`,
  );
  if (!panel) return 0;
  return [...panel.querySelectorAll<HTMLElement>('.card')].filter((c) => !c.hidden)
    .length;
}

function updateTabCounts(): void {
  document.querySelectorAll<HTMLButtonElement>('.tab[data-tab]').forEach((tab) => {
    const key = tab.dataset.tab;
    if (!key) return;
    const countEl = tab.querySelector<HTMLElement>('.count');
    if (countEl) countEl.textContent = String(visibleCountForPanel(key));
  });
}

function updateVisiblePanelResultCount(): void {
  const panel = document.querySelector<HTMLElement>(
    '.panel[data-panel]:not([hidden])',
  );
  if (!panel) return;
  const panelKey = panel.dataset.panel || '';
  const visible = visibleCountForPanel(panelKey);
  const total = panel.querySelectorAll<HTMLElement>('.card').length;
  const el = document.getElementById('filters-result');
  if (!el) return;
  const label = panelKey === 'SentryClips' ? 'Sentry' : 'Saved';
  el.textContent =
    visible === total
      ? `${visible} ${label} clips`
      : `${visible} of ${total} ${label} clips`;
}

let applyAllFilters: () => void = () => {};

function wireFilters(): void {
  const panels = document.querySelectorAll<HTMLElement>('.panel[data-panel]');
  panels.forEach((panel) => captureCardAnchors(panel));

  applyAllFilters = () => {
    panels.forEach((p) => applyPanelFilters(p));
    updateTabCounts();
    updateVisiblePanelResultCount();
    updateFilterButtonState();
  };

  document.getElementById('search-q')?.addEventListener('input', applyAllFilters);
  document.getElementById('date-from')?.addEventListener('change', applyAllFilters);
  document.getElementById('date-to')?.addEventListener('change', applyAllFilters);
  document
    .getElementById('filter-location')
    ?.addEventListener('change', applyAllFilters);

  document.getElementById('clear-filters')?.addEventListener('click', () => {
    const from = document.getElementById('date-from') as HTMLInputElement;
    const to = document.getElementById('date-to') as HTMLInputElement;
    const loc = document.getElementById('filter-location') as HTMLSelectElement;
    if (from) from.value = '';
    if (to) to.value = '';
    if (loc) loc.value = '';
    applyAllFilters();
  });

  applyAllFilters();
  wireFilterPopover();
}

function hasActiveFilters(): boolean {
  const from = (document.getElementById('date-from') as HTMLInputElement)?.value;
  const to = (document.getElementById('date-to') as HTMLInputElement)?.value;
  const loc = (document.getElementById('filter-location') as HTMLSelectElement)?.value;
  return Boolean(from || to || loc);
}

function updateFilterButtonState(): void {
  const btn = document.getElementById('filter-toggle');
  btn?.classList.toggle('filter-active', hasActiveFilters());
}

function wireFilterPopover(): void {
  const toggle = document.getElementById('filter-toggle');
  const popover = document.getElementById('filter-popover');
  if (!toggle || !popover) return;

  const open = () => {
    popover.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    popover.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (popover.hidden) open();
    else close();
  });

  popover.addEventListener('click', (e) => e.stopPropagation());

  document.addEventListener('click', () => {
    if (!popover.hidden) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !popover.hidden) close();
  });
}

function wireTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
  const panels = document.querySelectorAll<HTMLElement>('.panel');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const key = tab.dataset.tab;
      tabs.forEach((t) => {
        const isActive = t === tab;
        t.classList.toggle('active', isActive);
        t.setAttribute('aria-selected', String(isActive));
      });
      panels.forEach((p) => {
        p.hidden = p.dataset.panel !== key;
      });
      window.scrollTo({ top: 0 });
      window.setTimeout(applyAllFilters, 0);
    });
  });
}

wirePrefetch();
wireTabs();
wireFilters();

import('./settings-overlay').then(({ initSettingsOverlay }) => initSettingsOverlay());
