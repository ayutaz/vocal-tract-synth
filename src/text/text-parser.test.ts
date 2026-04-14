// ============================================================================
// Phase 8: text-parser のユニットテスト
// ============================================================================
//
// 検証項目:
//   - 全 110 エントリ (清音 46 / 濁音 20 / 半濁音 5 / 拗音 36 / 特殊拍 3) の
//     ひらがな → 音素変換が期待通り
//   - 拗音は単一トークンとして扱われる (2 文字最長一致)
//   - 撥音「ん」の lookahead allophone 切替 ([m]/[n]/[ŋ]/[ɴ])
//   - 促音「っ」・長音「ー」のマーカー検出
//   - 句読点 → ポーズトークンへの変換
//   - 未知文字 (カタカナ・半角英字) は無視される
//   - 最終トークンのみ isLast = true
// ============================================================================

import { describe, it, expect } from 'vitest';
import { parseHiragana, resolveHatsuonAllophones } from './text-parser';

// ---------------------------------------------------------------------------
// 1. 全清音 46 字
// ---------------------------------------------------------------------------

describe('parseHiragana - 全清音 46 字', () => {
  const cases: Array<[string, string[]]> = [
    ['あ', ['a']], ['い', ['i']], ['う', ['ɯ']], ['え', ['e']], ['お', ['o']],
    ['か', ['k', 'a']], ['き', ['k', 'i']], ['く', ['k', 'ɯ']], ['け', ['k', 'e']], ['こ', ['k', 'o']],
    ['さ', ['s', 'a']], ['し', ['ɕ', 'i']], ['す', ['s', 'ɯ']], ['せ', ['s', 'e']], ['そ', ['s', 'o']],
    ['た', ['t', 'a']], ['ち', ['tɕ', 'i']], ['つ', ['ts', 'ɯ']], ['て', ['t', 'e']], ['と', ['t', 'o']],
    ['な', ['n', 'a']], ['に', ['ɲ', 'i']], ['ぬ', ['n', 'ɯ']], ['ね', ['n', 'e']], ['の', ['n', 'o']],
    ['は', ['h', 'a']], ['ひ', ['ç', 'i']], ['ふ', ['ɸ', 'ɯ']], ['へ', ['h', 'e']], ['ほ', ['h', 'o']],
    ['ま', ['m', 'a']], ['み', ['m', 'i']], ['む', ['m', 'ɯ']], ['め', ['m', 'e']], ['も', ['m', 'o']],
    ['や', ['j', 'a']], ['ゆ', ['j', 'ɯ']], ['よ', ['j', 'o']],
    ['ら', ['ɾ', 'a']], ['り', ['ɾ', 'i']], ['る', ['ɾ', 'ɯ']], ['れ', ['ɾ', 'e']], ['ろ', ['ɾ', 'o']],
    ['わ', ['w', 'a']], ['を', ['o']],
    ['ん', ['N']],
  ];

  it('清音は全 46 字を網羅している', () => {
    expect(cases.length).toBe(46);
  });

  it.each(cases)('%s → %j', (kana, expected) => {
    const tokens = parseHiragana(kana);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.source).toBe(kana);
    expect(tokens[0]!.phonemes).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// 2. 全濁音 20 字
// ---------------------------------------------------------------------------

describe('parseHiragana - 全濁音 20 字', () => {
  const cases: Array<[string, string[]]> = [
    ['が', ['g', 'a']], ['ぎ', ['g', 'i']], ['ぐ', ['g', 'ɯ']], ['げ', ['g', 'e']], ['ご', ['g', 'o']],
    ['ざ', ['z', 'a']], ['じ', ['dʑ', 'i']], ['ず', ['dz', 'ɯ']], ['ぜ', ['z', 'e']], ['ぞ', ['z', 'o']],
    ['だ', ['d', 'a']], ['ぢ', ['dʑ', 'i']], ['づ', ['dz', 'ɯ']], ['で', ['d', 'e']], ['ど', ['d', 'o']],
    ['ば', ['b', 'a']], ['び', ['b', 'i']], ['ぶ', ['b', 'ɯ']], ['べ', ['b', 'e']], ['ぼ', ['b', 'o']],
  ];

  it('濁音は全 20 字を網羅している', () => {
    expect(cases.length).toBe(20);
  });

  it.each(cases)('%s → %j', (kana, expected) => {
    const tokens = parseHiragana(kana);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.source).toBe(kana);
    expect(tokens[0]!.phonemes).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// 3. 全半濁音 5 字
// ---------------------------------------------------------------------------

describe('parseHiragana - 全半濁音 5 字', () => {
  const cases: Array<[string, string[]]> = [
    ['ぱ', ['p', 'a']], ['ぴ', ['p', 'i']], ['ぷ', ['p', 'ɯ']], ['ぺ', ['p', 'e']], ['ぽ', ['p', 'o']],
  ];

  it('半濁音は全 5 字を網羅している', () => {
    expect(cases.length).toBe(5);
  });

  it.each(cases)('%s → %j', (kana, expected) => {
    const tokens = parseHiragana(kana);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.source).toBe(kana);
    expect(tokens[0]!.phonemes).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// 4. 全拗音 (33 組)
// ---------------------------------------------------------------------------
//
// 注: 仕様書の本文には「拗音 36 組」とあるが、実際に列挙されている
// 表のエントリは 11 子音行 × 3 母音 = 33 組である。
// (ぢゃ/ぢゅ/ぢょ は じゃ/じゅ/じょ と発音が同一なので統合され、
//  ヴァ・くゎ等の特殊拍は対象外。)
// 仕様書 3.1.1 に掲載された 33 エントリを完全網羅する。

describe('parseHiragana - 全拗音 33 組', () => {
  const cases: Array<[string, string[]]> = [
    ['きゃ', ['kj', 'a']], ['きゅ', ['kj', 'ɯ']], ['きょ', ['kj', 'o']],
    ['しゃ', ['ɕ', 'a']], ['しゅ', ['ɕ', 'ɯ']], ['しょ', ['ɕ', 'o']],
    ['ちゃ', ['tɕ', 'a']], ['ちゅ', ['tɕ', 'ɯ']], ['ちょ', ['tɕ', 'o']],
    ['にゃ', ['ɲ', 'a']], ['にゅ', ['ɲ', 'ɯ']], ['にょ', ['ɲ', 'o']],
    ['ひゃ', ['ç', 'a']], ['ひゅ', ['ç', 'ɯ']], ['ひょ', ['ç', 'o']],
    ['みゃ', ['mj', 'a']], ['みゅ', ['mj', 'ɯ']], ['みょ', ['mj', 'o']],
    ['りゃ', ['ɾj', 'a']], ['りゅ', ['ɾj', 'ɯ']], ['りょ', ['ɾj', 'o']],
    ['ぎゃ', ['gj', 'a']], ['ぎゅ', ['gj', 'ɯ']], ['ぎょ', ['gj', 'o']],
    ['じゃ', ['dʑ', 'a']], ['じゅ', ['dʑ', 'ɯ']], ['じょ', ['dʑ', 'o']],
    ['びゃ', ['bj', 'a']], ['びゅ', ['bj', 'ɯ']], ['びょ', ['bj', 'o']],
    ['ぴゃ', ['pj', 'a']], ['ぴゅ', ['pj', 'ɯ']], ['ぴょ', ['pj', 'o']],
  ];

  it('拗音は仕様書記載の 33 組を網羅している', () => {
    expect(cases.length).toBe(33);
  });

  it.each(cases)('%s → 単一トークン %j', (kana, expected) => {
    const tokens = parseHiragana(kana);
    // 拗音は 2 文字最長一致で「単一トークン」になることを検証
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.source).toBe(kana);
    expect(tokens[0]!.phonemes).toEqual(expected);
    expect(tokens[0]!.category).toBe('palatalized');
  });
});

// ---------------------------------------------------------------------------
// 5. 撥音「ん」の lookahead allophone 切替
// ---------------------------------------------------------------------------

describe('resolveHatsuonAllophones - 撥音 4 パターン', () => {
  it('さんま → [s, a, m, m, a] (両唇音 m 前 → m)', () => {
    const tokens = resolveHatsuonAllophones(parseHiragana('さんま'));
    const flat = tokens.flatMap((t) => t.phonemes);
    expect(flat).toEqual(['s', 'a', 'm', 'm', 'a']);
  });

  it('さんた → [s, a, n, t, a] (歯茎音 t 前 → n)', () => {
    const tokens = resolveHatsuonAllophones(parseHiragana('さんた'));
    const flat = tokens.flatMap((t) => t.phonemes);
    expect(flat).toEqual(['s', 'a', 'n', 't', 'a']);
  });

  it('さんか → [s, a, ŋ, k, a] (軟口蓋音 k 前 → ŋ)', () => {
    const tokens = resolveHatsuonAllophones(parseHiragana('さんか'));
    const flat = tokens.flatMap((t) => t.phonemes);
    expect(flat).toEqual(['s', 'a', 'ŋ', 'k', 'a']);
  });

  it('さん → [s, a, ɴ] (語末 → ɴ)', () => {
    const tokens = resolveHatsuonAllophones(parseHiragana('さん'));
    const flat = tokens.flatMap((t) => t.phonemes);
    expect(flat).toEqual(['s', 'a', 'ɴ']);
  });

  it('さんあ → [s, a, ɴ, a] (母音前 → ɴ)', () => {
    const tokens = resolveHatsuonAllophones(parseHiragana('さんあ'));
    const flat = tokens.flatMap((t) => t.phonemes);
    expect(flat).toEqual(['s', 'a', 'ɴ', 'a']);
  });

  it('ポーズの直前の撥音は ɴ に展開される', () => {
    const tokens = resolveHatsuonAllophones(parseHiragana('さん。'));
    // [s,a] + [ɴ] + [PAUSE_LONG]
    expect(tokens).toHaveLength(3);
    expect(tokens[1]!.phonemes).toEqual(['ɴ']);
    expect(tokens[2]!.category).toBe('pause');
  });

  it('濁音 g 前の撥音は ŋ になる (さんが → s,a,ŋ,g,a)', () => {
    const tokens = resolveHatsuonAllophones(parseHiragana('さんが'));
    const flat = tokens.flatMap((t) => t.phonemes);
    expect(flat).toEqual(['s', 'a', 'ŋ', 'g', 'a']);
  });

  it('p 前の撥音は m になる (さんぱ → s,a,m,p,a)', () => {
    const tokens = resolveHatsuonAllophones(parseHiragana('さんぱ'));
    const flat = tokens.flatMap((t) => t.phonemes);
    expect(flat).toEqual(['s', 'a', 'm', 'p', 'a']);
  });

  it('拗音 kj 前の撥音は ŋ になる (さんきゃ → s,a,ŋ,kj,a)', () => {
    const tokens = resolveHatsuonAllophones(parseHiragana('さんきゃ'));
    const flat = tokens.flatMap((t) => t.phonemes);
    expect(flat).toEqual(['s', 'a', 'ŋ', 'kj', 'a']);
  });
});

// ---------------------------------------------------------------------------
// 6. 促音「っ」と長音「ー」の検出
// ---------------------------------------------------------------------------

describe('parseHiragana - 促音・長音', () => {
  it('ちょっと → 「ちょ」「っ」「と」 (促音マーカー Q が単独トークン)', () => {
    const tokens = parseHiragana('ちょっと');
    expect(tokens).toHaveLength(3);

    expect(tokens[0]!.source).toBe('ちょ');
    expect(tokens[0]!.phonemes).toEqual(['tɕ', 'o']);
    expect(tokens[0]!.category).toBe('palatalized');

    expect(tokens[1]!.source).toBe('っ');
    expect(tokens[1]!.phonemes).toEqual(['Q']);
    expect(tokens[1]!.category).toBe('sokuon');

    expect(tokens[2]!.source).toBe('と');
    expect(tokens[2]!.phonemes).toEqual(['t', 'o']);
  });

  it('にゃーん → 「にゃ」「ー」「ん」 (長音マーカー R が単独トークン)', () => {
    const tokens = parseHiragana('にゃーん');
    expect(tokens).toHaveLength(3);

    expect(tokens[0]!.source).toBe('にゃ');
    expect(tokens[0]!.phonemes).toEqual(['ɲ', 'a']);
    expect(tokens[0]!.category).toBe('palatalized');

    expect(tokens[1]!.source).toBe('ー');
    expect(tokens[1]!.phonemes).toEqual(['R']);
    expect(tokens[1]!.category).toBe('choon');

    expect(tokens[2]!.source).toBe('ん');
    expect(tokens[2]!.phonemes).toEqual(['N']);
    expect(tokens[2]!.category).toBe('hatsuon');
  });
});

// ---------------------------------------------------------------------------
// 7. 句読点 → ポーズトークン
// ---------------------------------------------------------------------------

describe('parseHiragana - 句読点ポーズ', () => {
  it('こんにちは、さようなら。 でポーズトークンが 2 個 (読点 + 句点)', () => {
    const tokens = parseHiragana('こんにちは、さようなら。');
    const pauseTokens = tokens.filter((t) => t.category === 'pause');
    expect(pauseTokens).toHaveLength(2);

    // 読点 → PAUSE_SHORT
    expect(pauseTokens[0]!.source).toBe('、');
    expect(pauseTokens[0]!.phonemes).toEqual(['PAUSE_SHORT']);

    // 句点 → PAUSE_LONG
    expect(pauseTokens[1]!.source).toBe('。');
    expect(pauseTokens[1]!.phonemes).toEqual(['PAUSE_LONG']);
  });

  it('げんき？ で疑問符が PAUSE_MID トークンになる', () => {
    const tokens = parseHiragana('げんき？');
    const pauseTokens = tokens.filter((t) => t.category === 'pause');
    expect(pauseTokens).toHaveLength(1);
    expect(pauseTokens[0]!.source).toBe('？');
    expect(pauseTokens[0]!.phonemes).toEqual(['PAUSE_MID']);
  });

  it('感嘆符 ！ も PAUSE_MID トークンになる', () => {
    const tokens = parseHiragana('やあ！');
    const pauseTokens = tokens.filter((t) => t.category === 'pause');
    expect(pauseTokens).toHaveLength(1);
    expect(pauseTokens[0]!.source).toBe('！');
    expect(pauseTokens[0]!.phonemes).toEqual(['PAUSE_MID']);
  });

  it('半角句読点 . , ? ! も認識される', () => {
    const tokens = parseHiragana('あ.い,う?え!');
    const pauseTokens = tokens.filter((t) => t.category === 'pause');
    expect(pauseTokens).toHaveLength(4);
    expect(pauseTokens[0]!.phonemes).toEqual(['PAUSE_LONG']);
    expect(pauseTokens[1]!.phonemes).toEqual(['PAUSE_SHORT']);
    expect(pauseTokens[2]!.phonemes).toEqual(['PAUSE_MID']);
    expect(pauseTokens[3]!.phonemes).toEqual(['PAUSE_MID']);
  });
});

// ---------------------------------------------------------------------------
// 8. 未知文字の無視
// ---------------------------------------------------------------------------

describe('parseHiragana - 未知文字無視', () => {
  it('あカタa → 「あ」のみ 1 トークン (カタカナ・半角英字は無視)', () => {
    const tokens = parseHiragana('あカタa');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.source).toBe('あ');
    expect(tokens[0]!.phonemes).toEqual(['a']);
  });

  it('空文字列は空配列を返す', () => {
    expect(parseHiragana('')).toEqual([]);
  });

  it('全て未知文字なら空配列を返す', () => {
    expect(parseHiragana('ABCXYZ漢字')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 9. isLast フラグ
// ---------------------------------------------------------------------------

describe('parseHiragana - isLast フラグ', () => {
  it('最終トークンのみ isLast = true', () => {
    const tokens = parseHiragana('あいう');
    expect(tokens).toHaveLength(3);
    expect(tokens[0]!.isLast).toBe(false);
    expect(tokens[1]!.isLast).toBe(false);
    expect(tokens[2]!.isLast).toBe(true);
  });

  it('単一トークンでも isLast = true', () => {
    const tokens = parseHiragana('あ');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.isLast).toBe(true);
  });

  it('句読点を含む場合も最終トークンのみ true', () => {
    const tokens = parseHiragana('あ、い。');
    expect(tokens).toHaveLength(4); // あ 、 い 。
    for (let i = 0; i < tokens.length - 1; i++) {
      expect(tokens[i]!.isLast).toBe(false);
    }
    expect(tokens[tokens.length - 1]!.isLast).toBe(true);
  });

  it('空配列なら isLast を付与しない (例外を投げない)', () => {
    expect(parseHiragana('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 10. position フィールド
// ---------------------------------------------------------------------------

describe('parseHiragana - position フィールド', () => {
  it('単純な並びでは position が連番になる', () => {
    const tokens = parseHiragana('あいう');
    expect(tokens[0]!.position).toBe(0);
    expect(tokens[1]!.position).toBe(1);
    expect(tokens[2]!.position).toBe(2);
  });

  it('拗音 (2 文字) を含む場合、position は元テキストの先頭 index', () => {
    // き(0) ゃ(1) と(2)
    const tokens = parseHiragana('きゃと');
    expect(tokens).toHaveLength(2);
    expect(tokens[0]!.source).toBe('きゃ');
    expect(tokens[0]!.position).toBe(0);
    expect(tokens[1]!.source).toBe('と');
    expect(tokens[1]!.position).toBe(2);
  });
});
