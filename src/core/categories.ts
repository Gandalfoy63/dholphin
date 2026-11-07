// Docs: docs/03 - Features/Categories.md
// Purpose: every category as one data entry. Add one here and it appears, with its tile and its page.
import type { Params } from './catalog';

export interface CategoryQuery { heading: string; kind: 'movie' | 'tv'; params: Params; /** Values for the heading: `month` is a date whose month names the row. */ vars?: Record<string, string | number> }
export interface Category {
  id: string;
  name: string;
  /** Colour of the tile's gradient. */
  tint: string;
  featured?: boolean;
  /** A category with `special` fills itself from elsewhere in the app. */
  special?: 'requested';
  needsRequests?: boolean;
  blurb?: string;
  /** Themes come from a TMDB keyword, and are listed under their own heading. */
  theme?: boolean;
  /** How a profile's taste meets a theme: TMDB's keyword name, and the genres it mostly falls in. */
  taste?: { keyword: string; genres: string[] };
  /** A language category: the original language, ISO 639-1. */
  lang?: string;
  /** `lang`: the profile's language as a two-letter code, for categories that follow it. */
  queries: (today: string, lang?: string) => CategoryQuery[];
}

const addDays = (today: string, n: number) => new Date(Date.parse(today) + n * 86_400_000).toISOString().slice(0, 10);

/** Popular and best-rated rows for movies and series with the given filters. */
function both(movie: Params | null, tv: Params | null): Category['queries'] {
  return () => {
    const q: CategoryQuery[] = [];
    if (movie) q.push({ heading: 'Popular movies', kind: 'movie', params: { sort_by: 'popularity.desc', ...movie } });
    if (tv) q.push({ heading: 'Popular series', kind: 'tv', params: { sort_by: 'popularity.desc', ...tv } });
    if (movie) q.push({ heading: 'Best rated movies', kind: 'movie', params: { sort_by: 'vote_average.desc', 'vote_count.gte': 300, ...movie } });
    if (tv) q.push({ heading: 'Best rated series', kind: 'tv', params: { sort_by: 'vote_average.desc', 'vote_count.gte': 100, ...tv } });
    return q;
  };
}

/** A theme: titles TMDB tags with this keyword. `tv` is false where few series carry it. */
const theme = (id: string, name: string, tint: string, keyword: number, taste: Category['taste'], tv = true): Category =>
  ({ id, name, tint, theme: true, taste, queries: both({ with_keywords: keyword }, tv ? { with_keywords: keyword } : null) });

