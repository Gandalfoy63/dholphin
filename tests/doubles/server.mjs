// Docs: docs/02 - Tech/Testing.md
// Purpose: tests only: a stand-in for TMDB, OMDb, Wikidata, Seerr, Jellyfin and Netflix's pages, with made-up titles. Serves the app too.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const DIST = join(ROOT, 'web/dist');
const VIDEO = join(import.meta.dirname, 'test.webm');
const G = { Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99, Drama: 18, Family: 10751, Fantasy: 14, Horror: 27, Mystery: 9648, Romance: 10749, 'Science Fiction': 878, Thriller: 53, War: 10752 };
const PAL = [['#1F3A4D', '#E8B04A', '#0F1E29'], ['#4A1C24', '#E5705A', '#25090E'], ['#20392E', '#9CC27E', '#0E1E17'], ['#2C2A4A', '#8F8BE0', '#13122A'], ['#3D3325', '#D9B48A', '#1C160E'], ['#123840', '#5FD0C5', '#071D21'], ['#402138', '#E08FB8', '#1F0E1B'], ['#2B2F36', '#C7CDD6', '#14161A']];
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
// [name, tv?, genres, language, days from today, IMDb, Tomato, on Netflix, on Jellyfin]
const RAW = [
  ['Low Tide', 1, ['Thriller', 'Crime'], 'en', -700, 8.6, 94, 1, 0], ['The Ninth Lantern', 0, ['Fantasy', 'Adventure'], 'en', -500, 7.9, 88, 0, 1],
  ['Glass Harbour', 1, ['Drama'], 'fr', -1300, 8.3, 91, 1, 0], ['Northbound', 0, ['Drama', 'Adventure'], 'en', -1600, 7.4, 82, 0, 1],
  ['Salt and Static', 1, ['Science Fiction', 'Mystery'], 'en', -30, 8.8, 96, 1, 0], ['Ember Hollow', 0, ['Horror'], 'en', -2000, 6.9, 74, 0, 0],
  ['Paper Moons', 0, ['Romance', 'Comedy'], 'fr', -400, 7.6, 85, 1, 0], ['The Long Quiet', 1, ['Science Fiction', 'Drama'], 'en', -800, 8.5, 93, 0, 1],
  ['Orbit Street', 1, ['Comedy'], 'en', -1500, 8.0, 89, 1, 0], ['Black Orchard', 0, ['Thriller'], 'en', -1100, 7.8, 84, 0, 1],
  ['Kestrel', 0, ['Action'], 'en', -20, 7.2, 78, 0, 0], ['Second Sunrise', 1, ['Drama'], 'en', -2100, 8.1, 90, 1, 0],
  ['Tin Crown', 1, ['Fantasy', 'Drama'], 'en', -300, 8.7, 95, 1, 0], ['House of Echoes', 0, ['Horror', 'Mystery'], 'en', -2400, 7.0, 76, 0, 1],
  ['Marrow Bay', 1, ['Crime'], 'en', -600, 8.4, 92, 0, 1], ['Neon Parish', 0, ['Science Fiction', 'Crime'], 'en', -40, 7.7, 83, 1, 0],
  ['Halcyon Run', 0, ['Drama', 'Action'], 'en', -1400, 7.5, 86, 0, 0], ['The Cartographer', 1, ['Documentary'], 'en', -1000, 8.9, 97, 1, 0],
  ['Vesper Line', 1, ['Thriller', 'Science Fiction'], 'ko', -15, 8.2, 90, 0, 1], ['Wild Geometry', 0, ['Animation', 'Family'], 'ja', -1700, 7.9, 92, 0, 1],
  ['Rook and Rye', 1, ['Comedy', 'Crime'], 'es', -350, 8.0, 87, 1, 0], ['Last Ferry', 0, ['Drama', 'Romance'], 'fr', -700, 7.3, 81, 0, 0],
  ['Pale Signal', 0, ['Science Fiction'], 'en', -1100, 7.6, 80, 1, 0], ['Copper Sky', 1, ['Adventure'], 'en', -1900, 7.9, 85, 0, 1],
  ['Winter Ledger', 0, ['Thriller', 'Drama'], 'en', 25, 0, 0, 0, 0], ['The Glass Divide', 1, ['Science Fiction'], 'en', 60, 0, 0, 0, 0],
  ['Saltmarsh', 0, ['Mystery'], 'fr', 110, 0, 0, 0, 0], ['Iron Meridian', 1, ['War', 'Drama'], 'en', 150, 0, 0, 0, 0],
  ['Blue Hour', 0, ['Romance'], 'en', -10, 7.1, 79, 1, 0], ['Fox Run', 0, ['Family', 'Comedy'], 'en', -50, 7.0, 75, 0, 1],
];
// A big catalogue, so rows can repeat a category with different films, as the real one does.
const GENRES = Object.keys(G);
for (let i = 0; i < 400; i++) {
  const g = GENRES[i % GENRES.length];
  RAW.push([`${g} ${i}`, i % 3 === 0 ? 1 : 0, [g, GENRES[(i * 7 + 3) % GENRES.length]], ['en', 'fr', 'en', 'ko', 'es', 'de', 'it', 'ja'][i % 8], -300 - i * 73, 6 + (i % 35) / 10, 50 + (i % 50), i % 5 === 0 ? 1 : 0, 0]);
}
for (let i = 0; i < 60; i++) {
  const g = GENRES[i % GENRES.length];
  RAW.push([`Recent ${g} ${i}`, i % 3 === 0 ? 1 : 0, [g], 'en', -2 - (i % 55), 6.5 + (i % 30) / 10, 60 + (i % 40), i % 4 === 0 ? 1 : 0, 0]);
}
// Anime for the Anime page: Japanese animation, five series and five films, little known so they stay out of the top rows.
for (let i = 0; i < 10; i++) RAW.push([`Anime ${i}`, i < 5 ? 1 : 0, ['Animation', i % 2 ? 'Action' : 'Fantasy'], 'ja', -30 - i * 90, 7 + i / 10, 80, 0, 0]);
// TV programmes: a sketch show on C8 that TMDB calls a comedy (like the Palmashow), a talk show and a reality show.
RAW.push(['Sketch Hour', 1, ['Comedy'], 'fr', -40, 7.2, 70, 0, 0], ['Late Night Talk', 1, ['Talk'], 'fr', -20, 6.8, 60, 0, 0], ['Island Survivors', 1, ['Reality'], 'fr', -25, 6.5, 55, 0, 0]);
Object.assign(G, { Talk: 10767, Reality: 10764, News: 10763 });
const SYN = 'A made-up story for testing: people, a place, and a secret that does not stay kept.';
const T = RAW.map((r, i) => ({ id: 100 + i, name: r[0], tv: !!r[1], genres: r[2], lang: r[3], date: day(r[4]), imdb: r[5], tom: r[6], netflix: !!r[7], jf: !!r[8], pop: 500 - i * 7, overview: `${r[0]}. ${SYN}` }));
const byId = (id) => T.find((t) => t.id === Number(id));
Object.assign(T.find((t) => t.name === 'Sketch Hour'), { net: 1603 });
Object.assign(T.find((t) => t.name === 'Late Night Talk'), { type: 'Talk Show' });
Object.assign(T.find((t) => t.name === 'Island Survivors'), { type: 'Reality' });
const byName = (n) => T.find((t) => t.name === n);
const tmdbItem = (t) => ({ id: t.id, media_type: t.tv ? 'tv' : 'movie', [t.tv ? 'name' : 'title']: t.name, [t.tv ? 'first_air_date' : 'release_date']: t.date, genre_ids: t.genres.map((g) => G[g]), overview: t.overview, poster_path: `/${t.id}.svg`, backdrop_path: `/${t.id}.svg`, popularity: t.pop, vote_average: t.imdb || 0, vote_count: t.imdb ? 5000 : 0, original_language: t.lang });

