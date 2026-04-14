// ============================================================================
// Phase 8: phoneme-timeline.ts
// ----------------------------------------------------------------------------
// PhonemeToken 配列から PhonemeEvent 配列を生成する純粋関数群。
//
// 役割:
//  1. expandTokens   : 拗音/促音/長音/撥音を含むトークン列を音素単位に展開
//  2. generateTimeline: 各音素に持続時間・声道形状・振幅・ノイズ・遷移時間を割当
//  3. computeF0      : 平板型基準 + Declination + 文末下降/疑問上昇 + 微下降
//
// 設計方針:
//  - メインスレッドで動作する純粋関数（副作用なし）
//  - tractAreas は 16 制御点 (NUM_CONTROL_POINTS) の Float64Array
//  - ConsonantId にない音素 (拗音派生 kj 等) は親音素 (k) を流用
//  - 子音は「現在の母音形状を起点に狭窄区間のみ上書き」する重ね合わせ方式
// ============================================================================

import type {
  PhonemeToken,
  PhonemeEvent,
  PhonemeCategory,
  ProsodyOptions,
  TimelineOptions,
  ConsonantId,
} from '../types/index';
import { NUM_CONTROL_POINTS } from '../types/index';
import { VOWEL_PRESETS } from '../models/vowel-presets';
import { CONSONANT_PRESETS } from '../audio/consonant-presets';

// ----------------------------------------------------------------------------
// 1. 持続時間モデル
// ----------------------------------------------------------------------------

/** カテゴリ別の基本持続時間 (ms) */
const BASE_DURATION_MS: Record<PhonemeCategory, number> = {
  vowel: 100,
  plosive: 30,
  fricative: 70,
  affricate: 90,
  nasal: 50,
  flap: 25,
  approximant: 40,
  palatalized: 90,
  sokuon: 100,
  choon: 100,
  hatsuon: 70,
  pause: 0, // ポーズは別ロジックで処理
};

/**
 * 句読点ポーズ持続時間 (ms)。速度係数 (rate) の影響を受けない。
 * text-parser がポーズの種類をフラグ文字列として PhonemeToken.phonemes[0] に格納する想定。
 */
const PAUSE_DURATION_MS: Record<string, number> = {
  PAUSE_LONG: 400, // 句点
  PAUSE_SHORT: 200, // 読点
  PAUSE_MID: 350, // 疑問符・感嘆符
};

// ----------------------------------------------------------------------------
// 2. 振幅・音源タイプ・遷移時間のルックアップ
// ----------------------------------------------------------------------------

/** 音素の相対振幅 (0.0-1.0) を取得する */
function lookupAmplitude(phoneme: string, category: PhonemeCategory): number {
  if (category === 'vowel') {
    if (phoneme === 'a') return 1.0;
    if (phoneme === 'e' || phoneme === 'o') return 0.85;
    if (phoneme === 'i' || phoneme === 'ɯ') return 0.7;
  }
  if (category === 'nasal' || category === 'hatsuon') return 0.55;
  if (category === 'fricative') return 0.3;
  if (category === 'plosive') return 0.4;
  if (category === 'affricate') return 0.35;
  if (category === 'flap') return 0.45;
  if (category === 'approximant' || category === 'palatalized') return 0.6;
  if (category === 'sokuon' || category === 'pause') return 0;
  return 0.5;
}

/** 音素の音源タイプを取得する */
function lookupSourceType(category: PhonemeCategory): PhonemeEvent['sourceType'] {
  if (
    category === 'vowel' ||
    category === 'nasal' ||
    category === 'hatsuon' ||
    category === 'approximant' ||
    category === 'palatalized' ||
    category === 'flap'
  ) {
    return 'voiced';
  }
  if (category === 'fricative') return 'noise';
  if (category === 'plosive' || category === 'affricate') return 'voiced+noise';
  if (category === 'sokuon' || category === 'pause') return 'silence';
  return 'voiced';
}

/** 文位置による持続時間補正係数 (1.0=中間, 1.2=文頭, 1.5=文末) */
function decidePosition(i: number, total: number): number {
  if (total <= 1) return 1.5;
  if (i === 0) return 1.2;
  if (i === total - 1) return 1.5;
  return 1.0;
}