/** Keyword IDs found with TMDB's keyword search; each has at least 50 films or series with 100 votes or more. */
export const THEMES: Category[] = [
  theme('superheroes', 'Superheroes', '#B91C1C', 9715, { keyword: 'superhero', genres: ['Action', 'Science Fiction', 'Adventure'] }),
  theme('true-story', 'Based on a True Story', '#78716C', 9672, { keyword: 'based on true story', genres: ['Drama', 'History'] }),
  theme('books', 'Based on a Book', '#7C2D12', 818, { keyword: 'based on novel or book', genres: ['Drama'] }),
  theme('comics', 'Based on a Comic', '#C2410C', 9717, { keyword: 'based on comic', genres: ['Action', 'Science Fiction'] }),
  theme('games', 'Based on a Video Game', '#4338CA', 41645, { keyword: 'based on video game', genres: ['Action', 'Adventure'] }),
  theme('time-travel', 'Time Travel', '#0369A1', 4379, { keyword: 'time travel', genres: ['Science Fiction'] }),
  theme('heists', 'Heists', '#3F3F46', 10051, { keyword: 'heist', genres: ['Crime', 'Thriller'] }, false),
  theme('dystopia', 'Dystopias', '#52525B', 4565, { keyword: 'dystopia', genres: ['Science Fiction'] }),
  theme('post-apocalypse', 'After the Apocalypse', '#854D0E', 4458, { keyword: 'post-apocalyptic future', genres: ['Science Fiction', 'Action'] }),
  theme('space', 'Outer Space', '#1E3A8A', 9882, { keyword: 'space', genres: ['Science Fiction'] }),
  theme('aliens', 'Aliens', '#15803D', 9951, { keyword: 'alien', genres: ['Science Fiction'] }),
  theme('robots', 'Robots', '#475569', 14544, { keyword: 'robot', genres: ['Science Fiction'] }),
  theme('ai', 'Artificial Intelligence', '#0E7490', 310, { keyword: 'artificial intelligence (a.i.)', genres: ['Science Fiction'] }),
  theme('cyberpunk', 'Cyberpunk', '#9D174D', 12190, { keyword: 'cyberpunk', genres: ['Science Fiction'] }),
  theme('zombies', 'Zombies', '#3F6212', 12377, { keyword: 'zombie', genres: ['Horror'] }),
  theme('vampires', 'Vampires', '#7F1D1D', 3133, { keyword: 'vampire', genres: ['Horror', 'Fantasy'] }),
  theme('ghosts', 'Ghost Stories', '#44403C', 162846, { keyword: 'ghost', genres: ['Horror'] }),
  theme('witches', 'Witches', '#581C87', 616, { keyword: 'witch', genres: ['Horror', 'Fantasy'] }),
  theme('slashers', 'Slashers', '#991B1B', 12339, { keyword: 'slasher', genres: ['Horror'] }, false),
  theme('found-footage', 'Found Footage', '#57534E', 163053, { keyword: 'found footage', genres: ['Horror'] }, false),
  theme('magic', 'Magic', '#6D28D9', 2343, { keyword: 'magic', genres: ['Fantasy'] }),
  theme('dragons', 'Dragons', '#B45309', 12554, { keyword: 'dragon', genres: ['Fantasy'] }),
  theme('serial-killers', 'Serial Killers', '#450A0A', 10714, { keyword: 'serial killer', genres: ['Crime', 'Thriller'] }),
  theme('murder-mystery', 'Murder Mysteries', '#312E81', 207046, { keyword: 'murder mystery', genres: ['Mystery', 'Crime'] }),
  theme('true-crime', 'True Crime', '#334155', 33722, { keyword: 'true crime', genres: ['Crime', 'Documentary'] }),
  theme('mafia', 'Mafia', '#1C1917', 10391, { keyword: 'mafia', genres: ['Crime'] }),
  theme('spies', 'Spies', '#1F2937', 470, { keyword: 'spy', genres: ['Action', 'Thriller'] }),
  theme('conspiracy', 'Conspiracies', '#3730A3', 10410, { keyword: 'conspiracy', genres: ['Thriller'] }),
  theme('psychological', 'Psychological Thrillers', '#4C1D95', 12565, { keyword: 'psychological thriller', genres: ['Thriller'] }),
  theme('neo-noir', 'Neo-Noir', '#27272A', 207268, { keyword: 'neo-noir', genres: ['Crime', 'Thriller'] }),
  theme('revenge', 'Revenge', '#9F1239', 9748, { keyword: 'revenge', genres: ['Action', 'Thriller'] }),
  theme('prison', 'Prison', '#57534E', 378, { keyword: 'prison', genres: ['Crime', 'Drama'] }),
  theme('survival', 'Survival', '#166534', 10349, { keyword: 'survival', genres: ['Thriller', 'Adventure'] }),
  theme('disaster', 'Disasters', '#C2410C', 10617, { keyword: 'disaster', genres: ['Action'] }),
  theme('martial-arts', 'Martial Arts', '#B91C1C', 779, { keyword: 'martial arts', genres: ['Action'] }),
  theme('sports', 'Sports', '#047857', 6075, { keyword: 'sports', genres: ['Drama'] }),
  theme('ww2', 'World War II', '#4D7C0F', 1956, { keyword: 'world war ii', genres: ['War', 'History'] }),
  theme('biopics', 'Biopics', '#92400E', 5565, { keyword: 'biography', genres: ['History', 'Drama'] }),
  theme('period', 'Period Dramas', '#713F12', 15060, { keyword: 'period drama', genres: ['Drama', 'History', 'Romance'] }),
  theme('coming-of-age', 'Coming of Age', '#0891B2', 10683, { keyword: 'coming of age', genres: ['Drama', 'Comedy'] }),
  theme('high-school', 'High School', '#2563EB', 6270, { keyword: 'high school', genres: ['Comedy'] }),
  theme('small-town', 'Small Towns', '#65A30D', 1415, { keyword: 'small town', genres: ['Drama', 'Mystery'] }),
  theme('road-trips', 'Road Trips', '#CA8A04', 7312, { keyword: 'road trip', genres: ['Comedy', 'Adventure'] }, false),
  theme('christmas', 'Christmas', '#B91C1C', 207317, { keyword: 'christmas', genres: ['Family', 'Comedy'] }, false),
  theme('musicals', 'Musicals', '#A21CAF', 4344, { keyword: 'musical', genres: ['Music'] }, false),
  theme('dark-comedy', 'Dark Comedy', '#3F3F46', 10123, { keyword: 'dark comedy', genres: ['Comedy'] }),
  theme('satire', 'Satire', '#B45309', 8201, { keyword: 'satire', genres: ['Comedy'] }),
  theme('mockumentary', 'Mockumentaries', '#0F766E', 11800, { keyword: 'mockumentary', genres: ['Comedy'] }),
  theme('sitcoms', 'Sitcoms', '#D97706', 193171, { keyword: 'sitcom', genres: ['Comedy'] }),
  theme('miniseries', 'Miniseries', '#1D4ED8', 11162, { keyword: 'miniseries', genres: ['Drama'] }),
  theme('anthology', 'Anthologies', '#6B21A8', 9706, { keyword: 'anthology', genres: ['Drama', 'Horror'] }),
  theme('dogs', 'Dogs', '#A16207', 15162, { keyword: 'dog', genres: ['Family'] }, false),
  theme('dinosaurs', 'Dinosaurs', '#4D7C0F', 12616, { keyword: 'dinosaur', genres: ['Adventure', 'Science Fiction'] }),
  theme('lgbtq', 'LGBTQ+ Stories', '#BE185D', 158718, { keyword: 'lgbt', genres: ['Drama', 'Romance'] }),
  theme('women-directors', 'Directed by Women', '#9D174D', 187056, { keyword: 'woman director', genres: ['Drama'] }, false),
  theme('stop-motion', 'Stop Motion', '#9A3412', 10121, { keyword: 'stop motion', genres: ['Animation', 'Family'] }, false),
];