function art(id) {
  const n = Number(id), t = byId(n), [bg, sh, gr] = PAL[n % 8];
  const m = n % 6;
  const shapes = m === 0 ? `<circle cx="228" cy="62" r="42" fill="${sh}"/>`
    : m === 1 ? `<polygon points="120,110 196,26 272,110" fill="${sh}"/><polygon points="40,110 104,54 168,110" fill="${sh}" opacity=".55"/>`
    : m === 2 ? [0, 1, 2, 3, 4].map((i) => `<rect x="${150 + i * 32}" y="${70 - ((i * 37) % 46)}" width="24" height="${40 + ((i * 37) % 46)}" fill="${sh}"/>`).join('')
    : m === 3 ? [0, 1, 2].map((i) => `<circle cx="230" cy="110" r="${28 + i * 26}" fill="none" stroke="${sh}" stroke-width="10" opacity="${1 - i * 0.28}"/>`).join('')
    : m === 4 ? [0, 1, 2, 3].map((i) => `<polygon points="${150 + i * 42},0 ${176 + i * 42},0 ${116 + i * 42},110 ${90 + i * 42},110" fill="${sh}"/>`).join('')
    : `<rect x="170" y="24" width="86" height="86" fill="${sh}"/><rect x="196" y="50" width="86" height="60" fill="${bg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="1280" height="720"><title>${t?.name ?? ''}</title><rect width="320" height="180" fill="${bg}"/>${shapes}<rect y="110" width="320" height="70" fill="${gr}"/></svg>`;
}

