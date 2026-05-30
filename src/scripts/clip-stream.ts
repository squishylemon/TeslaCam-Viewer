import {
  getStreamTier,
  primeFast,
  primeMany,
  stretchMany,
  upgradeFull,
  upgradeMany,
  type StreamTier,
} from './stream-cache';
import { videoApiUrl, type SegmentCams } from './prefetch';

const CAM_ORDER = ['front', 'left', 'right', 'back'] as const;

export type CamKey = (typeof CAM_ORDER)[number];

export interface ClipStreamGroup {
  t: string;
  cams: Partial<Record<CamKey, string>>;
}

/**
 * Orchestrates progressive loading for one clip: fast prime → play → stretch → full.
 */
export class ClipStreamCoordinator {
  private readonly type: string;
  private readonly event: string;
  private readonly groups: ClipStreamGroup[];
  private readonly allUrls: string[];
  private backgroundStarted = false;

  constructor(type: string, event: string, groups: ClipStreamGroup[]) {
    this.type = type;
    this.event = event;
    this.groups = groups;
    this.allUrls = groups.flatMap((g) =>
      CAM_ORDER.map((c) => g.cams[c])
        .filter((f): f is string => Boolean(f))
        .map((f) => videoApiUrl(type, event, f)),
    );
  }

  urlForFile(file: string): string {
    return videoApiUrl(this.type, this.event, file);
  }

  urlsForSegment(index: number): string[] {
    const g = this.groups[index];
    if (!g) return [];
    return CAM_ORDER.map((c) => g.cams[c])
      .filter((f): f is string => Boolean(f))
      .map((f) => this.urlForFile(f));
  }

  /** Prime segment 0 (usually already done on homepage hover). */
  async primeFirstSegment(): Promise<void> {
    const urls = this.urlsForSegment(0);
    if (urls.length === 0) return;
    await primeMany(urls, urls.length);
  }

  /**
   * Prime every segment's head/tail quickly so skips only decode, rarely wait on network.
   */
  async primeAllFast(): Promise<void> {
    await primeMany(this.allUrls, 8);
  }

  /** Prioritize one segment, then stretch/full in background. */
  async focusSegment(index: number): Promise<void> {
    const urls = this.urlsForSegment(index);
    if (urls.length === 0) return;
    await Promise.all(urls.map((u) => primeFast(u)));
    for (const u of urls) void upgradeFull(u);
  }

  tierForFile(file: string): StreamTier {
    return getStreamTier(this.urlForFile(file));
  }

  /** After first frame plays, widen buffers then pull full files. */
  startBackgroundPipeline(): void {
    if (this.backgroundStarted) return;
    this.backgroundStarted = true;

    const rest = this.allUrls.filter((_, i, arr) => {
      const seg0 = new Set(this.urlsForSegment(0));
      return !seg0.has(arr[i]!);
    });

    void (async () => {
      if (rest.length > 0) await primeMany(rest, 8);
      await stretchMany(this.allUrls, 4);
      upgradeMany(this.allUrls, 2);
    })();
  }

  static groupsFromPlayer(
    type: string,
    event: string,
    groups: Array<{ t: string; files: Partial<Record<CamKey, string>> }>,
  ): ClipStreamCoordinator {
    return new ClipStreamCoordinator(
      type,
      event,
      groups.map((g) => ({ t: g.t, cams: g.files })),
    );
  }
}
