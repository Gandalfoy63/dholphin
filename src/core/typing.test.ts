// Docs: docs/05 - UI-UX/Focus and Remote.md
// Purpose: tests typing in other scripts: kana marks, Hangul syllables, pinyin candidates.
import { describe, expect, it } from 'vitest';
import { hangul, kanaMark, katakana, pinyinCandidates, type Syllable } from './typing';

/** Types jamo one by one into a string, as the keyboard does. */
function typeKo(jamo: string) {
  let text = '', open: Syllable | null = null;
  for (const j of jamo) {
    const r = hangul(open, j);
    text = text.slice(0, text.length - r.edit.drop) + r.edit.add;
    open = r.open;
  }
  return text;
}

describe('kana marks', () => {
  it('voices, half-voices and shrinks the last kana, and undoes it', () => {
    expect(kanaMark('か', '゛')).toBe('が');
    expect(kanaMark('が', '゛')).toBe('か');
    expect(kanaMark('は', '゜')).toBe('ぱ');
    expect(kanaMark('ば', '゜')).toBe('ぱ');
    expect(kanaMark('ぱ', '゜')).toBe('は');
    expect(kanaMark('ぱ', '゛')).toBe('ば');
    expect(kanaMark('つ', '小')).toBe('っ');
    expect(kanaMark('ゃ', '小')).toBe('や');
    expect(kanaMark('な', '゛')).toBeNull();
    expect(kanaMark(null, '゛')).toBeNull();
  });
  it('works the same in katakana', () => {
    expect(katakana('かぱっ')).toBe('カパッ');
    expect(kanaMark('カ', '゛')).toBe('ガ');
    expect(kanaMark('ツ', '小')).toBe('ッ');
  });
});

describe('Hangul', () => {
  it('assembles syllables from jamo', () => {
    expect(typeKo('ㅎㅏㄴㄱㅜㄱ')).toBe('한국');
    expect(typeKo('ㅅㅏㄹㅏㅇ')).toBe('사랑');
  });
  it('moves a final onto the next vowel, and splits a double final', () => {
    expect(typeKo('ㄱㅏㅂㅏ')).toBe('가바');
    expect(typeKo('ㅇㅣㄹㄱㅓ')).toBe('일거');
    expect(typeKo('ㄷㅏㄹㄱ')).toBe('닭');
  });
  it('joins double vowels', () => {
    expect(typeKo('ㄱㅗㅏ')).toBe('과');
    expect(typeKo('ㅇㅡㅣ')).toBe('의');
  });
  it('keeps a lone jamo', () => {
    expect(typeKo('ㅏ')).toBe('ㅏ');
    expect(typeKo('ㄱㄴ')).toBe('ㄱㄴ');
  });
});

describe('pinyin', () => {
  const table = { zhong: '中种重', zhang: '张长', zhi: '之知', ren: '人认' };
  it('lists the reading typed first, then readings it starts', () => {
    expect(pinyinCandidates(table, 'zhong')).toEqual(['中', '种', '重']);
    expect(pinyinCandidates(table, 'zh', 4)).toEqual(['中', '张', '之', '种']);
    expect(pinyinCandidates(table, '')).toEqual([]);
  });
});
