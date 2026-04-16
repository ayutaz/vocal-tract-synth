// ============================================================================
// Phase 8: phoneme-timeline.ts のユニットテスト
// ----------------------------------------------------------------------------
// テスト項目:
//  - 速度係数 0.5x/1.0x/2.0x で総 duration が比例変化
//  - 文末下降 (非疑問文)
//  - 疑問文末尾上昇
//  - Declination (文後半が文頭より低い)
//  - 基本カテゴリ持続時間
//  - ポーズ (句点 400ms / 読点 200ms)
//  - 長音「ー」での直前母音延長
//  - 促音「っ」での silence イベント生成
//  - 拗音の展開
//  - generateTimeline 5ms 以内 (20 音素)
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  generateTimeline,
  computeF0,
  expandTokens,
} from './phoneme-timeline';
import {
  DEFAULT_PROSODY,
  NUM_CONTROL_POINTS,
  type PhonemeToken,
  type TimelineOptions,
  type PhonemeEvent,
  type ProsodyOptions,
} from '../types/index';

// ----------------------------------------------------------------------------
// テストヘルパー
// ----------------------------------------------------------------------------

function makeOpts(overrides: Partial<TimelineOptions> = {}): TimelineOptions {
  return {
    rate: 1.0,
    prosody: { ...DEFAULT_PROSODY },
    isQuestion: false,
    ...overrides,
  };
}

/** トークンビルダ — 「あ」 */
function vowelTok(phoneme: 'a' | 'i' | 'ɯ' | 'e' | 'o', isLast = false): PhonemeToken {
  return {
    source: phoneme,
    phonemes: [phoneme],
    category: 'vowel',
    isLast,
    position: 0,
  };
}

/** トークンビルダ — 子音 (例: /s/) */
function consonantTok(
  ipa: string,
  category: PhonemeToken['category'],
  isLast = false,
): PhonemeToken {
  return {
    source: ipa,
    phonemes: [ipa],
    category,
    isLast,
    position: 0,
  };
}

/** トークンビルダ — 拗音 (例: 「きゃ」 = [kj, a]) */
function palatalizedTok(cons: string, vowel: string, isLast = false): PhonemeToken {
  return {
    source: cons + vowel,
    phonemes: [cons, vowel],
    category: 'palatalized',
    isLast,
    position: 0,
  };
}

/** トークンビルダ — 撥音 ん */
function hatsuonTok(allophone = 'n', isLast = false): PhonemeToken {
  return {
    source: 'ん',
    phonemes: [allophone],
    category: 'hatsuon',
    isLast,
    position: 0,
  };
}

/** トークンビルダ — 促音 っ */
function sokuonTok(): PhonemeToken {
  return {
    source: 'っ',
    phonemes: ['Q'],
    category: 'sokuon',
    isLast: false,
    position: 0,
  };
}

/** トークンビルダ — 長音 ー */
function choonTok(): PhonemeToken {
  return {
    source: 'ー',
    phonemes: ['R'],
    category: 'choon',
    isLast: false,
    position: 0,
  };
}

/** トークンビルダ — ポーズ */
function pauseTok(kind: 'PAUSE_LONG' | 'PAUSE_SHORT' | 'PAUSE_MID'): PhonemeToken {
  return {
    source: kind === 'PAUSE_LONG' ? '。' : kind === 'PAUSE_SHORT' ? '、' : '?',
    phonemes: [kind],
    category: 'pause',
    isLast: false,
    position: 0,
  };
}

/** events の総 duration */
function totalDuration(events: PhonemeEvent[]): number {
  return events.reduce((sum, e) => sum + e.duration, 0);
}

// ============================================================================
// 1. 速度係数による持続時間スケーリング
// ============================================================================

