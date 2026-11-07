// Docs: docs/03 - Features/Cast.md
// Purpose: tests for the cast: order, characters from Wikidata, dubbing voices only for another language, Commons credits.
import { describe, expect, it } from 'vitest';
import { buildCast, castQuery, commonsFile, commonsInfo, joinRoles, wikiRows } from './cast';

const img = (p?: string | null) => (p ? `img${p}` : null);
const credits = {
  cast: [{ id: 2, name: 'B', character: 'Second', order: 1 }, { id: 1, name: 'A', character: 'Woody (voice)', order: 0, profile_path: '/a.jpg' }],
  crew: [{ job: 'Director', name: 'D' }, { job: 'Producer', name: 'P', profile_path: '/p.jpg' }],
};
const fp = (n: string) => `http://commons.wikimedia.org/wiki/Special:FilePath/${n}`;
const rows = wikiRows({ results: { bindings: [
  { st: { value: 's1' }, prop: { value: 'voice' }, actorLabel: { value: 'A' }, tmdb: { value: '1' }, charLabel: { value: 'Shérif Woody' }, charImg: { value: fp('Woody%20figure.jpg') } },
  { st: { value: 's1' }, prop: { value: 'voice' }, actorLabel: { value: 'A' }, tmdb: { value: '1' }, charLabel: { value: 'Shérif Woody' }, charImg: { value: fp('Other.jpg') } },
  { st: { value: 's2' }, prop: { value: 'voice' }, actorLabel: { value: 'Jean' }, charLabel: { value: 'Shérif Woody' }, lang: { value: 'http://www.wikidata.org/entity/Q150' } },
  { st: { value: 's3' }, prop: { value: 'voice' }, actorLabel: { value: 'Q99' }, lang: { value: 'http://www.wikidata.org/entity/Q150' } },
] } });

describe('roles', () => {
  it('joins a person\'s roles in order, each once, without voice marks', () => {
    expect(joinRoles(['Bruce Wayne / Batman', 'batman (voice)', '', 'Matches Malone'])).toBe('Bruce Wayne / Batman / Matches Malone');
  });
  it('lists a series actor once, with the role played in the most episodes first', () => {
    const c = buildCast({ kind: 'series', language: 'en' }, { cast: [], aggregate: { cast: [
      { id: 5, name: 'Twin', order: 1, roles: [{ character: 'Guest Twin', episode_count: 2 }, { character: 'Main Twin', episode_count: 40 }] },
      { id: 6, name: 'Lead', order: 0, roles: [{ character: 'Hero', episode_count: 50 }] },
    ] } }, [], 'en', img);
    expect(c.people.map((p) => [p.name, p.role])).toEqual([['Lead', 'Hero'], ['Twin', 'Main Twin / Guest Twin']]);
  });
  it('merges a film actor listed twice, at the first billing', () => {
    const c = buildCast({ kind: 'movie', language: 'en' }, { cast: [{ id: 1, name: 'A', character: 'Young Tom', order: 0 }, { id: 2, name: 'B', character: 'Ann', order: 1 }, { id: 1, name: 'A', character: 'Old Tom', order: 4 }] }, [], 'en', img);
    expect(c.people.map((p) => [p.name, p.role])).toEqual([['A', 'Young Tom / Old Tom'], ['B', 'Ann']]);
  });
  it('shows a dubbing voice once, with every character it voices', () => {
    const c = buildCast({ kind: 'movie', language: 'ja' }, { cast: [{ id: 1, name: 'A', character: 'X', order: 0 }, { id: 2, name: 'B', character: 'Y', order: 1 }] }, [], 'fr', img, [{ voice: 'V', actor: 'A', role: 'X' }, { voice: 'V', actor: 'B', role: 'Y' }]);
    expect(c.voices.map((v) => [v.name, v.role])).toEqual([['V', 'X / Y']]);
  });
});

describe('cast', () => {
  it('asks Wikidata by the TMDB ID, with labels in the profile language', () => {
    const q = castQuery(862, 'movie', 'fr');
    expect(q).toContain('wdt:P4947 "862"');
    expect(q).toContain('"fr,en"');
    expect(castQuery(1, 'tv', 'en')).toContain('wdt:P4983 "1"');
  });
  it('keeps one row per statement and drops unlabelled people', () => {
    expect(rows.map((r) => r.actor)).toEqual(['A', 'Jean']);
    expect(rows[1]!.lang).toBe('Q150');
  });
  it('puts the producer first, then the cast in order, with characters from Wikidata', () => {
    const c = buildCast({ kind: 'movie', language: 'en' }, credits, rows, 'fr', img);
    expect(c.people.map((p) => [p.kind, p.name, p.role])).toEqual([['producer', 'P', ''], ['cast', 'A', 'Shérif Woody'], ['cast', 'B', 'Second']]);
    expect(c.people[1]!.character).toBe(fp('Woody%20figure.jpg'));
    expect(c.people[1]!.photo).toBe('img/a.jpg');
    expect(c.people[2]!.character).toBeNull();
  });
  it('gives dubbing voices only when the title was first made in another language', () => {
    expect(buildCast({ kind: 'movie', language: 'en' }, credits, rows, 'fr', img).voices.map((v) => [v.name, v.role])).toEqual([['Jean', 'Shérif Woody']]);
    expect(buildCast({ kind: 'movie', language: 'fr' }, credits, rows, 'fr', img).voices).toEqual([]);
  });
  it('a series starts with its creators', () => {
    const c = buildCast({ kind: 'series', language: 'en' }, { ...credits, created_by: [{ name: 'C' }], crew: [{ job: 'Executive Producer', name: 'E' }] }, [], 'en', img);
    expect(c.people.slice(0, 2).map((p) => p.kind)).toEqual(['creator', 'producer']);
  });
  it('turns TMDB character notes into names', () => {
    expect(buildCast({ kind: 'movie', language: 'en' }, credits, [], 'en', img).people[1]!.role).toBe('Woody');
  });
  it('reads Commons file names and credits', () => {
    expect(commonsFile(fp('Woody_at%20Park.jpg'))).toBe('Woody at Park.jpg');
    expect(commonsFile('https://image.tmdb.org/x.jpg')).toBeNull();
    const info = commonsInfo({ query: { normalized: [{ from: 'File:A_b.jpg', to: 'File:A b.jpg' }], pages: { '1': { title: 'File:A b.jpg', imageinfo: [{ thumburl: 't.jpg', extmetadata: { Artist: { value: '<a href="u">Jo &amp; Al</a>' }, LicenseShortName: { value: 'CC BY 2.0' } } }] } } } });
    expect(info.get('A_b.jpg')).toEqual({ thumb: 't.jpg', credit: 'Jo & Al, CC BY 2.0' });
  });
});
