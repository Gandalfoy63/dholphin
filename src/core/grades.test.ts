// Docs: docs/03 - Features/Title Details.md
// Purpose: tests the overall grade that sums up every source.
import { describe, expect, it } from 'vitest';
import { ownGrades, rankGrade, summarize } from './grades';

describe('overall grade', () => {
  it('brings every score to 10 and averages them, weighting public scores by their votes', () => {
    const s = summarize([
      { source: 'IMDb', value: 8, outOf: 10, votes: 100_000 },
      { source: 'Rotten Tomatoes', value: 90, outOf: 100 },
      { source: 'Metacritic', value: 70, outOf: 100 },
      { source: 'AniList', value: 85, outOf: 100, votes: 50 },
    ])!;
    // IMDb 8 (w 1), RT 9 (w 1), MC 7 (w 1), AniList 8.5 (50 votes: w ~0.43) => about 8.06
    expect(s.value).toBe(8.1);
    expect(s.sources).toEqual(['IMDb', 'Rotten Tomatoes', 'Metacritic', 'AniList']);
  });
  it('lets a score with few votes count less', () => {
    const few = summarize([{ source: 'IMDb', value: 8, outOf: 10, votes: 1_000_000 }, { source: 'TMDB', value: 2, outOf: 10, votes: 3 }])!;
    expect(few.value).toBeGreaterThan(6.5);
  });
  it('has nothing to say without scores, and skips empty ones', () => {
    expect(summarize([])).toBeNull();
    expect(summarize([{ source: 'TMDB', value: 0, outOf: 10, votes: 0 }])).toBeNull();
  });
  it('reads the scores a title carries', () => {
    expect(ownGrades({ scores: { tmdb: 7, tmdbVotes: 10, imdb: 7.5, imdbVotes: 200, tomato: 80, metacritic: null } }).map((g) => g.source)).toEqual(['TMDB', 'IMDb', 'Rotten Tomatoes']);
  });
  it('sorts a grade by its votes too: a 10 from one vote stays behind an 8.5 from many', () => {
    const lone = rankGrade({ scores: { tmdb: 10, tmdbVotes: 1 } }, 10), loved = rankGrade({ scores: { tmdb: 8.5, tmdbVotes: 100_000 } }, 8.5);
    expect(loved).toBeGreaterThan(lone);
    expect(rankGrade({ scores: { tmdb: 0, tmdbVotes: 0 } }, null)).toBe(0);
  });
});