describe('generateTimeline - 速度係数', () => {
  // 「あいうえお」5 母音
  const tokens: PhonemeToken[] = [
    vowelTok('a'),
    vowelTok('i'),
    vowelTok('ɯ'),
    vowelTok('e'),
    vowelTok('o', true),
  ];

  it('rate=1.0 で母音 140ms ベース ＋ 文位置補正', () => {
    const events = generateTimeline(tokens, makeOpts({ rate: 1.0 }));
    expect(events.length).toBe(5);
    // 文中の母音 (i, u, e) は 140ms × 1.0 = 0.14s
    expect(events[1]!.duration).toBeCloseTo(0.14, 5);
    expect(events[2]!.duration).toBeCloseTo(0.14, 5);
    expect(events[3]!.duration).toBeCloseTo(0.14, 5);
    // 文頭は 140ms × 1.2 = 0.168s
    expect(events[0]!.duration).toBeCloseTo(0.168, 5);
    // 文末は 140ms × 1.5 = 0.21s
    expect(events[4]!.duration).toBeCloseTo(0.21, 5);
  });

  it('速度係数 0.5x / 1.0x / 2.0x で総 duration が反比例', () => {
    const e1 = generateTimeline(tokens, makeOpts({ rate: 1.0 }));
    const eHalf = generateTimeline(tokens, makeOpts({ rate: 0.5 }));
    const eDouble = generateTimeline(tokens, makeOpts({ rate: 2.0 }));

    const t1 = totalDuration(e1);
    const tHalf = totalDuration(eHalf);
    const tDouble = totalDuration(eDouble);

    // rate=0.5 は rate=1.0 の 2 倍
    expect(tHalf).toBeCloseTo(t1 * 2, 5);
    // rate=2.0 は rate=1.0 の半分
    expect(tDouble).toBeCloseTo(t1 / 2, 5);
  });
});

// ============================================================================
// 2. 基本カテゴリ持続時間の検証
// ============================================================================

describe('generateTimeline - 基本カテゴリ持続時間', () => {
  it('vowel = 140ms ベース (rate=1.0, 文中)', () => {
    // 文頭/文末位置補正を避けるため 3 母音
    const tokens = [vowelTok('a'), vowelTok('i'), vowelTok('e', true)];
    const events = generateTimeline(tokens, makeOpts());
    // 文中 (i) のみ純粋な 140ms
    expect(events[1]!.duration).toBeCloseTo(0.14, 5);
  });

  it('plosive = 80ms ベース', () => {
    const tokens = [
      vowelTok('a'),
      consonantTok('k', 'plosive'),
      vowelTok('a', true),
    ];
    const events = generateTimeline(tokens, makeOpts());
    expect(events[1]!.duration).toBeCloseTo(0.08, 5);
  });

  it('fricative = 110ms ベース', () => {
    const tokens = [
      vowelTok('a'),
      consonantTok('s', 'fricative'),
      vowelTok('a', true),
    ];
    const events = generateTimeline(tokens, makeOpts());
    expect(events[1]!.duration).toBeCloseTo(0.11, 5);
  });

  it('affricate = 120ms ベース', () => {
    const tokens = [
      vowelTok('a'),
      consonantTok('tɕ', 'affricate'),
      vowelTok('a', true),
    ];
    const events = generateTimeline(tokens, makeOpts());
    expect(events[1]!.duration).toBeCloseTo(0.12, 5);
  });

  it('nasal = 90ms ベース', () => {
    const tokens = [
      vowelTok('a'),
      consonantTok('n', 'nasal'),
      vowelTok('a', true),
    ];
    const events = generateTimeline(tokens, makeOpts());
    expect(events[1]!.duration).toBeCloseTo(0.09, 5);
  });

  it('flap = 30ms ベース', () => {
    const tokens = [
      vowelTok('a'),
      consonantTok('ɾ', 'flap'),
      vowelTok('a', true),
    ];
    const events = generateTimeline(tokens, makeOpts());
    expect(events[1]!.duration).toBeCloseTo(0.03, 5);
  });
});

// ============================================================================
// 3. 文末下降 (非疑問文) の検証
// ============================================================================