function discover(tv, q) {
  let l = T.filter((t) => t.tv === tv);
  const wg = q.get('with_genres');
  if (wg) {
    const any = wg.split('|').map(Number);
    const alias = { 10759: [28, 12], 10765: [878, 14], 10768: [10752], 10762: [10751], 10764: [] };
    l = l.filter((t) => any.some((g) => t.genres.some((x) => G[x] === g || (alias[g] ?? []).includes(G[x]))));
  }
  if (q.get('with_original_language')) l = l.filter((t) => t.lang === q.get('with_original_language'));
  const TYPES = { 1: 'News', 3: 'Reality', 5: 'Talk Show', 6: 'Video' };
  if (q.get('with_type')) l = l.filter((t) => q.get('with_type').split('|').some((n) => TYPES[n] === t.type));
  if (q.get('with_networks')) l = l.filter((t) => q.get('with_networks').split('|').map(Number).includes(t.net));
  if (q.get('with_watch_providers')) l = l.filter((t) => t.netflix && q.get('with_watch_providers') === '8');
  for (const [p, cmp] of [['primary_release_date.gte', (a, b) => a >= b], ['first_air_date.gte', (a, b) => a >= b], ['primary_release_date.lte', (a, b) => a <= b], ['first_air_date.lte', (a, b) => a <= b]]) {
    if (q.get(p)) l = l.filter((t) => cmp(t.date, q.get(p)));
  }
  if (!q.get('primary_release_date.gte') && !q.get('first_air_date.gte')) l = l.filter((t) => t.date <= day(0));
  if (q.get('sort_by')?.startsWith('vote')) l = [...l].sort((a, b) => b.imdb - a.imdb);
  const page = Number(q.get('page') ?? 1);
  return { page, results: l.slice((page - 1) * 20, page * 20).map(tmdbItem), total_results: l.length };
}

function details(t) {
  return {
    ...tmdbItem(t), genres: t.genres.map((name) => ({ id: G[name], name })), runtime: 112, number_of_seasons: t.tv ? 3 : undefined, seasons: t.tv ? [{ season_number: 0, name: 'Specials', episode_count: 4 }, ...[1, 2, 3].map((n) => ({ season_number: n, name: `Season ${n}`, episode_count: 6 + n }))] : undefined, episode_run_time: [48], created_by: t.tv ? [{ name: 'Ana Morel', profile_path: '/p9300.svg' }] : undefined,
    type: t.tv ? t.type ?? 'Scripted' : undefined, networks: t.tv ? [t.net ? { id: t.net, name: 'C8' } : { id: 213, name: 'Netflix' }] : undefined,
    external_ids: { imdb_id: t.imdb ? `tt${t.id}000` : null }, imdb_id: t.imdb ? `tt${t.id}000` : null,
    keywords: { keywords: [{ name: t.genres[0].toLowerCase() }, { name: `theme ${t.id % 5}` }], results: [{ name: t.genres[0].toLowerCase() }, { name: `theme ${t.id % 5}` }] },
    credits: { cast: [{ id: 9001, name: 'Lea Durand', character: 'Mara (voice)', order: 0, profile_path: '/p9001.svg' }, { id: 9002, name: 'Tom Vega', character: 'The Keeper', order: 1, profile_path: '/p9002.svg' }, { id: 9100 + (t.id % 7), name: `Actor ${t.id % 7}`, character: `Guard ${t.id % 7}`, order: 2, profile_path: null }], crew: [{ job: 'Director', name: `Director ${t.id % 4}` }, { job: 'Producer', name: `Producer ${t.id % 3}`, profile_path: '/p9200.svg' }] },
    // A series' credits over all seasons: Tom Vega plays two roles, the one in the most episodes first once read.
    aggregate_credits: t.tv ? { cast: [{ id: 9001, name: 'Lea Durand', order: 0, profile_path: '/p9001.svg', roles: [{ character: 'Mara (voice)', episode_count: 20 }] }, { id: 9002, name: 'Tom Vega', order: 1, profile_path: '/p9002.svg', roles: [{ character: 'Young Keeper', episode_count: 3 }, { character: 'The Keeper', episode_count: 18 }] }, { id: 9100 + (t.id % 7), name: `Actor ${t.id % 7}`, order: 2, profile_path: null, roles: [{ character: `Guard ${t.id % 7}`, episode_count: 5 }] }] } : undefined,
    videos: { results: t.id % 2 ? [] : [{ site: 'YouTube', type: 'Trailer', key: `yt${t.id}` }] }, release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: ['PG-13', 'R', 'PG'][t.id % 3] }] }] }, content_ratings: { results: [{ iso_3166_1: 'US', rating: ['TV-14', 'TV-MA', 'TV-PG'][t.id % 3] }] },
    'watch/providers': { results: Object.fromEntries(['US', 'FR', 'GB', 'DE', 'ES', 'BE', 'CA'].map((r) => [r, { flatrate: t.netflix ? [{ provider_id: 8 }] : [] }])) },
  };
}

const requests = new Map();
// Fox Run is on the server without a TMDB ID, as some real libraries have titles.
const jfItem = (t, base) => ({ Id: `jf${t.id}`, Name: t.name, Type: t.tv ? 'Series' : 'Movie', ProductionYear: Number(t.date.slice(0, 4)), Overview: t.overview, Genres: t.genres, ProviderIds: t.name === 'Fox Run' ? { Imdb: `tt${t.id}000` } : { Tmdb: String(t.id), Imdb: `tt${t.id}000` }, ImageTags: { Primary: 'x' }, BackdropImageTags: ['x'], CommunityRating: t.imdb, RunTimeTicks: 112 * 60 * 10_000_000, UserData: {}, base });
const jfEpisode = (t, n) => ({ Id: `ep${t.id}-${n}`, Name: `Episode ${n}`, Type: 'Episode', IndexNumber: n, ParentIndexNumber: 1, SeriesId: `jf${t.id}`, SeasonId: `s${t.id}-1`, ImageTags: { Primary: 'x' }, UserData: {} });

