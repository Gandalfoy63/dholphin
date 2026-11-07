// Docs: docs/03 - Features/Cast.md
// Purpose: tests for faces and voices from AniList, TVmaze, Wikipedia and Google, and filling without doubles.
import { describe, expect, it } from 'vitest';
import type { Person } from './cast';
import { anilistCast, anilistCastQuery, fill, knowledgePhoto, tvmazeCast, wikiPortraits } from './people';

const person = (name: string, photo: string | null = null): Person => ({ name, kind: 'cast', role: '', photo, character: null });

describe('people from other sources', () => {
  it('reads AniList: original voices with their character, the dub, the score; no placeholder pictures', () => {
    expect(anilistCastQuery('fr')).toContain('dub: voiceActors(language: FRENCH)');
    const a = anilistCast({ data: { Media: { averageScore: 87, popularity: 900, startDate: { year: 2023 }, characters: { edges: [{ node: { name: { full: 'Frieren' }, image: { large: 'c.png' } }, orig: [{ name: { full: 'Atsumi Tanezaki' }, image: { large: 'a.png' } }], dub: [{ name: { full: 'Jessica Barrier' }, image: { large: 'https://x/staff/large/default.jpg' } }] }] } } } });
    expect(a.original).toEqual([{ name: 'Atsumi Tanezaki', photo: 'a.png', character: 'c.png', role: 'Frieren' }]);
    expect(a.dub[0]).toMatchObject({ name: 'Jessica Barrier', photo: null, role: 'Frieren' });
    expect([a.score, a.year]).toEqual([87, 2023]);
  });

  it('reads TVmaze casts and Wikipedia portraits, only for pages about actors', () => {
    expect(tvmazeCast([{ person: { name: 'Bryan Cranston', image: { medium: 'b.jpg' } }, character: { name: 'Walter White', image: null } }])).toEqual([{ name: 'Bryan Cranston', photo: 'b.jpg', character: null, role: 'Walter White' }]);
    const w = wikiPortraits({ query: { normalized: [{ from: 'richard darbois', to: 'Richard darbois' }], redirects: [{ from: 'Richard darbois', to: 'Richard Darbois' }], pages: [{ title: 'Richard Darbois', pageimage: 'R D.jpg', description: 'acteur et comédien de doublage français' }, { title: 'Paris', pageimage: 'P.jpg', description: 'capitale de la France' }] } });
    expect([...w.keys()]).toEqual(['richarddarbois']);
    expect(w.get('richarddarbois')).toContain('Special:FilePath/R%20D.jpg');
  });

  it('takes a Google picture only for the same name described as an actor', () => {
    const j = { itemListElement: [{ result: { name: 'Tom Hanks', description: 'American actor', image: { contentUrl: 'h.jpg', url: 'https://commons/x' } } }] };
    expect(knowledgePhoto(j, 'Tom Hanks')).toEqual({ photo: 'h.jpg', licence: 'https://commons/x' });
    expect(knowledgePhoto(j, 'Tom Hank')).toBeNull();
    expect(knowledgePhoto({ itemListElement: [{ result: { name: 'Tom Hanks', description: 'Footballer', image: { contentUrl: 'f.jpg' } } }] }, 'Tom Hanks')).toBeNull();
  });

  it('fills only what is missing, and never gives one face to two people', () => {
    const people = [person('A', 'have.jpg'), person('B'), person('C')];
    const used = new Set(['have.jpg']);
    fill(people, [{ name: 'a', photo: 'other.jpg' }, { name: 'B', photo: 'have.jpg' }, { name: 'C', photo: 'c.jpg', character: 'x.png' }], used);
    expect(people.map((p) => [p.photo, p.character])).toEqual([['have.jpg', null], [null, null], ['c.jpg', 'x.png']]);
  });
});
