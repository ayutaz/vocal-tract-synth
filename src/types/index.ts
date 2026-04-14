// ===== 物理定数 =====

export const VOCAL_TRACT_LENGTH = 17.5;    // cm（成人男性）
export const SPEED_OF_SOUND = 35000;        // cm/s（体温）
export const SAMPLE_RATE = 44100;           // Hz
export const NUM_SECTIONS = 44;             // 離散化区間数
export const NUM_CONTROL_POINTS = 16;       // UI制御点数
export const SECTION_LENGTH = VOCAL_TRACT_LENGTH / NUM_SECTIONS; // ≈ 0.397 cm

export const MIN_AREA = 0.3;   // cm²（ゼロ除算防止 / UI ドラッグ下限）
export const MAX_AREA = 10.0;  // cm²
export const DEFAULT_AREA = 4.0; // cm²（均一管）

// Phase 6: プログラム制御下限（子音用）
// MIN_AREA は UI ドラッグ操作の下限として維持し、子音の完全閉鎖や
// 強い狭窄はプログラム制御 (setAreas) 経由で MIN_AREA_PROGRAM までクランプ可能とする。
export const MIN_AREA_PROGRAM = 0.01; // cm²

// ===== Phase 7: 鼻腔管パラメータ =====

export const NASAL_NUM_SECTIONS = 30;                              // 鼻腔管区間数
export const NASAL_LENGTH = 11.4;                                  // cm（鼻咽腔～鼻孔、成人男性平均）
export const NASAL_SECTION_LENGTH = NASAL_LENGTH / NASAL_NUM_SECTIONS; // ≈ 0.38 cm/区間
// Phase 7 レビュー対応: 軟口蓋位置を解剖学的に正しい位置に補正
// 唇から約 9.5cm (解剖学的な軟口蓋位置) に対応する区間インデックス。
// SECTION_LENGTH ≈ 0.397 cm なので、idx = 24 は唇から 24 × 0.397 ≒ 9.53 cm。
// （修正前の idx=20 では唇から 7.94 cm となり、硬口蓋付近に相当していた。）
// 注: index 規約は「0=唇側, N-1=声門側」。
export const NASAL_JUNCTION_INDEX = 24;                            // 口腔44区間における鼻腔接合点（軟口蓋位置）

// ===== 声門パラメータ =====

export const DEFAULT_F0 = 120;        // Hz
export const MIN_F0 = 50;             // Hz
export const MAX_F0 = 400;            // Hz
export const DEFAULT_OQ = 0.6;        // Open Quotient
export const MIN_OQ = 0.3;
export const MAX_OQ = 0.8;

// ===== 声道フィルタパラメータ =====

export const WALL_LOSS_FACTOR = 0.999;     // 壁面損失 mu
export const GLOTTAL_REFLECTION = 0.95;    // 声門端反射係数 r_glottis
export const LIP_REFLECTION = -0.85;       // 唇端反射係数 R_L
export const RADIATION_ALPHA = 0.97;       // 放射フィルタ係数 alpha

// ===== 有声/無声クロスフェード =====

export const CROSSFADE_SAMPLES = 330;      // 約7.5ms at 44100Hz（5-10ms範囲内）

// ===== アプリケーション状態 =====

export type AppState = 'idle' | 'initializing' | 'running' | 'error';

// ===== 音源タイプ =====

export type SourceType = 'voiced' | 'noise';

// ===== メインスレッド → Worklet 通信メッセージ型（判別共用体） =====

export type GlottalModelType = 'klglott88' | 'lf';