describe('computeF0 - 文末下降', () => {
  it('非疑問文で最終 2-3 モーラの f0 が finalLowPitch に近づく', () => {
    // 5 母音「あいうえお」
    const tokens: PhonemeToken[] = [
      vowelTok('a'),
      vowelTok('i'),
      vowelTok('ɯ'),
      vowelTok('e'),
      vowelTok('o', true),
    ];
    const events = generateTimeline(tokens, makeOpts({ isQuestion: false }));
    expect(events.length).toBe(5);

    // 文頭付近 (idx 0,1) と最終モーラ (idx 4) を比較
    // 最終モーラは finalLowPitch (80Hz) に近づくはず
    const firstF0 = events[1]!.f0Start; // 2 モーラ目 (highPitch ベース)
    const lastF0 = events[4]!.f0Start;
    expect(lastF0).toBeLessThan(firstF0);
    // 最終モーラは finalLowPitch (80Hz) と highPitch (140Hz) の間で
    // finalLowPitch 寄り
    expect(lastF0).toBeLessThan(DEFAULT_PROSODY.finalLowPitch * 1.3);
  });

  it('疑問文では文末下降が起こらない', () => {
    const tokens: PhonemeToken[] = [
      vowelTok('a'),
      vowelTok('i'),
      vowelTok('ɯ'),
      vowelTok('e'),
      vowelTok('o', true),
    ];
    const eventsDecl = generateTimeline(tokens, makeOpts({ isQuestion: false }));
    const eventsQ = generateTimeline(tokens, makeOpts({ isQuestion: true }));

    // 疑問文の最終モーラは平叙文より高い
    expect(eventsQ[4]!.f0Start).toBeGreaterThan(eventsDecl[4]!.f0Start);
  });
});

// ============================================================================
// 4. 疑問文末尾上昇の検証
// ============================================================================

describe('computeF0 - 疑問文末尾上昇', () => {
  it('疑問文で末尾 2 モーラに questionBoost が加算される', () => {
    const tokens: PhonemeToken[] = [
      vowelTok('a'),
      vowelTok('i'),
      vowelTok('ɯ'),
      vowelTok('e'),
      vowelTok('o', true),
    ];
    const events = generateTimeline(tokens, makeOpts({ isQuestion: true }));

    // 末尾 2 モーラ (idx 3, 4) は文中より高くなる
    const midF0 = events[1]!.f0Start; // 中間
    const last2F0 = events[3]!.f0Start;
    const lastF0 = events[4]!.f0Start;

    // questionBoost (50Hz) で末尾モーラが押し上げられる
    expect(lastF0).toBeGreaterThan(midF0);
    expect(last2F0).toBeGreaterThan(midF0);
  });
});

// ============================================================================
// 5. Declination の検証
// ============================================================================

describe('computeF0 - Declination', () => {
  it('文後半の f0 が文頭より低い (基本トレンド)', () => {
    // 長めの発話で declination の影響を観察
    // 末尾下降効果を排除するため疑問文として比較
    const tokens: PhonemeToken[] = Array.from({ length: 10 }, (_, i) =>
      vowelTok('a', i === 9),
    );
    // declination だけを観察するため finalLowPitch / questionBoost を同じに
    const prosody: ProsodyOptions = {
      ...DEFAULT_PROSODY,
      questionBoost: 0,
      finalLowPitch: 140,
    };
    const events = generateTimeline(
      tokens,
      makeOpts({ isQuestion: true, prosody }),
    );

    // 中間モーラ (idx 1) と文後半 (idx 7) の比較
    const earlyF0 = events[1]!.f0Start;
    const lateF0 = events[7]!.f0Start;

    expect(lateF0).toBeLessThan(earlyF0);
    // exp(-0.3 * dt) で減衰: events[].startTime から実測ベースで検証
    expect(lateF0 / earlyF0).toBeCloseTo(Math.exp(-0.3 * (events[7]!.startTime - events[1]!.startTime)), 1);
  });

  it('微下降: f0End = f0Start * 0.98', () => {
    const tokens: PhonemeToken[] = [vowelTok('a'), vowelTok('i', true)];
    const events = generateTimeline(tokens, makeOpts());
    for (const e of events) {
      if (e.sourceType !== 'silence') {
        expect(e.f0End).toBeCloseTo(e.f0Start * 0.98, 5);
      }
    }
  });
});

// ============================================================================
// 6. ポーズの検証
// ============================================================================

