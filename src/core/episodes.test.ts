// Docs: docs/03 - Features/Episodes.md
// Purpose: tests for merging a provider's seasons and episodes with TMDB's, once each.
import { describe, expect, it } from 'vitest';
import { mergeEpisodes, mergeSeasons, tmdbSeason } from './episodes';

describe('episodes', () => {
  it('lists each season once, the provider first, specials last', () => {
    const s = mergeSeasons([{ id: 'j1', number: 1, name: 'Saison 1' }], [{ number: 0, name: 'Specials', episodes: 2 }, { number: 1, name: 'Season 1', episodes: 8 }, { number: 2, name: 'Season 2', episodes: 8 }]);
    expect(s.map((x) => [x.number, x.name, !!x.provider, x.count])).toEqual([[1, 'Saison 1', true, 8], [2, 'Season 2', false, 8], [0, 'Specials', false, 2]]);
  });

  it('lists each episode once: the provider plays it, TMDB adds what it lacks', () => {
    const mine = [{ id: 'a', season: 1, number: 1, name: 'Pilot', progress: 0.5 }, { id: 'a2', season: 1, number: 1, name: 'Pilot (4K)' }, { id: 'b', season: 1, number: 2, name: '' }];
    const tmdb = [{ id: 't1', season: 1, number: 1, name: 'Pilot', still: 's1.jpg', runtime: 50 }, { id: 't2', season: 1, number: 2, name: 'Two', overview: 'O' }, { id: 't3', season: 1, number: 3, name: 'Three' }];
    const e = mergeEpisodes(mine, tmdb);
    expect(e.map((x) => [x.id, x.number, x.name, x.playable, x.still ?? null, x.runtime ?? null])).toEqual([['a', 1, 'Pilot', true, 's1.jpg', 50], ['b', 2, 'Two', true, null, null], ['t3', 3, 'Three', false, null, null]]);
    expect(e[0]!.progress).toBe(0.5);
    expect(e[1]!.overview).toBe('O');
  });

  it('reads TMDB seasons', () => {
    expect(tmdbSeason({ episodes: [{ episode_number: 4, name: 'Four', still_path: '/x.jpg', runtime: 42, air_date: '2024-03-01' }] }, 9, 2, (p) => (p ? `img${p}` : null))).toEqual([{ id: 'tmdb:9:2:4', season: 2, number: 4, name: 'Four', overview: undefined, still: 'img/x.jpg', runtime: 42, airDate: '2024-03-01' }]);
  });
});