/** What the player asked of the stand-in, for the tests to read at /api/jf/_log. */
const jfLog = [];
const jfTokens = new Map(); // DeviceId to its one token.
let jfSignIns = 0;
const SEC = 10_000_000;
/** Two audio tracks; English and French text subtitles; picture subtitles the server would draw in. */
const jfStreams = (id) => [
  { Index: 0, Type: 'Video', Codec: 'vp8' },
  { Index: 1, Type: 'Audio', Language: 'eng', DisplayTitle: 'English - Stereo', IsDefault: true },
  { Index: 2, Type: 'Audio', Language: 'fre', DisplayTitle: 'Français - 5.1' },
  { Index: 3, Type: 'Subtitle', Language: 'eng', DisplayTitle: 'English', IsTextSubtitleStream: true, DeliveryMethod: 'External', DeliveryUrl: `/Videos/${id}/${id}/Subtitles/3/0/Stream.vtt` },
  { Index: 4, Type: 'Subtitle', Language: 'fre', DisplayTitle: 'Français', IsTextSubtitleStream: true, DeliveryMethod: 'External', DeliveryUrl: `/Videos/${id}/${id}/Subtitles/4/0/Stream.vtt` },
  { Index: 5, Type: 'Subtitle', Language: 'eng', DisplayTitle: 'English (PGS)', IsTextSubtitleStream: false, DeliveryMethod: 'Encode' },
];
/** The full item: 40 seconds, like the test video, with chapters and preview pictures. */
function jfFull(id) {
  let m;
  const base = (m = id.match(/^ep(\d+)-(\d+)$/)) ? jfEpisode(byId(m[1]), Number(m[2])) : (m = id.match(/^jf(\d+)$/)) ? jfItem(byId(m[1])) : null;
  if (!base) return null;
  return { ...base, RunTimeTicks: 40 * SEC, Chapters: [{ Name: 'Opening', StartPositionTicks: 0 }, { Name: 'The middle', StartPositionTicks: 20 * SEC }], Trickplay: { [id]: { 320: { Width: 320, Height: 180, TileWidth: 10, TileHeight: 10, ThumbnailCount: 40, Interval: 1000 } } } };
}
const tile = () => `<svg xmlns="http://www.w3.org/2000/svg" width="3200" height="1800">${Array.from({ length: 40 }, (_, n) => `<g transform="translate(${(n % 10) * 320} ${Math.floor(n / 10) * 180})"><rect width="320" height="180" fill="hsl(${n * 9} 50% 30%)"/><text x="160" y="110" font-size="64" fill="#fff" text-anchor="middle" font-family="sans-serif">${n}s</text></g>`).join('')}</svg>`;
const vtt = (lang) => `WEBVTT\n\n00:00:00.500 --> 00:00:39.500\n${lang === 4 ? 'Bonjour du serveur de test' : 'Hello from the test server'}\n`;