describe('generateTimeline - ポーズ処理', () => {
  it('PAUSE_LONG (句点) = 400ms 速度非依存', () => {
    const tokens: PhonemeToken[] = [
      vowelTok('a'),
      pauseTok('PAUSE_LONG'),
      vowelTok('i', true),
    ];
    const events1 = generateTimeline(tokens, makeOpts({ rate: 1.0 }));
    const events2 = generateTimeline(tokens, makeOpts({ rate: 2.0 }));

    // ポーズイベント (idx 1)
    expect(events1[1]!.duration).toBeCloseTo(0.4, 5);
    // 速度係数 2.0x でも変わらない
    expect(events2[1]!.duration).toBeCloseTo(0.4, 5);
    // ポーズの sourceType は silence
    expect(events1[1]!.sourceType).toBe('silence');
  });

  it('PAUSE_SHORT (読点) = 200ms', () => {
    const tokens: PhonemeToken[] = [
      vowelTok('a'),
      pauseTok('PAUSE_SHORT'),
      vowelTok('i', true),
    ];
    const events = generateTimeline(tokens, makeOpts());
    expect(events[1]!.duration).toBeCloseTo(0.2, 5);
  });

  it('PAUSE_MID (疑問符等) = 350ms', () => {
    const tokens: PhonemeToken[] = [
      vowelTok('a'),
      pauseTok('PAUSE_MID'),
      vowelTok('i', true),
    ];
    const events = generateTimeline(tokens, makeOpts());
    expect(events[1]!.duration).toBeCloseTo(0.35, 5);
  });
});

// ============================================================================
// 7. 長音「ー」処理
// ============================================================================

describe('generateTimeline - 長音処理', () => {
  it('長音「ー」で直前母音の duration が延長される', () => {
    // 「あー」 = vowel + choon
    const tokens: PhonemeToken[] = [vowelTok('a'), choonTok(), vowelTok('i', true)];
    const events = generateTimeline(tokens, makeOpts());

    // choon は独立イベントとして残らず、直前母音の duration に加算される
    // → events.length は 2 (a, i)
    expect(events.length).toBe(2);

    // 1 番目の母音 (a) の duration が延長されている
    // ベース: 140ms × 1.2 (文頭) = 0.168s
    // + 長音 150ms × 1.0 (中間) = 0.15s
    // = 0.318s
    expect(events[0]!.duration).toBeCloseTo(0.168 + 0.15, 5);
  });

  it('長音は次イベントの startTime を後ろにずらす', () => {
    const tokens: PhonemeToken[] = [vowelTok('a'), choonTok(), vowelTok('i', true)];
    const events = generateTimeline(tokens, makeOpts());

    // 2 番目の母音 (i) の startTime は 0.168 + 0.15 = 0.318s
    expect(events[1]!.startTime).toBeCloseTo(0.318, 5);
  });
});

// ============================================================================
// 8. 促音「っ」処理
// ============================================================================

describe('generateTimeline - 促音処理', () => {
  it('促音「っ」が silence イベントを生成する', () => {
    const tokens: PhonemeToken[] = [
      vowelTok('a'),
      sokuonTok(),
      consonantTok('k', 'plosive'),
      vowelTok('a', true),
    ];
    const events = generateTimeline(tokens, makeOpts());

    // 促音は単独イベントとして残る
    expect(events.length).toBe(4);
    expect(events[1]!.sourceType).toBe('silence');
    expect(events[1]!.amplitude).toBe(0);
    expect(events[1]!.nasalCoupling).toBe(0);
    // 持続時間: 120ms × 1.0 (中間) = 0.12s
    expect(events[1]!.duration).toBeCloseTo(0.12, 5);
  });
});

// ============================================================================
// 9. 拗音の展開
// ============================================================================

describe('expandTokens - 拗音展開', () => {
  it('拗音 (palatalized) が子音と母音の 2 エントリに展開される', () => {
    // 「きゃ」 = palatalized [kj, a]
    const tokens: PhonemeToken[] = [palatalizedTok('kj', 'a', true)];
    const expanded = expandTokens(tokens);

    expect(expanded.length).toBe(2);
    expect(expanded[0]!.phoneme).toBe('kj');
    expect(expanded[0]!.category).toBe('palatalized');
    expect(expanded[1]!.phoneme).toBe('a');
    expect(expanded[1]!.category).toBe('vowel');
  });

  it('拗音を含むタイムラインが正しいイベント数を持つ', () => {
    // 「きゃ」 → 2 イベント (palatalized 子音 + vowel)
    const tokens: PhonemeToken[] = [palatalizedTok('kj', 'a', true)];
    const events = generateTimeline(tokens, makeOpts());
    expect(events.length).toBe(2);

    // palatalized は 110ms × 1.2 (文頭) = 0.132s
    expect(events[0]!.duration).toBeCloseTo(0.132, 5);
    // 後続母音 a は 140ms × 1.5 (文末) = 0.21s
    expect(events[1]!.duration).toBeCloseTo(0.21, 5);
  });
});