/** カテゴリに応じた前イベントからの遷移時間 (ms) */
function decideTransitionMs(category: PhonemeCategory): number {
  if (category === 'vowel') return 30;
  if (category === 'plosive' || category === 'affricate') return 8;
  if (category === 'fricative') return 15;
  if (category === 'nasal' || category === 'hatsuon') return 20;
  return 15;
}

// ----------------------------------------------------------------------------
// 3. 声道形状ルックアップ
// ----------------------------------------------------------------------------

/** 母音 IPA → VowelId (neutral 除く) のマッピング */
const VOWEL_MAP: Record<string, 'a' | 'i' | 'u' | 'e' | 'o'> = {
  a: 'a',
  i: 'i',
  ɯ: 'u',
  e: 'e',
  o: 'o',
};

/** neutral プリセットを 16 制御点 Float64Array で取得（フォールバック用） */
function getNeutralAreas(): Float64Array {
  const preset = VOWEL_PRESETS.find((p) => p.id === 'neutral');
  if (!preset) {
    // 通常到達不能。安全側のデフォルト（4.0 cm² 均一管）。
    return new Float64Array(NUM_CONTROL_POINTS).fill(4.0);
  }
  return new Float64Array(preset.controlPoints);
}

/** 母音 IPA → 16 制御点配列を取得 */
function getVowelAreas(phoneme: string): Float64Array | null {
  const vid = VOWEL_MAP[phoneme];
  if (!vid) return null;
  const preset = VOWEL_PRESETS.find((p) => p.id === vid);
  if (!preset) return null;
  return new Float64Array(preset.controlPoints);
}

/**
 * 子音プリセットを現在の母音形状に重ね合わせる。
 * - constrictionRange は 44 区間 index → 16 制御点 index へ換算
 * - 狭窄区間のみ constrictionArea で上書き
 * - constrictionRange.start < 0 (例: /h/) は重ね合わせをスキップ
 */
function applyConsonantConstriction(
  id: ConsonantId,
  baseAreas: Float64Array,
): Float64Array {
  const preset = CONSONANT_PRESETS[id];
  const result = new Float64Array(baseAreas);
  if (preset.constrictionRange.start < 0) {
    // /h/ 等、声門音源由来。形状は母音のまま。
    return result;
  }

  // 44 区間 index → 16 制御点 index 換算
  const start16 = Math.max(
    0,
    Math.floor((preset.constrictionRange.start * NUM_CONTROL_POINTS) / 44),
  );
  const end16 = Math.min(
    NUM_CONTROL_POINTS - 1,
    Math.ceil((preset.constrictionRange.end * NUM_CONTROL_POINTS) / 44),
  );

  for (let k = start16; k <= end16; k++) {
    result[k] = preset.constrictionArea;
  }
  return result;
}

/**
 * 音素の声道形状（16 制御点）を取得する。
 * - 母音: VOWEL_PRESETS から取得
 * - 子音: 現在の母音形状に狭窄を重ね合わせ
 * - 撥音 allophone (m/n/ŋ/ɴ): 対応する鼻音プリセット
 * - 促音/長音/ポーズ: 現在形状を維持
 */
function getTractAreas(
  phoneme: string,
  _category: PhonemeCategory,
  currentVowelAreas: Float64Array,
): Float64Array {
  // 母音
  const vowelAreas = getVowelAreas(phoneme);
  if (vowelAreas) return vowelAreas;

  // 撥音 allophone
  // ŋ (軟口蓋鼻音) は CONSONANT_PRESETS に未定義のため ny (硬口蓋鼻音) で近似
  const hatsuonMap: Record<string, ConsonantId> = {
    m: 'm',
    n: 'n',
    ŋ: 'ny',
  };
  const hatsuonId = hatsuonMap[phoneme];
  if (hatsuonId) {
    return applyConsonantConstriction(hatsuonId, currentVowelAreas);
  }
  if (phoneme === 'ɴ') {
    // 口蓋垂鼻音: 口腔閉鎖なし。現在の母音形状を維持し、velum は呼び出し側で開く。
    return new Float64Array(currentVowelAreas);
  }

  // 通常子音 (CONSONANT_PRESETS)
  // 拗音派生 (kj/gj/bj/pj/mj/ɾj) は ConsonantId にないため親音素を流用
  const consonantIdMap: Record<string, ConsonantId> = {
    s: 's',
    ɕ: 'sh',
    h: 'h',
    ç: 'hi',
    ɸ: 'fu',
    z: 'z',
    k: 'k',
    t: 't',
    p: 'p',
    g: 'g',
    d: 'd',
    b: 'b',
    tɕ: 'tsh',
    ts: 'ts',
    dʑ: 'dzh',
    dz: 'dz',
    ɾ: 'r',
    j: 'j',
    w: 'w',
    // 拗音派生（暫定: 親音素を流用）
    kj: 'k',
    gj: 'g',
    bj: 'b',
    pj: 'p',
    mj: 'm',
    ɾj: 'r',
  };
  const cid = consonantIdMap[phoneme];
  if (cid) {
    return applyConsonantConstriction(cid, currentVowelAreas);
  }

  // 促音・長音・ポーズ・未知音素: 現在形状維持
  return new Float64Array(currentVowelAreas);
}

