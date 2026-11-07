// Docs: docs/03 - Features/Cast.md
// Purpose: tests for dubbing credits read from wikitext, with snippets as Wikipedia and the Doblaje Wiki write them.
import { describe, expect, it } from 'vitest';
import { buildCast } from './cast';
import { articleQuery, articleTitle, doblajeMatches, dubCredits, dubSections, plain } from './dubbing';

const pairs = (w: string, l: string) => dubCredits(w, l).map((c) => [c.voice, c.actor ?? '', c.role ?? '']);

describe('dubbing', () => {
  it('reads French Wikipedia: the Doublage template, the (VF : …) form, a voices list', () => {
    const w = `== Distribution ==
* [[Leonardo DiCaprio]] {{Doublage|VF=Damien Ferrette|VQ=Joël Legendre}} : Dominic « Dom » Cobb, l'extracteur
* [[Ken Watanabe]] <small>(VF : [[Tōru Tanabe]] ; VQ : Stéphane Rivard)</small> : Mr. Saito
* [[Marion Cotillard]] <small>(VF et VQ : elle-même)</small> : Mal Cobb
* [[Tom Berenger]] : Browning
=== Voix françaises ===
{{colonnes|nombre=2|
* [[Jacques Ferrière]] : [[M. Patate (jouet)|{{M.|Patate}}]]
* Rebecca Dreyfus : la Bergère
** Voix additionnelles : [[Thierry Wermuth]]
}}`;
    expect(pairs(w, 'fr')).toEqual([
      ['Damien Ferrette', 'Leonardo DiCaprio', 'Dominic « Dom » Cobb'],
      ['Tōru Tanabe', 'Ken Watanabe', 'Mr. Saito'],
      ['Jacques Ferrière', '', 'M. Patate'],
      ['Rebecca Dreyfus', '', 'la Bergère'],
    ]);
  });

  it('reads German tables, whose header comes from a template', () => {
    const w = `{| {{Kopfzeile Synchronisation|class=float-right sortable}}<ref name="s" />
|-
| {{PersonZelle|Dominick „Dom“|Cobb|nl=1}}
| {{PersonZelle|Leonardo|DiCaprio}}
| {{PersonZelle|Gerrit|Schmidt-Foß}}
|-
| Specki<br>(engl. Hamm)
| [[John Ratzenberger]]
| [[Michael Rüth]]
|}`;
    expect(pairs(w, 'de')).toEqual([['Gerrit Schmidt-Foß', 'Leonardo DiCaprio', 'Dominick „Dom“ Cobb'], ['Michael Rüth', 'John Ratzenberger', 'Specki']]);
  });

  it('reads Italian prose and the infobox voices', () => {
    const prose = '* [[Sceriffo Woody|Woody]] (doppiato da [[Tom Hanks]] in inglese e da [[Fabrizio Frizzi]] in italiano) – È il protagonista.';
    expect(pairs(prose, 'it')).toEqual([['Fabrizio Frizzi', 'Tom Hanks', 'Woody']]);
    const box = `|attori =\n* [[Tom Hardy]]: Eames\n|doppiatori italiani =\n* [[Francesco Pezzulli]]: Dominic "Dom" Cobb\n|fotografo = [[Wally Pfister]]`;
    expect(pairs(box, 'it')).toEqual([['Francesco Pezzulli', '', 'Dominic "Dom" Cobb']]);
  });

  it('reads Spanish tables, Spain first, and the Doblaje Wiki', () => {
    const es = `{| class="wikitable"\n! '''Personaje'''\n! '''Actor original'''\n! '''Voz Española'''\n! '''Voz hispanoamericana'''\n|-\n|'''[[Walter White|Walter White / Heisenberg]]'''\n|[[Bryan Cranston]]\n|[[Miguel Ayones]]\n|Otro\n|}`;
    expect(pairs(es, 'es')).toEqual([['Miguel Ayones', 'Bryan Cranston', 'Walter White / Heisenberg']]);
    const dob = `{| width="80%"\n|- style="background: #ccf;"\n! width="5%" |Imagen\n!Personaje\n!Actor de voz original\n!Actor de doblaje\n|-\n| style="padding:0;" |[[Archivo:Woody - TSR.png|75px]]\n|[[Woody]]\n|[[Tom Hanks]]\n|[[Carlos Segundo]]\n|}`;
    expect(pairs(dob, 'es')).toEqual([['Carlos Segundo', 'Tom Hanks', 'Woody']]);
    const box = (f: string) => `{{Infobox\n|titulo = El origen\n${f}}}`;
    expect(doblajeMatches(box('|titulo_orig = Inception\n|año = 2010\n'), ['Inception'], 2010)).toBe(true);
    expect(doblajeMatches(box('|titulo_orig = Inception\n|año = 1990\n'), ['Inception'], 2010)).toBe(false);
    expect(doblajeMatches(box('|titulo_orig = 千と千尋の神隠し<br />(Sen to Chihiro)\n'), ['千と千尋の神隠し'], 2001)).toBe(true);
    expect(doblajeMatches(box('|titulo_orig =\n|año = 2010<br /><small>(EE. UU.)</small>\n'), ['Inception', 'El origen'], 2010)).toBe(true);
    expect(doblajeMatches(box(''), ['El origen'], 2010)).toBe(false);
  });

  it('picks the sections that can hold voices, not the casting story', () => {
    const s = [{ index: '1', line: 'Synopsis', toclevel: 1 }, { index: '3', line: 'Distribution', toclevel: 1 }, { index: '4', line: 'Voix françaises', toclevel: 2 }, { index: '7', line: 'Choix des interprètes', toclevel: 2 }];
    expect(dubSections(s, 'fr')).toEqual(['3']);
    expect(dubSections(s, 'it')).toEqual(['0']);
    expect(dubSections(s, 'xx')).toEqual([]);
  });

  it('finds the article through Wikidata and cleans wikitext', () => {
    expect(articleQuery(27205, 'movie', 'de')).toContain('<https://de.wikipedia.org/>');
    expect(articleTitle({ results: { bindings: [{ a: { value: 'https://fr.wikipedia.org/wiki/Parasite_(film,_2019)' } }] } })).toBe('Parasite (film, 2019)');
    expect(plain("'''[[A|B]]'''<ref>x</ref> {{Mme|Davis}}")).toBe('B Mme Davis');
  });

  it('puts the voices in billing order, with the role in the profile language', () => {
    const credits = { cast: [{ id: 1, name: 'Tom Hanks', character: 'Woody (voice)', order: 0 }, { id: 2, name: 'Tim Allen', character: 'Buzz Lightyear (voice)', order: 1 }] };
    const dubs = [{ voice: 'Richard Darbois', role: "Buzz l'Éclair" }, { voice: 'Jean-Philippe Puymartin', role: 'Woody' }, { voice: 'Autre', actor: 'Tim Allen' }];
    const c = buildCast({ kind: 'movie', language: 'en' }, credits, [], 'fr', () => null, dubs);
    expect(c.voices.map((v) => [v.name, v.role])).toEqual([['Jean-Philippe Puymartin', 'Woody'], ['Autre', 'Buzz Lightyear'], ['Richard Darbois', "Buzz l'Éclair"]]);
    expect(buildCast({ kind: 'movie', language: 'fr' }, credits, [], 'fr', () => null, dubs).voices).toEqual([]);
  });
});