// ============================================================================
// 10. expandTokens - 撥音 / 促音 / 長音 / ポーズ
// ============================================================================

describe('expandTokens - その他', () => {
  it('撥音 (hatsuon) が単一エントリで展開される', () => {
    const tokens: PhonemeToken[] = [hatsuonTok('n', true)];
    const expanded = expandTokens(tokens);
    expect(expanded.length).toBe(1);
    expect(expanded[0]!.phoneme).toBe('n');
    expect(expanded[0]!.category).toBe('hatsuon');
  });

  it('促音 (sokuon) が "Q" マーカーとして残る', () => {
    const tokens: PhonemeToken[] = [sokuonTok()];
    const expanded = expandTokens(tokens);
    expect(expanded.length).toBe(1);
    expect(expanded[0]!.category).toBe('sokuon');
  });

  it('長音 (choon) が "R" マーカーとして残る', () => {
    const tokens: PhonemeToken[] = [choonTok()];
    const expanded = expandTokens(tokens);
    expect(expanded.length).toBe(1);
    expect(expanded[0]!.category).toBe('choon');
  });

  it('ポーズ (pause) が単一エントリで残る', () => {
    const tokens: PhonemeToken[] = [pauseTok('PAUSE_LONG')];
    const expanded = expandTokens(tokens);
    expect(expanded.length).toBe(1);
    expect(expanded[0]!.category).toBe('pause');
    expect(expanded[0]!.phoneme).toBe('PAUSE_LONG');
  });
});

// ============================================================================
// 11. tractAreas 形状の検証
// ============================================================================

describe('generateTimeline - tractAreas', () => {
  it('全イベントの tractAreas が 16 制御点 Float64Array', () => {
    const tokens: PhonemeToken[] = [
      vowelTok('a'),
      consonantTok('s', 'fricative'),
      vowelTok('a'),
      consonantTok('k', 'plosive'),
      vowelTok('i', true),
    ];
    const events = generateTimeline(tokens, makeOpts());
    for (const e of events) {
      expect(e.tractAreas).toBeInstanceOf(Float64Array);
      expect(e.tractAreas.length).toBe(NUM_CONTROL_POINTS);
    }
  });

  it('母音「あ」の形状が VOWEL_PRESETS の controlPoints と一致', () => {
    const tokens: PhonemeToken[] = [vowelTok('a', true)];
    const events = generateTimeline(tokens, makeOpts());
    // /a/ 形状の典型: 唇側はやや広め (5.0 cm² 等)
    // controlPoints[0] = 5.0 (vowel-presets.ts より)
    expect(events[0]!.tractAreas[0]).toBeCloseTo(5.0, 5);
  });

  it('子音 /s/ で歯茎位置に狭窄が形成される', () => {
    const tokens: PhonemeToken[] = [
      vowelTok('a'),
      consonantTok('s', 'fricative', true),
    ];
    const events = generateTimeline(tokens, makeOpts());
    const sAreas = events[1]!.tractAreas;
    // /s/ は歯茎 (44 区間 idx 3-7) → 16 制御点 idx 1-3 付近に狭窄
    // constrictionArea = 0.12
    // 16 制御点換算: floor(3*16/44)=1, ceil(7*16/44)=3
    expect(sAreas[1]).toBeCloseTo(0.12, 5);
    expect(sAreas[2]).toBeCloseTo(0.12, 5);
    expect(sAreas[3]).toBeCloseTo(0.12, 5);
  });
});

// ============================================================================
// 12. constrictionNoise の検証
// ============================================================================

describe('generateTimeline - constrictionNoise', () => {
  it('fricative /s/ で constrictionNoise が付与される', () => {
    const tokens: PhonemeToken[] = [
      vowelTok('a'),
      consonantTok('s', 'fricative', true),
    ];
    const events = generateTimeline(tokens, makeOpts());
    expect(events[1]!.constrictionNoise).toBeDefined();
    expect(events[1]!.constrictionNoise!.centerFreq).toBe(6000);
  });

  it('vowel では constrictionNoise が undefined', () => {
    const tokens: PhonemeToken[] = [vowelTok('a', true)];
    const events = generateTimeline(tokens, makeOpts());
    expect(events[0]!.constrictionNoise).toBeUndefined();
  });

  it('plosive /k/ で constrictionNoise が付与される', () => {
    const tokens: PhonemeToken[] = [
      vowelTok('a'),
      consonantTok('k', 'plosive'),
      vowelTok('a', true),
    ];
    const events = generateTimeline(tokens, makeOpts());
    expect(events[1]!.constrictionNoise).toBeDefined();
  });
});