/**
 * 音素ごとのノイズ注入パラメータを取得する。
 * fricative / plosive / affricate のみ。他は undefined。
 *
 * Phase 8 レビュー対応: /h/ と /ç/ は声門由来のため CONSONANT_PRESETS の
 * constrictionRange={-1,-1} (h) で狭窄ノイズが取れず無音になる問題を回避。
 * 声道の中ほど (軟口蓋付近, idx=30) に広帯域ノイズを注入することで
 * 声門 aspiration の近似として鳴らす。
 */
function getConstrictionNoise(
  phoneme: string,
  category: PhonemeCategory,
): PhonemeEvent['constrictionNoise'] {
  if (
    category !== 'fricative' &&
    category !== 'plosive' &&
    category !== 'affricate'
  ) {
    return undefined;
  }

  // Phase 8 レビュー対応: /h/, /ç/ の特例処理
  // /h/ は constrictionRange={-1,-1} で狭窄ノイズが取れない問題を回避するため、
  // 軟口蓋付近 (idx=30) に広帯域ノイズを注入して aspiration を擬似的に再現する。
  // /ç/ も同様に均一な気息音として扱う方が自然な無声硬口蓋摩擦音になる。
  if (phoneme === 'h' || phoneme === 'ç') {
    return {
      position: 30,
      centerFreq: 2500,
      bandwidth: 3000,
      intensity: 0.4,
    };
  }

  // ノイズが定義されている子音のみ
  const consonantIdMap: Record<string, ConsonantId> = {
    s: 's',
    ɕ: 'sh',
    ç: 'hi',
    ɸ: 'fu',
    z: 'z',
    k: 'k',
    t: 't',
    p: 'p',
    g: 'g',
    d: 'd',
    b: 'b',
    tɕ: 'tsh',
    ts: 'ts',
    dʑ: 'dzh',
    dz: 'dz',
  };
  const cid = consonantIdMap[phoneme];
  if (!cid) return undefined;
  const preset = CONSONANT_PRESETS[cid];
  if (!preset.noise) return undefined;
  if (preset.constrictionRange.start < 0) return undefined;

  const midPos = Math.round(
    (preset.constrictionRange.start + preset.constrictionRange.end) / 2,
  );
  return {
    position: midPos,
    centerFreq: preset.noise.centerFreq,
    bandwidth: preset.noise.bandwidth,
    intensity: preset.noise.gain,
  };
}

// ----------------------------------------------------------------------------
// 4. expandTokens — 拗音/促音/長音/撥音を音素単位へ展開
// ----------------------------------------------------------------------------

/** expandTokens の出力単位 */
interface ExpandedPhoneme {
  phoneme: string;
  category: PhonemeCategory;
}

/**
 * PhonemeToken 配列を音素単位の平坦な配列に展開する。
 *
 * - 普通音 (vowel/plosive/fricative/affricate/nasal/flap/approximant):
 *     phonemes 配列のすべてを同カテゴリで展開。複数音素持つ子音 (例: /ts/) は単一エントリ。
 * - 拗音 (palatalized): 子音音素 (1 つ目) を palatalized、母音音素 (2 つ目) を vowel として展開。
 * - 撥音 (hatsuon): allophone を 1 つの hatsuon エントリに。
 * - 促音 (sokuon): "Q" マーカーを 1 つの sokuon エントリに。
 * - 長音 (choon): "R" マーカーを 1 つの choon エントリに。
 * - pause: そのまま 1 エントリ。
 */
