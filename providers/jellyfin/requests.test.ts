// Docs: docs/06 - API/Jellyfin and Seerr Provider.md
// Purpose: tests how Seerr's requests become one clear stage each, with the shapes a real Seerr 3.5 answered.
import { describe, expect, it } from 'vitest';
import { stageOf, toEntry, type SeerrRequest } from './requests';

const req = (status: number, media: SeerrRequest['media'], more: Partial<SeerrRequest> = {}): SeerrRequest => ({ id: 1, type: 'movie', status, media: { tmdbId: 354912, ...media }, ...more });

describe('Seerr requests', () => {
  it('says where each request stands', () => {
    expect(stageOf(req(1, { status: 2 }))).toBe('pending');
    expect(stageOf(req(2, { status: 2 }))).toBe('approved');
    expect(stageOf(req(2, { status: 3 }))).toBe('searching');
    expect(stageOf(req(2, { status: 3, downloadStatus: [{ size: 10, sizeLeft: 5 }] }))).toBe('downloading');
    expect(stageOf(req(2, { status: 4 }))).toBe('partly');
    expect(stageOf(req(5, { status: 5 }))).toBe('available');
    expect(stageOf(req(3, { status: 1 }))).toBe('declined');
    expect(stageOf(req(4, { status: 3 }))).toBe('failed');
    expect(stageOf(req(2, { status: 6 }))).toBe('deleted');
  });
  it('gives a download its progress and when it ends, from the last file', () => {
    const e = toEntry(req(2, { status: 3, downloadStatus: [
      { status: 'downloading', size: 23091099750, sizeLeft: 23034361958, timeLeft: '02:21:27', estimatedCompletionTime: '2026-11-08T14:41:00.000Z', title: 'Coco.2017.1080p' },
      { status: 'downloading', size: 1000, sizeLeft: 0, estimatedCompletionTime: '2026-11-08T13:00:00.000Z' },
    ] }, { requestedBy: { id: 7, displayName: 'kimax' }, createdAt: '2026-11-08T12:19:00.000Z' }), 7)!;
    expect(e.stage).toBe('downloading');
    expect(e.download!.files).toBe(2);
    expect(e.download!.progress).toBeCloseTo(1 - 23034361958 / 23091100750, 6);
    expect(e.download!.eta).toBe('2026-11-08T14:41:00.000Z');
    expect([e.mine, e.requestedBy, e.kind]).toEqual([true, 'kimax', 'movie']);
  });
  it('lists a series\' seasons in order, and leaves out what has no TMDB ID', () => {
    const e = toEntry({ id: 9, type: 'tv', status: 2, media: { tmdbId: 2190, status: 4 }, seasons: [{ seasonNumber: 3 }, { seasonNumber: 1 }, { seasonNumber: 2 }], requestedBy: { id: 2, jellyfinUsername: 'Jules' } }, 7)!;
    expect([e.kind, e.seasons, e.mine, e.requestedBy, e.stage]).toEqual(['tv', [1, 2, 3], false, 'Jules', 'partly']);
    expect(toEntry({ id: 10, status: 2, media: {} }, null)).toBeNull();
  });
});
