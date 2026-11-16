// Docs: docs/06 - API/Jellyfin and Seerr Provider.md
// Purpose: tests for finding the server's item for a title, by key, IMDb ID, or name and year.
import { describe, expect, it } from 'vitest';
import { buildIndex, findItem } from './index';

const ix = buildIndex([
  { Id: 'a', Name: 'Spirited Away', OriginalTitle: '千と千尋の神隠し', Type: 'Movie', ProductionYear: 2001, ProviderIds: { Imdb: 'tt0245429' } },
  { Id: 'b', Name: 'Dune', Type: 'Movie', ProductionYear: 2021, ProviderIds: { Tmdb: '438631' } },
  { Id: 'c', Name: 'Dune', Type: 'Movie', ProductionYear: 1984 },
  { Id: 'd', Name: 'Frieren', Type: 'Series', ProductionYear: 2023 },
] as never);

const t = (key: string, name: string, extra: Record<string, unknown> = {}) => ({ key, name, kind: 'movie' as const, year: null as number | null, imdbId: null as string | null, ...extra });

describe('jellyfin item for a title', () => {
  it('finds by TMDB key or the server key', () => {
    expect(findItem(ix, t('tmdb:movie:438631', 'Whatever'))?.Id).toBe('b');
    expect(findItem(ix, t('jellyfin:c', 'Whatever'))?.Id).toBe('c');
  });
  it('finds a title the server has without a TMDB ID, by IMDb ID or by name and year', () => {
    expect(findItem(ix, t('tmdb:movie:129', 'Le Voyage de Chihiro', { imdbId: 'tt0245429' }))?.Id).toBe('a');
    expect(findItem(ix, t('tmdb:movie:129', '千と千尋の神隠し', { year: 2001 }))?.Id).toBe('a');
    expect(findItem(ix, t('tmdb:movie:841', 'Dune', { year: 1984 }))?.Id).toBe('c');
    expect(findItem(ix, t('tmdb:tv:1', 'FRIEREN', { kind: 'series', year: 2023 }))?.Id).toBe('d');
  });
  it('never takes another year or another kind', () => {
    expect(findItem(ix, t('tmdb:movie:9', 'Dune', { year: 2000 }))).toBeUndefined();
    expect(findItem(ix, t('tmdb:movie:9', 'Frieren', { year: 2023 }))).toBeUndefined();
  });
});

describe('jellyfin search and library', () => {
  it('matches a typed word to a word of a name, typos allowed from four letters', async () => {
    const { wordNear, nameWords } = await import('./index');
    expect(nameWords('Le Voyage de Chihiro!')).toEqual(['le', 'voyage', 'de', 'chihiro']);
    expect(wordNear('voy', 'voyage')).toBe(true);
    expect(wordNear('tied', 'tide')).toBe(true);
    expect(wordNear('chihrio', 'chihiro')).toBe(true);
    expect(wordNear('dad', 'bad')).toBe(false);
    expect(wordNear('xyzw', 'dune')).toBe(false);
  });
  it('keeps home videos for the Library, never as a match for a film', () => {
    const withVideo = buildIndex([
      { Id: 'v', Name: 'Dune', Type: 'Video', ProductionYear: 2021 },
      { Id: 'm', Name: 'Heat', Type: 'Movie', ProductionYear: 1995 },
    ] as never);
    expect(withVideo.all.map((i) => i.Id)).toEqual(['v', 'm']);
    expect(findItem(withVideo, t('tmdb:movie:438631', 'Dune', { year: 2021 }))).toBeUndefined();
    expect(findItem(withVideo, t('tmdb:movie:949', 'Heat', { year: 1995 }))?.Id).toBe('m');
    expect(findItem(withVideo, t('jellyfin:v', 'Dune'))?.Id).toBe('v');
  });
});
