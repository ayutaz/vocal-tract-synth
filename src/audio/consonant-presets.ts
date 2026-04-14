import type { ConsonantId, ConsonantPreset } from '../types/index.js';

/**
 * Phase 6: 19 音素の子音プリセット定義
 *
 * 各プリセットは「先行/後続母音形状を呼び出し側で渡す」前提で設計されている。
 * `constrictionRange` は 44 区間モデルにおける狭窄/閉鎖を作るインデックス範囲。
 *
 * 【index 規約 (Phase 6 レビュー対応)】
 * 配列インデックス: index=0 が唇側、index=43 が声門側 (NUM_SECTIONS-1)。
 * 声道総長 ≈ 17.5 cm、44 区間で約 0.4 cm/区間。
 * 解剖学的な調音位置と idx の対応:
 *   両唇     ≈ 唇先      → idx 0-3    (0〜1.2 cm)
 *   歯茎     ≈ 1.2-2.8 cm → idx 3-7
 *   歯茎硬口蓋≈ 2.4-4.4 cm → idx 6-11
 *   硬口蓋   ≈ 4.0-6.0 cm → idx 10-15
 *   軟口蓋   ≈ 8.0-9.6 cm → idx 20-24 (咽頭と口腔の境界)
 *
 * - 摩擦音: 持続的狭窄 + バンドパスノイズ (frictionMs)
 * - 破裂音: 閉鎖 (closureMs) → バースト (burstMs) → VOT
 * - 破擦音: 閉鎖 → 摩擦 の連続
 * - 弾音 /ɾ/: 短時間の弾き (closureMs のみ、ノイズなし)
 * - 半母音 /j/, /w/: 母音形状を維持して後続母音へ遷移 (持続音、ノイズなし)
 */