export type WorkletMessage =
  | { type: 'setAreas'; areas: ArrayLike<number> }
  | { type: 'setSourceType'; sourceType: SourceType }
  | { type: 'setOQ'; oq: number }
  | { type: 'setJitter'; amount: number }
  | { type: 'setShimmer'; amount: number }
  | { type: 'setGlottalModel'; model: GlottalModelType }
  | { type: 'setRd'; rd: number }
  | { type: 'setAspiration'; level: number }
  // Phase 6: 子音基盤メッセージ
  | { type: 'setConstrictionNoise'; position: number; intensity: number;
      centerFreq: number; bandwidth: number }
  // Phase 6 → Phase 7 拡張: targetVelumArea (optional) を追加
  // 未指定時は velum を補間対象から外し、現在値を維持する（Phase 6 と同一挙動）。
  | { type: 'scheduleTransition';
      targetAreas: Float64Array;
      targetVelumArea?: number;
      durationSamples: number }
  | { type: 'cancelTransition' }
  // Phase 7: 鼻腔管メッセージ
  // velopharyngealArea=0 で velum 閉鎖（鼻腔経路を完全にスキップ = Phase 6 と同一挙動）。
  // 1.5〜2.0 cm² で鼻音時の全開状態（3 ポート Smith 接合が起動）。
  | { type: 'setNasalCoupling'; velopharyngealArea: number };

// ===== 声門音源インターフェース（Phase 2 で抽出） =====

export interface GlottalModel {
  generate(phase: number): number;
  generateWithMix(phase: number): number;
  setSourceType(type: SourceType): void;
  setOpenQuotient(oq: number): void;
  setRd?(rd: number): void;
  setAspiration?(level: number): void;
  reset(): void;
}

// ===== 母音プリセット型 =====

export type VowelId = 'a' | 'i' | 'u' | 'e' | 'o' | 'neutral';

export interface VowelPreset {
  id: VowelId;
  label: string;            // 'あ', 'い', 'う', 'え', 'お', 'Flat'
  controlPoints: number[];  // 16要素 (cm²)
  targetFormants?: {        // Phase 3 チューニング検証用
    f1: number;
    f2: number;
    f3: number;
  };
}

// ===== 子音プリセット型（Phase 6） =====

export type ConsonantId =
  | 's' | 'sh' | 'h' | 'hi' | 'fu' | 'z'           // 摩擦音
  | 'k' | 't' | 'p' | 'g' | 'd' | 'b'              // 破裂音
  | 'tsh' | 'ts' | 'dzh' | 'dz'                    // 破擦音
  | 'r' | 'j' | 'w'                                // 弾音・半母音
  | 'm' | 'n' | 'ny';                              // Phase 7: 鼻音 3 種

export type ConsonantCategory =
  | 'plosive'      // 破裂音（閉鎖→バースト→VOT）
  | 'fricative'    // 摩擦音（持続的狭窄+ノイズ）
  | 'affricate'    // 破擦音（閉鎖→摩擦の連続）
  | 'flap'         // 弾音
  | 'approximant'  // 半母音
  | 'nasal';       // Phase 7: 鼻音（口腔閉鎖 + velum 開放）

export interface ConsonantPreset {
  id: ConsonantId;
  ipa: string;                       // 'k', 'tɕ' 等
  category: ConsonantCategory;
  voiced: boolean;                   // 有声/無声
  // 閉鎖/狭窄区間の指定 (NUM_SECTIONS=44 における index 範囲)
  constrictionRange: { start: number; end: number };
  constrictionArea: number;          // cm² (閉鎖時=0.01, 摩擦時=0.10〜0.30)
  // ノイズパラメータ（摩擦音・バースト用）
  noise?: {
    centerFreq: number;              // Hz
    bandwidth: number;               // Hz
    gain: number;                    // 0.2〜0.8
  };
  // 時間構造
  closureMs?: number;                // 閉鎖区間長（破裂・破擦のみ）
  burstMs?: number;                  // バースト長（破裂・破擦のみ）
  frictionMs?: number;               // 摩擦区間長（摩擦・破擦）
  vot?: number;                      // ms (有声=負, 無声=正)
  // Phase 7: 鼻音時の velopharyngeal port 開放面積 (cm²)
  // 鼻音プリセットのみ指定 (1.5〜2.0 が典型)。非鼻音では undefined のまま。
  velopharyngealArea?: number;
}

// ===== UI コールバック型 =====

export type AreasChangeCallback = (areas: Float64Array) => void;
export type StateChangeCallback = (state: AppState) => void;