export function expandTokens(tokens: PhonemeToken[]): ExpandedPhoneme[] {
  const out: ExpandedPhoneme[] = [];
  for (const tok of tokens) {
    if (tok.category === 'pause') {
      // ポーズは phonemes[0] にフラグ文字列が入っている想定 (PAUSE_LONG 等)
      const phoneme = tok.phonemes[0] ?? 'PAUSE_SHORT';
      out.push({ phoneme, category: 'pause' });
      continue;
    }

    if (tok.category === 'palatalized') {
      // 拗音: phonemes は通常 [子音, 母音] の 2 要素
      // 例: 「きゃ」 → ['kj', 'a']
      if (tok.phonemes.length >= 2) {
        const cons = tok.phonemes[0]!;
        const vowel = tok.phonemes[1]!;
        out.push({ phoneme: cons, category: 'palatalized' });
        out.push({ phoneme: vowel, category: 'vowel' });
      } else if (tok.phonemes.length === 1) {
        out.push({ phoneme: tok.phonemes[0]!, category: 'palatalized' });
      }
      continue;
    }

    if (tok.category === 'sokuon') {
      out.push({ phoneme: tok.phonemes[0] ?? 'Q', category: 'sokuon' });
      continue;
    }

    if (tok.category === 'choon') {
      out.push({ phoneme: tok.phonemes[0] ?? 'R', category: 'choon' });
      continue;
    }

    if (tok.category === 'hatsuon') {
      // 撥音: allophone (m/n/ŋ/ɴ) を 1 エントリで
      out.push({
        phoneme: tok.phonemes[0] ?? 'ɴ',
        category: 'hatsuon',
      });
      continue;
    }

    // 通常: 母音/子音は phonemes の各要素を同カテゴリで展開
    // 例: 「さ」 = { phonemes: ['s', 'a'], category: ??? } というケースは
    //   text-parser 側で別トークンに分けられている前提。
    //   ここでは phonemes[i] それぞれが独立した音素として扱われる。
    for (const ph of tok.phonemes) {
      out.push({ phoneme: ph, category: tok.category });
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// 5. generateTimeline — 主処理
// ----------------------------------------------------------------------------

/**
 * PhonemeToken 配列から PhonemeEvent 配列を生成する。
 *
 * @param tokens text-parser の出力
 * @param opts   速度・韻律・疑問文フラグ
 * @param initialVowelAreas 初期母音形状 (省略時は neutral)
 * @returns 時系列順の PhonemeEvent 配列
 */
export function generateTimeline(
  tokens: PhonemeToken[],
  opts: TimelineOptions,
  initialVowelAreas?: Float64Array,
): PhonemeEvent[] {
  const expanded = expandTokens(tokens);
  const events: PhonemeEvent[] = [];
  let t = 0;

  // 現在の母音形状（子音の重ね合わせ起点）
  let currentVowelAreas =
    initialVowelAreas !== undefined
      ? new Float64Array(initialVowelAreas)
      : getNeutralAreas();

  for (let i = 0; i < expanded.length; i++) {
    const item = expanded[i]!;
    const pos = decidePosition(i, expanded.length);

    // ----- 持続時間の計算 -----
    let duration: number;
    if (item.category === 'pause') {
      // 句読点は速度非依存の固定値
      duration = (PAUSE_DURATION_MS[item.phoneme] ?? 200) / 1000;
    } else {
      duration = (BASE_DURATION_MS[item.category] * pos) / opts.rate / 1000;
    }

    // ----- 長音 (R): 直前イベントの duration を延長 -----
    if (item.category === 'choon') {
      const last = events[events.length - 1];
      if (last) {
        last.duration += duration;
      }
      t += duration;
      continue;
    }

    // ----- 促音 (Q): silence イベントを生成 -----
    if (item.category === 'sokuon') {
      events.push({
        phoneme: item.phoneme,
        startTime: t,
        duration,
        tractAreas: new Float64Array(currentVowelAreas),
        f0Start: 0,
        f0End: 0,
        sourceType: 'silence',
        amplitude: 0,
        nasalCoupling: 0,
        transitionMs: 10,
      });
      t += duration;
      continue;
    }

    // ----- 通常イベント -----
    const tractAreas = getTractAreas(item.phoneme, item.category, currentVowelAreas);
    if (item.category === 'vowel') {
      // 母音は次回以降の重ね合わせ起点として記憶
      currentVowelAreas = new Float64Array(tractAreas);
    }

    const isNasal = item.category === 'nasal' || item.category === 'hatsuon';
    // 撥音 ɴ (口蓋垂鼻音) も nasal 扱いで velum 開放
    const nasalCoupling = isNasal ? 1.8 : 0;

    const event: PhonemeEvent = {
      phoneme: item.phoneme,
      startTime: t,
      duration,
      tractAreas,
      f0Start: 0, // computeF0 で埋める
      f0End: 0,
      sourceType: lookupSourceType(item.category),
      amplitude: lookupAmplitude(item.phoneme, item.category),
      nasalCoupling,
      transitionMs: decideTransitionMs(item.category),
    };

    // constrictionNoise は存在する場合のみ付与（exactOptionalPropertyTypes 互換）
    const noise = getConstrictionNoise(item.phoneme, item.category);
    if (noise !== undefined) {
      event.constrictionNoise = noise;
    }

    events.push(event);
    t += duration;
  }

  computeF0(events, opts.isQuestion, opts.prosody);
  return events;
}

// ----------------------------------------------------------------------------
// 6. computeF0 — 韻律 5 ステップ
// ----------------------------------------------------------------------------

/**
 * F0 韻律を計算して events に書き込む。
 *
 * 1. 平板型基準 : 1 モーラ目 = basePitch、2 モーラ目以降 = highPitch
 * 2. Declination: f0 *= exp(-declinationRate * startTime)
 * 3. 文末下降    : 疑問文以外、最終 2-3 モーラで finalLowPitch へ補間
 * 4. 疑問文末尾上昇: 末尾 2 モーラに +questionBoost
 * 5. 微下降      : f0End = f0Start * 0.98
 *
 * silence イベント (沈黙 / 促音 / ポーズ) は f0Start=f0End=0 で除外。
 */
export function computeF0(
  events: PhonemeEvent[],
  isQuestion: boolean,
  prosody: ProsodyOptions,
): void {
  // 有声イベントのみ抽出 (silence は計算対象外)
  const voicedEvents = events.filter((e) => e.sourceType !== 'silence');
  const n = voicedEvents.length;

  // 全体が沈黙の場合は何もしない
  if (n === 0) {
    for (const e of events) {
      e.f0Start = 0;
      e.f0End = 0;
    }
    return;
  }

  // 有声イベントに限った位置インデックス
  let voicedIdx = -1;

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.sourceType === 'silence') {
      e.f0Start = 0;
      e.f0End = 0;
      continue;
    }
    voicedIdx++;

    // (1) 平板型基準
    let f0 = voicedIdx === 0 ? prosody.basePitch : prosody.highPitch;

    // (2) Declination
    f0 *= Math.exp(-prosody.declinationRate * e.startTime);

    // (3) 文末下降（疑問文以外）
    //     最終 2-3 モーラで finalLowPitch へ線形補間。
    if (!isQuestion && n >= 3 && voicedIdx >= n - 3) {
      // ratio: voicedIdx=n-3 → 0, voicedIdx=n-1 → 1
      const ratio = (voicedIdx - (n - 3)) / 2;
      f0 = f0 * (1 - ratio) + prosody.finalLowPitch * ratio;
    } else if (!isQuestion && n === 2 && voicedIdx === 1) {
      // 短い発話用の補正（最終モーラのみ少し下げる）
      f0 = f0 * 0.5 + prosody.finalLowPitch * 0.5;
    } else if (!isQuestion && n === 1) {
      // 単一モーラは中間値
      f0 = f0 * 0.7 + prosody.finalLowPitch * 0.3;
    }

    // (4) 疑問文末尾上昇
    if (isQuestion && voicedIdx >= n - 2) {
      f0 += prosody.questionBoost;
    }

    e.f0Start = f0;
    // (5) 微下降
    e.f0End = f0 * 0.98;
  }
}
