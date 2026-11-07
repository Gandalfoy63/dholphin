// Docs: docs/03 - Features/Title Details.md
// Purpose: one grade out of 10 that sums up every source's score for a title.
import type { Title } from '@/sdk/types';
import type { Grade } from './catalog';

/** Critics' aggregates count fully; a public score counts by how many voted: 10,000 votes and more is full weight. */
const CRITICS = new Set(['Rotten Tomatoes', 'Metacritic']);
const weight = (g: Grade) => (CRITICS.has(g.source) ? 1 : g.votes == null ? 0.5 : Math.min(1, Math.max(0.25, Math.log10(g.votes + 1) / 4)));

/** The overall grade: each score brought to 10 and averaged by weight. Null with no score at all. */
export function summarize(grades: Grade[]): { value: number; sources: string[] } | null {
  const usable = grades.filter((g) => g.outOf > 0 && Number.isFinite(g.value) && g.value > 0);
  if (!usable.length) return null;
  let sum = 0, total = 0;
  for (const g of usable) {
    const w = weight(g);
    sum += (g.value / g.outOf) * 10 * w;
    total += w;
  }
  return { value: Math.round((sum / total) * 10) / 10, sources: [...new Set(usable.map((g) => g.source))] };
}

/** The scores a title carries itself: TMDB's, and IMDb, Rotten Tomatoes and Metacritic once OMDb answered. */
export function ownGrades(t: Pick<Title, 'scores'>): Grade[] {
  const s = t.scores, out: Grade[] = [];
  if (s.tmdbVotes) out.push({ source: 'TMDB', value: s.tmdb, outOf: 10, votes: s.tmdbVotes });
  if (s.imdb != null) out.push({ source: 'IMDb', value: s.imdb, outOf: 10, votes: s.imdbVotes });
  if (s.tomato != null) out.push({ source: 'Rotten Tomatoes', value: s.tomato, outOf: 100 });
  if (s.metacritic != null) out.push({ source: 'Metacritic', value: s.metacritic, outOf: 100 });
  return out;
}

/** A grade weighed by how many voted, for sorting: few votes pull it toward an ordinary 6.5, so a 10 from one vote
 * can't lead. 1,000 votes count as much as the prior; IMDb's count, else TMDB's. */
export function rankGrade(t: Pick<Title, 'scores'>, overall: number | null | undefined): number {
  if (overall == null) return 0;
  const v = t.scores.imdbVotes ?? t.scores.tmdbVotes ?? 0, m = 1000, c = 6.5;
  return (v * overall + m * c) / (v + m);
}