// ============================================================================
// 13. nasalCoupling の検証
// ============================================================================

describe('generateTimeline - nasalCoupling', () => {
  it('nasal /n/ で nasalCoupling = 1.8', () => {
    const tokens: PhonemeToken[] = [
      vowelTok('a'),
      consonantTok('n', 'nasal'),
      vowelTok('a', true),
    ];
    const events = generateTimeline(tokens, makeOpts());
    expect(events[1]!.nasalCoupling).toBeCloseTo(1.8, 5);
  });

  it('vowel では nasalCoupling = 0', () => {
    const tokens: PhonemeToken[] = [vowelTok('a', true)];
    const events = generateTimeline(tokens, makeOpts());
    expect(events[0]!.nasalCoupling).toBe(0);
  });

  it('hatsuon (撥音) で nasalCoupling = 1.8', () => {
    const tokens: PhonemeToken[] = [vowelTok('a'), hatsuonTok('n', true)];
    const events = generateTimeline(tokens, makeOpts());
    expect(events[1]!.nasalCoupling).toBeCloseTo(1.8, 5);
  });
});

// ============================================================================
// 14. computeF0 単体テスト (silence イベントの扱い)
// ============================================================================

describe('computeF0 - silence イベント', () => {
  it('silence イベントは f0 = 0', () => {
    const tokens: PhonemeToken[] = [
      vowelTok('a'),
      pauseTok('PAUSE_LONG'),
      vowelTok('i', true),
    ];
    const events = generateTimeline(tokens, makeOpts());
    expect(events[1]!.sourceType).toBe('silence');
    expect(events[1]!.f0Start).toBe(0);
    expect(events[1]!.f0End).toBe(0);
  });

  it('全 silence では何もしない', () => {
    const events: PhonemeEvent[] = [
      {
        phoneme: 'PAUSE_LONG',
        startTime: 0,
        duration: 0.4,
        tractAreas: new Float64Array(NUM_CONTROL_POINTS),
        f0Start: 999,
        f0End: 999,
        sourceType: 'silence',
        amplitude: 0,
        nasalCoupling: 0,
        transitionMs: 10,
      },
    ];
    computeF0(events, false, DEFAULT_PROSODY);
    expect(events[0]!.f0Start).toBe(0);
    expect(events[0]!.f0End).toBe(0);
  });
});

// ============================================================================
// 15. パフォーマンス: 20 音素生成が 5ms 以内
// ============================================================================

describe('generateTimeline - パフォーマンス', () => {
  it('20 音素のタイムライン生成が 5ms 以内', () => {
    // 20 音素を生成 (5 母音 × 4 セット)
    const tokens: PhonemeToken[] = [];
    for (let i = 0; i < 4; i++) {
      tokens.push(vowelTok('a'));
      tokens.push(consonantTok('k', 'plosive'));
      tokens.push(vowelTok('i'));
      tokens.push(consonantTok('s', 'fricative'));
      tokens.push(vowelTok('o', i === 3));
    }
    expect(tokens.length).toBe(20);

    // ウォームアップ
    generateTimeline(tokens, makeOpts());

    // 計測
    const start = performance.now();
    const events = generateTimeline(tokens, makeOpts());
    const elapsed = performance.now() - start;

    expect(events.length).toBe(20);
    expect(elapsed).toBeLessThan(5);
  });
});

// ============================================================================
// 16. startTime の連続性 (時系列の整合性)
// ============================================================================

describe('generateTimeline - startTime 整合性', () => {
  it('連続するイベントの startTime が累積している', () => {
    const tokens: PhonemeToken[] = [
      vowelTok('a'),
      vowelTok('i'),
      vowelTok('ɯ'),
      vowelTok('e'),
      vowelTok('o', true),
    ];
    const events = generateTimeline(tokens, makeOpts());

    expect(events[0]!.startTime).toBe(0);
    for (let i = 1; i < events.length; i++) {
      const expectedStart = events[i - 1]!.startTime + events[i - 1]!.duration;
      expect(events[i]!.startTime).toBeCloseTo(expectedStart, 5);
    }
  });
});
