// Docs: docs/03 - Features/TV Shows.md
// Purpose: tests telling TV programmes from series.
import { describe, expect, it } from 'vitest';
import { isTvShow, showFromDetails } from './tvshows';

const s = (key: string, genres: string[]) => ({ key, kind: 'series' as const, genres });
describe('TV programmes', () => {
  it('knows talk shows, news and reality by genre, and listed programmes by key', () => {
    expect(isTvShow(s('tmdb:tv:1', ['Talk']), new Set())).toBe(true);
    expect(isTvShow(s('tmdb:tv:2', ['Comedy']), new Set(['tmdb:tv:2']))).toBe(true);
    expect(isTvShow(s('tmdb:tv:3', ['Comedy', 'Drama']), new Set())).toBe(false);
    expect(isTvShow({ key: 'tmdb:movie:4', kind: 'movie', genres: ['Talk'] }, new Set())).toBe(false);
  });
  it('treats a TMDB series without any genre as a programme, not a Jellyfin one', () => {
    expect(isTvShow(s('tmdb:tv:5', []), new Set())).toBe(true);
    expect(isTvShow(s('jellyfin:abc', []), new Set())).toBe(false);
  });
  it('reads a programme from details: its type, or only entertainment channels', () => {
    expect(showFromDetails({ type: 'Talk Show' })).toBe(true);
    expect(showFromDetails({ type: 'Scripted', networks: [{ id: 1603 }] })).toBe(true);
    expect(showFromDetails({ type: 'Scripted', networks: [{ id: 712 }] })).toBe(false);
    expect(showFromDetails({ type: 'Scripted', networks: [{ id: 1603 }, { id: 213 }] })).toBe(false);
  });
});