function jellyfin(path, q, req, res, send, body = '') {
  const list = T.filter((t) => t.jf);
  if (path === '/_log') return send(jfLog);
  if (path === '/System/Info/Public') return send({ ServerName: 'Test', Version: '12.3.0' });
  // As the real server: one token per DeviceId, so a second sign-in on the same DeviceId ends the first.
  if (path === '/_devices') return send(Object.fromEntries(jfTokens));
  if (path === '/Users/AuthenticateByName') {
    const device = /DeviceId="([^"]*)"/.exec(req.headers.authorization ?? '')?.[1] ?? '';
    const token = `tok${++jfSignIns}`;
    jfTokens.set(decodeURIComponent(device), token);
    return send({ User: { Id: 'u1', Name: 'tester' }, AccessToken: token, ServerId: 's' });
  }
  if (path === '/Users/Me') {
    const token = /Token="([^"]*)"/.exec(req.headers.authorization ?? '')?.[1];
    return token && [...jfTokens.values()].includes(token) ? send({ Id: 'u1', Name: 'tester' }) : send({}, 401);
  }
  if (path.startsWith('/Sessions/Playing')) jfLog.push({ path, ...JSON.parse(body || '{}') });
  if (path === '/Sessions/Logout' || path.startsWith('/Sessions/Playing')) return send({}, 204);
  if (path === '/Items/Latest') return send(list.slice(0, 8).map(jfItem));
  if (path === '/UserItems/Resume') return send({ Items: [], TotalRecordCount: 0 });
  if (path === '/Items') return send({ Items: list.map(jfItem), TotalRecordCount: list.length });
  if (path === '/Shows/NextUp') return send({ Items: [] });
  let m;
  if ((m = path.match(/^\/Shows\/jf(\d+)\/Seasons$/))) return send({ Items: [{ Id: `s${m[1]}-1`, Name: 'Season 1', IndexNumber: 1 }] });
  if ((m = path.match(/^\/Shows\/jf(\d+)\/Episodes$/))) {
    const all = [1, 2, 3, 4, 5, 6].map((n) => jfEpisode(byId(m[1]), n));
    const at = all.findIndex((e) => e.Id === q.get('adjacentTo'));
    return send({ Items: at >= 0 ? all.slice(Math.max(0, at - 1), at + 2) : all });
  }
  if ((m = path.match(/^\/Items\/([^/]+)\/PlaybackInfo$/))) {
    const b = JSON.parse(body || '{}');
    jfLog.push({ path: 'PlaybackInfo', item: m[1], AudioStreamIndex: b.AudioStreamIndex, SubtitleStreamIndex: b.SubtitleStreamIndex, MaxStreamingBitrate: b.MaxStreamingBitrate });
    return send({ PlaySessionId: `p${jfLog.length}`, MediaSources: [{ Id: m[1], Container: 'webm', SupportsDirectPlay: true, MediaStreams: jfStreams(m[1]), DefaultAudioStreamIndex: 1 }] });
  }
  if ((m = path.match(/^\/MediaSegments\/(.+)$/))) {
    const items = [{ Type: 'Intro', StartTicks: 2 * SEC, EndTicks: 12 * SEC }];
    if (m[1].startsWith('ep')) items.push({ Type: 'Outro', StartTicks: 30 * SEC, EndTicks: 40 * SEC });
    return send({ Items: items, TotalRecordCount: items.length });
  }
  if ((m = path.match(/^\/Items\/([a-z]+\d+(?:-\d+)?)$/))) return jfFull(m[1]) ? send(jfFull(m[1])) : send({ message: 'not here' }, 404);
  if (path.match(/^\/Videos\/[^/]+\/Trickplay\/320\/\d+\.jpg$/)) return svg(res, tile());
  if ((m = path.match(/^\/Videos\/[^/]+\/[^/]+\/Subtitles\/(\d+)\/0\/Stream\.vtt$/))) {
    res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end(vtt(Number(m[1])));
  }
  if ((m = path.match(/^\/Items\/[a-z]*(\d+)[^/]*\/Images\//))) return svg(res, art(m[1]));
  if (path.match(/^\/Videos\/[^/]+\/stream/)) return video(req, res);
  return send({ message: 'not here' }, 404);
}

function svg(res, body) {
  res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=3600', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function video(req, res) {
  const size = statSync(VIDEO).size, range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  const h = { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
  if (!range) {
    res.writeHead(200, { ...h, 'Content-Length': size });
    return createReadStream(VIDEO).pipe(res);
  }
  const start = Number(range[1]), end = range[2] ? Number(range[2]) : size - 1;
  res.writeHead(206, { ...h, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
  createReadStream(VIDEO, { start, end }).pipe(res);
}

/** Pages that behave like Netflix's for what we rely on: cookies, a <video>, Back handled by Dholphin. */
const netflixPage = (title, body, script = '') => `<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{margin:0;background:#141414;color:#fff;font:24px sans-serif;padding:48px}video{width:100%;max-height:70vh;background:#000}button{font:inherit;padding:16px 32px}</style><h1 style="color:#E50914">Stand-in for Netflix: ${title}</h1>${body}<script>
const back=()=>{const v=document.querySelector('video');if(v&&v.duration)localStorage.setItem('report',JSON.stringify({positionSec:v.currentTime,durationSec:v.duration}));location.href='/#back'};
addEventListener('keydown',e=>{if(['Escape','GoBack','BrowserBack'].includes(e.key)){e.preventDefault();back()}},true);${script}</script>`;

function netflix(path, res) {
  const html = (b) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(b);
  };
  if (path === '/login') return html(netflixPage('sign in', '<p>Your email and password go here, on Netflix\'s own page.</p><button autofocus onclick="document.cookie=\'NetflixId=demo; path=/\';location.href=\'/api/netflix/browse\'">Sign in</button>'));
  if (path === '/browse') return html(netflixPage('browse', '<p>Signed in.</p>', "if(JSON.parse(sessionStorage.getItem('external')||'{}').intent==='login')back();"));
  return html(netflixPage(path, '<video src="/api/media/test.webm" autoplay muted controls></video><p>Back returns to Dholphin.</p>'));
}

export function createDoubles() {
  return createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname, q = u.searchParams;
    const send = (j, code = 200) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
      res.end(code === 204 ? '' : JSON.stringify(j));
    };
    if (req.method === 'OPTIONS') return send({}, 204);
    if (p === '/config.json') return send({ endpoints: { tmdb: '/api/tmdb/3', images: '/api/img', omdb: '/api/omdb', wikidata: '/api/wikidata', commons: '/api/commons', wikipedia: '/api/wikipedia/{lang}', doblaje: '/api/doblaje', anilist: '/api/anilist', jikan: '/api/jikan', tvmaze: '/api/tvmaze', trakt: '/api/trakt', knowledge: '/api/kg', netflix: '/api/netflix', youtube: '/api/yt', releases: '/api/releases' } });
    // The Android app's latest release, as GitHub's API answers it.
    if (p === '/api/releases') return send({ tag_name: 'v0.9.0+99', body: 'Trailers and a phone form.\nFixes.', assets: [{ name: 'dholphin-0.9.0+99.apk', browser_download_url: '/api/dholphin.apk' }] });
    if (p.startsWith('/api/tmdb/3')) {
      const a = p.slice(11);
      if (!q.get('api_key') && !req.headers.authorization) return send({ status_message: 'No key' }, 401);
      if (q.get('api_key') === 'bad') return send({ status_message: 'Bad key' }, 401);
      if (a === '/genre/movie/list') return send({ genres: [] });
      if (a.startsWith('/trending/')) return send({ results: T.filter((t) => t.date <= day(0)).slice((Number(q.get('page') ?? 1) - 1) * 20, Number(q.get('page') ?? 1) * 20).map(tmdbItem) });
      if (a === '/discover/movie') return send(discover(false, q));
      if (a === '/discover/tv') return send(discover(true, q));
      // A person's page. Tom Vega: a long biography, roles in eight titles, a talk show and an appearance as
      // himself (both left out), and photos. Lea Durand: a biography in English only.
      const m0 = a.match(/^\/person\/(\d+)$/);
      if (m0) {
        const id = Number(m0[1]), en = (q.get('language') ?? '').startsWith('en');
        const name = id === 9002 ? 'Tom Vega' : id === 9001 ? 'Lea Durand' : `Person ${id}`;
        const bio = id === 9002 ? Array(8).fill('Tom Vega grew up by the sea and started on stage before a long career in film and television.').join(' ') : id === 9001 && en ? 'Lea Durand voices animated characters.' : '';
        const roles = T.slice(0, 8).map((t, i) => ({ ...tmdbItem(t), character: `Role ${i}`, vote_count: 1000 - i }));
        return send({ id, name, biography: bio, birthday: '1980-03-14', deathday: null, place_of_birth: 'Lyon, France', known_for_department: 'Acting', profile_path: `/p${id}.svg`,
          combined_credits: { cast: [...roles, { id: 777, media_type: 'tv', name: 'Late Talk', genre_ids: [10767], character: 'Guest', vote_count: 5000, poster_path: '/777.svg' }, { id: 778, media_type: 'movie', title: 'Making Of', genre_ids: [99], character: 'Himself', vote_count: 4000, poster_path: '/778.svg' }], crew: [] },
          images: { profiles: [{ file_path: `/p${id}.svg` }, { file_path: '/150.svg' }, { file_path: '/151.svg' }] } });
      }
      // People for profile pictures: actors with photos, plus a director and an actor without one, both left out.
      if (a === '/person/popular' || a === '/search/person') {
        const page = Number(q.get('page') ?? 1), s = (q.get('query') ?? '').toLowerCase();
        const all = [...Array(30)].map((_, i) => ({ id: 900 + i, name: ['Ava Stone', 'Leo Marsh', 'Mia Grant', 'Noah Reyes', 'Zoe Hart', 'Eli Brooks'][i % 6] + (i >= 6 ? ` ${Math.floor(i / 6) + 1}` : ''), known_for_department: 'Acting', adult: false, profile_path: `/${140 + i}.svg`, known_for: [{ title: T[i % T.length].name }] }));
        all.push({ id: 990, name: 'Dana Director', known_for_department: 'Directing', adult: false, profile_path: '/170.svg', known_for: [] }, { id: 991, name: 'Faceless Actor', known_for_department: 'Acting', adult: false, profile_path: null, known_for: [] });
        const list = a === '/search/person' ? all.filter((x) => x.name.toLowerCase().includes(s)) : page === 1 ? all : [];
        return send({ page, results: list });
      }
      if (a === '/search/multi') {
        const s = (q.get('query') ?? '').toLowerCase();
        return send({ results: [...T.filter((t) => t.name.toLowerCase().includes(s) || t.genres.some((g) => g.toLowerCase().includes(s))).map(tmdbItem), { media_type: 'person', id: 1, name: 'Someone' }] });
      }
      let m;
      // Search by kind and /find by IMDb ID, for titles other sources list.
      if ((m = a.match(/^\/search\/(movie|tv)$/))) {
        const s = (q.get('query') ?? '').toLowerCase();
        return send({ results: T.filter((t) => t.tv === (m[1] === 'tv') && t.name.toLowerCase() === s).map(tmdbItem).map(({ media_type, ...x }) => x) });
      }
      // A season on TMDB: seven episodes, one more than Jellyfin has, with pictures and lengths.
      if ((m = a.match(/^\/tv\/(\d+)\/season\/(\d+)$/))) {
        return send({ episodes: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ episode_number: n, name: `Episode ${n}`, overview: `What happens in episode ${n}.`, still_path: `/${120 + n}.svg`, runtime: 40 + n, air_date: `2024-0${Math.min(9, n)}-15` })) });
      }
      if ((m = a.match(/^\/find\/tt(\d+)000$/))) {
        const t = byId(m[1]);
        return send({ movie_results: t && !t.tv ? [tmdbItem(t)] : [], tv_results: t?.tv ? [tmdbItem(t)] : [] });
      }
      if ((m = a.match(/^\/(movie|tv)\/(\d+)\/(recommendations|similar)$/))) {
        const t = byId(m[2]);
        return send({ results: T.filter((x) => x !== t && x.tv === t?.tv && x.date <= day(0)).sort((a, b) => Number(b.genres.some((g) => t?.genres.includes(g))) - Number(a.genres.some((g) => t?.genres.includes(g)))).map(tmdbItem) });
      }
      if ((m = a.match(/^\/(movie|tv)\/(\d+)$/))) return byId(m[2]) ? send(details(byId(m[2]))) : send({}, 404);
      return send({ status_message: 'not here' }, 404);
    }
    if (p.startsWith('/api/img/')) return svg(res, art(p.match(/(\d+)\.svg$/)?.[1] ?? 100));
    if (p === '/api/omdb') {
      const t = byId(q.get('i')?.match(/tt(\d+)000/)?.[1]);
      return send(t ? { Response: 'True', imdbRating: String(t.imdb), imdbVotes: '50,000', Ratings: [{ Source: 'Rotten Tomatoes', Value: `${t.tom}%` }, { Source: 'Metacritic', Value: `${t.tom - 8}/100` }] } : { Response: 'False' });
    }
    if (p === '/api/wikidata') {
      // Award winners: the newest titles of that kind stand in, by their TMDB IDs.
      if (q.get('query')?.includes('P166')) {
        const tv = q.get('query').includes('P4983');
        return send({ results: { bindings: T.filter((t) => t.tv === tv && t.date <= day(0)).sort((a, b) => b.date.localeCompare(a.date)).map((t) => ({ id: { value: String(t.id) } })) } });
      }
      // Cast: Wild Geometry (an animated film first made in Japanese) has character pictures and English voices.
      if (q.get('query')?.includes('P725')) {
        const id = Number(q.get('query').match(/P49(?:47|83) "(\d+)"/)?.[1]), t = byId(id);
        if (t?.name !== 'Wild Geometry') return send({ results: { bindings: [] } });
        const v = (o) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, { value: String(x) }]));
        const fp = (n) => `http://commons.wikimedia.org/wiki/Special:FilePath/${n}`;
        return send({ results: { bindings: [
          v({ st: 's1', prop: 'voice', actorLabel: 'Lea Durand', tmdb: 9001, charLabel: 'Mara', charImg: fp('Mara%20drawing.png') }),
          v({ st: 's2', prop: 'cast', actorLabel: 'Tom Vega', tmdb: 9002, charLabel: 'The Keeper' }),
          v({ st: 's3', prop: 'voice', actorLabel: 'Sam Rowe', charLabel: 'Mara', charImg: fp('Mara%20drawing.png'), actorImg: fp('Sam%20Rowe.jpg'), lang: 'http://www.wikidata.org/entity/Q1860' }),
          v({ st: 's4', prop: 'voice', actorLabel: 'Q123456', charLabel: 'Nobody', lang: 'http://www.wikidata.org/entity/Q1860' }),
        ] } });
      }
      // Wikipedia articles, through Wikidata's sitelinks: Wild Geometry has one in English.
      if (q.get('query')?.includes('schema:about')) {
        const id = Number(q.get('query').match(/P49(?:47|83) "(\d+)"/)?.[1]);
        return send({ results: { bindings: byId(id)?.name === 'Wild Geometry' && q.get('query').includes('en.wikipedia.org') ? [{ a: { value: 'https://en.wikipedia.org/wiki/Wild_Geometry' } }] : [] } });
      }
      const m = q.get('query')?.match(/tt(\d+)000/), t = m && byId(m[1]);
      return send({ results: { bindings: t?.netflix && t.id % 2 === 0 ? [{ n: { value: `8${t.id}000` } }] : [] } });
    }
    // Wikipedia's API: the article's sections, then a voice cast table as English Wikipedia writes one.
    // Without the Api-User-Agent header Wikimedia asks browser apps for, it refuses, so a missing header shows.
    if (p.startsWith('/api/wikipedia/')) {
      if (!req.headers['api-user-agent']) return send({ error: 'no Api-User-Agent' }, 403);
      if (q.get('prop') === 'sections') return send({ parse: { title: q.get('page'), sections: [{ index: '1', line: 'Plot', toclevel: 1 }, { index: '2', line: 'Voice cast', toclevel: 1 }] } });
      if (q.get('section') === '2') return send({ parse: { wikitext: '== Voice cast ==\n{| class="wikitable"\n! Character !! Japanese !! English\n|-\n| [[Mara (character)|Mara]] || [[Lea Durand]] || [[Sam Rowe]]\n|-\n| The Keeper || Tom Vega || Ana Pike<ref>x</ref>\n|}' } });
      return send({ parse: { wikitext: '' } });
    }
    // Anime from AniList: one title TMDB also has, one it doesn't (left out). TVmaze: a show by IMDb ID. Jikan: down.
    const listAnime = () => send({ data: { Page: { media: [{ format: 'MOVIE', seasonYear: Number(byName('Wild Geometry').date.slice(0, 4)), title: { english: 'Wild Geometry', romaji: 'Wairudo Jiometori' } }, { format: 'TV', seasonYear: 2026, title: { english: 'Comet Garden' } }] } } });
    // One anime's characters and score, for Wild Geometry: Mara's picture, her original and English voices, 81 out of 100.
    if (p === '/api/anilist' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (!body.includes('Media(search')) return listAnime();
        const { variables } = JSON.parse(body);
        if (variables.search !== 'Wild Geometry') return send({ data: { Media: null } }, 404);
        const w = byName('Wild Geometry'), img = (n) => ({ large: `/api/img/w300/${n}.svg` });
        send({ data: { Media: { id: 1, averageScore: 81, popularity: 12345, startDate: { year: Number(w.date.slice(0, 4)) }, characters: { edges: [{ node: { name: { full: 'Mara' }, image: img(131) }, orig: [{ name: { full: 'Lea Durand' }, image: img(132) }], dub: [{ name: { full: 'Sam Rowe' }, image: { large: 'https://s4.anilist.co/file/anilistcdn/staff/large/default.jpg' } }] }] } } } });
      });
      return;
    }
    if (p === '/api/anilist') return listAnime();
    // TVmaze for series: the show by IMDb ID with its rating, and its cast with a photo for the guard TMDB has none of.
    if (p === '/api/tvmaze/lookup/shows') {
      const t = byId(q.get('imdb')?.match(/tt(\d+)000/)?.[1]);
      return t?.tv ? send({ id: 1000 + t.id, name: t.name, rating: { average: 7.7 } }) : send(null, 404);
    }
    if ((p.match(/^\/api\/tvmaze\/shows\/(\d+)\/cast$/))) {
      const t = byId(Number(p.split('/')[4]) - 1000);
      return send([{ person: { name: `Actor ${t.id % 7}`, image: { medium: '/api/img/w300/133.svg' } }, character: { name: `Guard ${t.id % 7}`, image: null } }]);
    }
    // Jikan never answers, as it sometimes doesn't for real: its row and score must give up without holding anything up.
    if (p.startsWith('/api/jikan')) return;
    if (p === '/api/tvmaze/schedule/web') { const t = T.find((x) => x.tv); return send([{ _embedded: { show: { id: 7, name: t.name, premiered: t.date, externals: { imdb: `tt${t.id}000` } } } }]); }
    if (p.startsWith('/api/trakt')) return send([], 401);
    if (p === '/api/doblaje') return send({ query: { search: [] }, parse: { wikitext: '' } });
    if (p === '/api/commons') {
      const titles = (q.get('titles') ?? '').split('|');
      return send({ query: { pages: Object.fromEntries(titles.map((ti, i) => [String(-1 - i), { title: ti, imageinfo: [{ thumburl: `/api/img/w300/${110 + i}.svg`, extmetadata: { Artist: { value: '<a href="x">Test Artist</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] }])) } });
    }
    if (p.startsWith('/api/yt/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><body style="margin:0;background:#123;color:#fff;font:40px sans-serif;display:grid;place-items:center;height:100vh">Trailer ${p.slice(8).replace(/[^\w-]/g, '')}</body>`);
    }
    if (p === '/api/media/test.webm') return video(req, res);
    if (p.startsWith('/api/netflix')) return netflix(p.slice(12) || '/', res);
    if (p.startsWith('/api/jf')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => jellyfin(p.slice(7), q, req, res, send, body));
      return;
    }
    if (p.startsWith('/api/seerr/api/v1')) {
      const a = p.slice(17);
      if (req.headers['x-api-key'] !== 'demo-key') return send({ message: 'Seerr refused the API key' }, 403);
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (a === '/request' && req.method === 'POST') {
          const b = JSON.parse(body);
          const old = requests.get(b.mediaId);
          requests.set(b.mediaId, { status: 3, userId: b.userId, seasons: [...(old?.seasons ?? []), ...(b.seasons === 'all' ? [1, 2, 3] : b.seasons ?? [])] });
          return send({ id: 1, status: 1 }, 201);
        }
        // The Jellyfin user u1 (the stand-in's only one) is Seerr's user 7.
        if (a === '/user/jellyfin/u1') return send({ id: 7, displayName: 'tester' });
        if (a === '/_test/requests') return send([...requests].map(([id, r]) => ({ id, ...r })));
        const m = a.match(/^\/(movie|tv)\/(\d+)$/);
        if (m) return send({ id: Number(m[2]), mediaInfo: requests.has(Number(m[2])) ? { status: requests.get(Number(m[2])).status, seasons: requests.get(Number(m[2])).seasons.map((seasonNumber) => ({ seasonNumber, status: 3 })) } : undefined });
        send({ message: 'not here' }, 404);
      });
      return;
    }
    const file = normalize(join(DIST, p === '/' ? 'index.html' : p));
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) return send({ message: 'not found' }, 404);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json' };
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
}

if (process.argv[1] === import.meta.filename) {
  const port = Number(process.env.PORT ?? 8766);
  const bind = process.env.BIND ?? '127.0.0.1';
  createDoubles().listen(port, bind, () => console.log(`Doubles on http://${bind}:${port}`));
}