export const CATEGORIES: Category[] = [
  {
    id: 'new', name: 'New Arrivals', tint: '#E5232D', featured: true, blurb: 'Released in the last 60 days',
    // In the profile's language. Fetched by popularity, so enough titles come back, then shown by rating: byRating.
    queries: (today, lang) => [
      { heading: 'New movies', kind: 'movie', params: { sort_by: 'popularity.desc', 'primary_release_date.gte': addDays(today, -60), 'primary_release_date.lte': today, with_release_type: '4|5|6', with_original_language: lang } },
      { heading: 'New series', kind: 'tv', params: { sort_by: 'popularity.desc', 'first_air_date.gte': addDays(today, -60), 'first_air_date.lte': today, with_original_language: lang } },
    ],
  },
  {
    id: 'upcoming', name: 'Upcoming', tint: '#2C6E91', featured: true, blurb: 'Coming in the next six months',
    queries: (today) => [
      { heading: 'Upcoming movies', kind: 'movie', params: { sort_by: 'popularity.desc', 'primary_release_date.gte': addDays(today, 1), 'primary_release_date.lte': addDays(today, 180) } },
      { heading: 'Upcoming series', kind: 'tv', params: { sort_by: 'popularity.desc', 'first_air_date.gte': addDays(today, 1), 'first_air_date.lte': addDays(today, 180) } },
    ],
  },
  { id: 'requested', name: 'You Requested', tint: '#7A4FA3', featured: true, special: 'requested', needsRequests: true, blurb: 'What you asked for', queries: () => [] },
  { id: 'action', name: 'Action', tint: '#C2410C', queries: both({ with_genres: 28 }, { with_genres: 10759 }) },
  { id: 'adventure', name: 'Adventure', tint: '#B45309', queries: both({ with_genres: 12 }, { with_genres: 10759 }) },
  { id: 'animation', name: 'Animation', tint: '#0E7490', queries: both({ with_genres: 16 }, { with_genres: 16 }) },
  { id: 'anime', name: 'Anime', tint: '#BE185D', queries: both({ with_genres: 16, with_original_language: 'ja' }, { with_genres: 16, with_original_language: 'ja' }) },
  { id: 'comedy', name: 'Comedy', tint: '#CA8A04', queries: both({ with_genres: 35 }, { with_genres: 35 }) },
  { id: 'crime', name: 'Crime', tint: '#57534E', queries: both({ with_genres: 80 }, { with_genres: 80 }) },
  { id: 'documentary', name: 'Documentaries', tint: '#15803D', queries: both({ with_genres: 99 }, { with_genres: 99 }) },
  { id: 'drama', name: 'Drama', tint: '#9F1239', queries: both({ with_genres: 18 }, { with_genres: 18 }) },
  { id: 'family', name: 'Kids and Family', tint: '#0891B2', queries: both({ with_genres: 10751 }, { with_genres: '10751|10762' }) },
  { id: 'fantasy', name: 'Fantasy', tint: '#6D28D9', queries: both({ with_genres: 14 }, { with_genres: 10765 }) },
  { id: 'history', name: 'Historical', tint: '#92400E', queries: both({ with_genres: 36 }, null) },
  { id: 'horror', name: 'Horror', tint: '#7F1D1D', queries: both({ with_genres: 27 }, null) },
  { id: 'music', name: 'Music and Musicals', tint: '#A21CAF', queries: both({ with_genres: 10402 }, null) },
  { id: 'mystery', name: 'Mystery', tint: '#3730A3', queries: both({ with_genres: 9648 }, { with_genres: 9648 }) },
  { id: 'romance', name: 'Romance', tint: '#DB2777', queries: both({ with_genres: 10749 }, null) },
  { id: 'scifi', name: 'Science Fiction', tint: '#1D4ED8', queries: both({ with_genres: 878 }, { with_genres: 10765 }) },
  { id: 'thriller', name: 'Thrillers', tint: '#334155', queries: both({ with_genres: 53 }, null) },
  { id: 'war', name: 'War', tint: '#4D7C0F', queries: both({ with_genres: 10752 }, { with_genres: 10768 }) },
  { id: 'western', name: 'Western', tint: '#A16207', queries: both({ with_genres: 37 }, { with_genres: 37 }) },
  { id: 'reality', name: 'Reality TV', tint: '#C026D3', queries: both(null, { with_genres: 10764 }) },
  { id: 'kdrama', name: 'K-Dramas', tint: '#E11D48', queries: both(null, { with_genres: 18, with_original_language: 'ko' }) },
  { id: 'english', name: 'English', tint: '#0369A1', lang: 'en', queries: both({ with_original_language: 'en' }, { with_original_language: 'en' }) },
  { id: 'french', name: 'French', tint: '#1E40AF', lang: 'fr', queries: both({ with_original_language: 'fr' }, { with_original_language: 'fr' }) },
  { id: 'spanish', name: 'Spanish', tint: '#B91C1C', lang: 'es', queries: both({ with_original_language: 'es' }, { with_original_language: 'es' }) },
  { id: 'german', name: 'German', tint: '#854D0E', lang: 'de', queries: both({ with_original_language: 'de' }, { with_original_language: 'de' }) },
  { id: 'italian', name: 'Italian', tint: '#166534', lang: 'it', queries: both({ with_original_language: 'it' }, { with_original_language: 'it' }) },
  { id: 'korean', name: 'Korean', tint: '#0F766E', lang: 'ko', queries: both({ with_original_language: 'ko' }, { with_original_language: 'ko' }) },
  { id: 'japanese', name: 'Japanese', tint: '#BE123C', lang: 'ja', queries: both({ with_original_language: 'ja' }, { with_original_language: 'ja' }) },
  { id: 'hindi', name: 'Hindi', tint: '#C2410C', lang: 'hi', queries: both({ with_original_language: 'hi' }, { with_original_language: 'hi' }) },
  { id: 'chinese', name: 'Chinese', tint: '#B91C1C', lang: 'zh', queries: both({ with_original_language: 'zh' }, { with_original_language: 'zh' }) },
  { id: 'portuguese', name: 'Portuguese', tint: '#15803D', lang: 'pt', queries: both({ with_original_language: 'pt' }, { with_original_language: 'pt' }) },
  { id: 'turkish', name: 'Turkish', tint: '#9F1239', lang: 'tr', queries: both({ with_original_language: 'tr' }, { with_original_language: 'tr' }) },
  { id: 'swedish', name: 'Swedish', tint: '#1D4ED8', lang: 'sv', queries: both({ with_original_language: 'sv' }, { with_original_language: 'sv' }) },
  ...THEMES,
];