export const CONSONANT_PRESETS: Record<ConsonantId, ConsonantPreset> = {
  // ===== 摩擦音 (6音素) =====

  s: {
    id: 's',
    ipa: 's',
    category: 'fricative',
    voiced: false,
    // Phase 6 レビュー対応: 歯茎 (唇から約 1.2-2.8 cm)
    constrictionRange: { start: 3, end: 7 },
    constrictionArea: 0.12,
    noise: { centerFreq: 6000, bandwidth: 4000, gain: 0.7 },
    frictionMs: 70,
  },

  sh: {
    id: 'sh',
    ipa: 'ɕ',
    category: 'fricative',
    voiced: false,
    // Phase 6 レビュー対応: 歯茎硬口蓋
    constrictionRange: { start: 6, end: 11 },
    constrictionArea: 0.15,
    noise: { centerFreq: 3750, bandwidth: 2500, gain: 0.6 },
    frictionMs: 70,
  },

  h: {
    id: 'h',
    ipa: 'h',
    category: 'fricative',
    voiced: false,
    constrictionRange: { start: -1, end: -1 }, // 声門由来 (Phase 6 ではスキップ可)
    constrictionArea: 0.30,
    // noise: undefined (声門ノイズ経路を使うため狭窄ノイズは無効)
    frictionMs: 70,
  },

  hi: {
    id: 'hi',
    ipa: 'ç',
    category: 'fricative',
    voiced: false,
    // Phase 6 レビュー対応: 硬口蓋
    constrictionRange: { start: 10, end: 15 },
    constrictionArea: 0.20,
    noise: { centerFreq: 3500, bandwidth: 3000, gain: 0.4 },
    frictionMs: 70,
  },

  fu: {
    id: 'fu',
    ipa: 'ɸ',
    category: 'fricative',
    voiced: false,
    // Phase 6 レビュー対応: 両唇
    constrictionRange: { start: 0, end: 3 },
    constrictionArea: 0.22,
    noise: { centerFreq: 2500, bandwidth: 3000, gain: 0.3 },
    frictionMs: 70,
  },

  z: {
    id: 'z',
    ipa: 'z',
    category: 'fricative',
    voiced: true,
    // Phase 6 レビュー対応: 歯茎有声
    constrictionRange: { start: 3, end: 7 },
    constrictionArea: 0.15,
    noise: { centerFreq: 5500, bandwidth: 4000, gain: 0.5 },
    frictionMs: 60,
  },

  // ===== 破裂音 (6音素) =====

  k: {
    id: 'k',
    ipa: 'k',
    category: 'plosive',
    voiced: false,
    // Phase 6 レビュー対応: 軟口蓋 (唇から約 8-9.6 cm)
    constrictionRange: { start: 20, end: 24 },
    constrictionArea: 0.01,
    noise: { centerFreq: 4000, bandwidth: 6000, gain: 0.5 },
    closureMs: 60,
    burstMs: 10,
    vot: 30,
  },

  t: {
    id: 't',
    ipa: 't',
    category: 'plosive',
    voiced: false,
    // Phase 6 レビュー対応: 歯茎
    constrictionRange: { start: 3, end: 7 },
    constrictionArea: 0.01,
    noise: { centerFreq: 5000, bandwidth: 5000, gain: 0.5 },
    closureMs: 50,
    burstMs: 8,
    vot: 20,
  },

  p: {
    id: 'p',
    ipa: 'p',
    category: 'plosive',
    voiced: false,
    // Phase 6 レビュー対応: 両唇
    constrictionRange: { start: 0, end: 3 },
    constrictionArea: 0.01,
    noise: { centerFreq: 1500, bandwidth: 4000, gain: 0.4 },
    closureMs: 50,
    burstMs: 8,
    vot: 15,
  },

  g: {
    id: 'g',
    ipa: 'g',
    category: 'plosive',
    voiced: true,
    // Phase 6 レビュー対応: 軟口蓋有声
    constrictionRange: { start: 20, end: 24 },
    constrictionArea: 0.01,
    noise: { centerFreq: 4000, bandwidth: 6000, gain: 0.4 },
    closureMs: 60,
    burstMs: 8,
    vot: -40,
  },

  d: {
    id: 'd',
    ipa: 'd',
    category: 'plosive',
    voiced: true,
    // Phase 6 レビュー対応: 歯茎有声
    constrictionRange: { start: 3, end: 7 },
    constrictionArea: 0.01,
    noise: { centerFreq: 5000, bandwidth: 5000, gain: 0.4 },
    closureMs: 50,
    burstMs: 6,
    vot: -40,
  },

  b: {
    id: 'b',
    ipa: 'b',
    category: 'plosive',
    voiced: true,
    // Phase 6 レビュー対応: 両唇有声
    constrictionRange: { start: 0, end: 3 },
    constrictionArea: 0.01,
    noise: { centerFreq: 1500, bandwidth: 4000, gain: 0.3 },
    closureMs: 50,
    burstMs: 6,
    vot: -40,
  },

  // ===== 破擦音 (4音素) =====

  tsh: {
    id: 'tsh',
    ipa: 'tɕ',
    category: 'affricate',
    voiced: false,
    // Phase 6 レビュー対応: 歯茎硬口蓋
    constrictionRange: { start: 6, end: 11 },
    constrictionArea: 0.01, // 閉鎖→0.15 へ開放
    noise: { centerFreq: 4000, bandwidth: 2000, gain: 0.6 },
    closureMs: 40,
    burstMs: 5,
    frictionMs: 70,
    vot: 70,
  },

  ts: {
    id: 'ts',
    ipa: 'ts',
    category: 'affricate',
    voiced: false,
    // Phase 6 レビュー対応: 歯茎 (破擦)
    constrictionRange: { start: 3, end: 7 },
    constrictionArea: 0.01, // 閉鎖→0.12 へ開放
    noise: { centerFreq: 6000, bandwidth: 3000, gain: 0.6 },
    closureMs: 35,
    burstMs: 5,
    frictionMs: 60,
    vot: 60,
  },

  dzh: {
    id: 'dzh',
    ipa: 'dʑ',
    category: 'affricate',
    voiced: true,
    // Phase 6 レビュー対応: 歯茎硬口蓋有声
    constrictionRange: { start: 6, end: 11 },
    constrictionArea: 0.01, // 閉鎖→0.15 へ開放
    noise: { centerFreq: 4000, bandwidth: 2000, gain: 0.5 },
    closureMs: 30,
    burstMs: 5,
    frictionMs: 50,
    vot: -30,
  },

  dz: {
    id: 'dz',
    ipa: 'dz',
    category: 'affricate',
    voiced: true,
    // Phase 6 レビュー対応: 歯茎有声 (破擦)
    constrictionRange: { start: 3, end: 7 },
    constrictionArea: 0.01, // 閉鎖→0.12 へ開放
    noise: { centerFreq: 6000, bandwidth: 3000, gain: 0.5 },
    closureMs: 25,
    burstMs: 5,
    frictionMs: 40,
    vot: -25,
  },

  // ===== 弾音・半母音 (3音素) =====

  r: {
    id: 'r',
    ipa: 'ɾ',
    category: 'flap',
    voiced: true,
    // Phase 6 レビュー対応: 歯茎弾き
    constrictionRange: { start: 4, end: 7 },
    constrictionArea: 0.05,
    // noise: undefined (弾音はノイズなし)
    closureMs: 15,
  },

  j: {
    id: 'j',
    ipa: 'j',
    category: 'approximant',
    voiced: true,
    // Phase 6 レビュー対応: 硬口蓋接近 (/i/ 形状起点)
    constrictionRange: { start: 8, end: 13 },
    constrictionArea: 0.3,
    // noise: undefined (半母音はノイズなし)
  },

  w: {
    id: 'w',
    ipa: 'w',
    category: 'approximant',
    voiced: true,
    // Phase 6 レビュー対応: 両唇円唇 (/u/ 形状起点)
    constrictionRange: { start: 0, end: 3 },
    constrictionArea: 0.5,
    // noise: undefined (半母音はノイズなし)
  },
};

/**
 * 指定 ID のプリセットを取得する。
 * 未登録 ID は型レベルでブロックされるため、ランタイム例外は理論上発生しない。
 */
export function getConsonantPreset(id: ConsonantId): ConsonantPreset {
  return CONSONANT_PRESETS[id];
}

/**
 * 全子音 ID をリストで取得する (UI ボタン生成等のためのイテレータ)。
 */
export function getAllConsonantIds(): ConsonantId[] {
  return Object.keys(CONSONANT_PRESETS) as ConsonantId[];
}

// ============================================================================
// Phase 6: 子音プリセット
// ----------------------------------------------------------------------------
// 本ファイルは Phase 6 (子音基盤) で導入された 19 音素 (摩擦音 6 + 破裂音 6 +
// 破擦音 4 + 弾音 1 + 半母音 2) の物理パラメータ表である。
//
// 各プリセットは「現在の母音形状を起点に constrictionRange の区間のみ
// constrictionArea で上書きする」運用を想定し、コアーティキュレーションの
// 高度な実装は Phase 8 の phoneme-timeline に委ねる。
//
// constrictionRange は 44 区間モデルでの index 範囲 (唇側=0, 声門側=43) で、
// 解剖学的な調音位置に基づいて設定されている (Phase 6 レビュー対応で再マッピング済)。
// /h/ は声門由来摩擦のため constrictionRange を -1 で無効化し、Phase 6 では
// スキップ可能としている。
// ============================================================================