export const category = (id: string) => CATEGORIES.find((c) => c.id === id);

/**
 * Best rated first, with few votes counting for less: a title's rating is pulled toward 6.5 as if it had 20 more
 * votes at that, so one 10/10 vote doesn't lead a row.
 */
export function byRating<T extends { title: { scores: { tmdb: number; tmdbVotes: number } } }>(items: T[]): T[] {
  const score = (s: { tmdb: number; tmdbVotes: number }) => (s.tmdb * s.tmdbVotes + 6.5 * 20) / (s.tmdbVotes + 20);
  return [...items].sort((a, b) => score(b.title.scores) - score(a.title.scores));
}

/**
 * The rows a category's page adds as it scrolls, after its own: batch by batch, until there are none.
 * Upcoming: what comes out in each of the next six months, films and series, so every title is reachable.
 * New Arrivals: the following pages. Any other category: the best of each decade, hidden gems, then more of the popular.
 */
export function deeperQueries(c: Category, today: string, lang?: string): CategoryQuery[][] {
  const base = c.queries(today, lang);
  const movie = base.find((q) => q.kind === 'movie')?.params, tv = base.find((q) => q.kind === 'tv')?.params;
  const strip = (p?: Params) => (p ? Object.fromEntries(Object.entries(p).filter(([k]) => !['sort_by', 'vote_count.gte', 'page'].includes(k))) : null);
  const m = strip(movie), s = strip(tv);
  const rows: CategoryQuery[] = [];
  if (c.id === 'upcoming') {
    for (let i = 0; i < 6; i++) {
      const from = addDays(today, 1 + 30 * i), to = addDays(today, 30 * (i + 1));
      rows.push({ heading: '{month}: movies', kind: 'movie', vars: { month: from }, params: { sort_by: 'popularity.desc', 'primary_release_date.gte': from, 'primary_release_date.lte': to } });
      rows.push({ heading: '{month}: series', kind: 'tv', vars: { month: from }, params: { sort_by: 'popularity.desc', 'first_air_date.gte': from, 'first_air_date.lte': to } });
    }
  } else if (c.id === 'new') {
    for (const page of [2, 3, 4]) for (const q of base) rows.push({ heading: q.kind === 'movie' ? 'More new movies' : 'More new series', kind: q.kind, params: { ...q.params, page } });
  } else {
    for (const d of [2020, 2010, 2000, 1990, 1980, 1970, 1960]) {
      if (m) rows.push({ heading: 'Best of the {decade}s: movies', kind: 'movie', vars: { decade: d }, params: { ...m, sort_by: 'vote_average.desc', 'vote_count.gte': 100, 'primary_release_date.gte': `${d}-01-01`, 'primary_release_date.lte': `${d + 9}-12-31` } });
      if (s) rows.push({ heading: 'Best of the {decade}s: series', kind: 'tv', vars: { decade: d }, params: { ...s, sort_by: 'vote_average.desc', 'vote_count.gte': 50, 'first_air_date.gte': `${d}-01-01`, 'first_air_date.lte': `${d + 9}-12-31` } });
    }
    if (m) rows.push({ heading: 'Hidden gems: movies', kind: 'movie', params: { ...m, sort_by: 'vote_average.desc', 'vote_average.gte': 7, 'vote_count.gte': 50, 'vote_count.lte': 400 } });
    if (s) rows.push({ heading: 'Hidden gems: series', kind: 'tv', params: { ...s, sort_by: 'vote_average.desc', 'vote_average.gte': 7, 'vote_count.gte': 30, 'vote_count.lte': 300 } });
    for (const page of [2, 3, 4, 5]) {
      if (m) rows.push({ heading: 'More popular movies', kind: 'movie', params: { ...m, sort_by: 'popularity.desc', page } });
      if (s) rows.push({ heading: 'More popular series', kind: 'tv', params: { ...s, sort_by: 'popularity.desc', page } });
    }
  }
  const batches: CategoryQuery[][] = [];
  for (let i = 0; i < rows.length; i += 4) batches.push(rows.slice(i, i + 4));
  return batches;
}
