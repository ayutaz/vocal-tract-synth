// ===== 物理定数 =====

export const VOCAL_TRACT_LENGTH = 17.5;    // cm（成人男性）
export const SPEED_OF_SOUND = 35000;        // cm/s（体温）
export const SAMPLE_RATE = 44100;           // Hz
export const NUM_SECTIONS = 44;             // 離散化区間数
export const NUM_CONTROL_POINTS = 16;       // UI制御点数
export const SECTION_LENGTH = VOCAL_TRACT_LENGTH / NUM_SECTIONS; // ≈ 0.397 cm

export const MIN_AREA = 0.3;   // cm²（ゼロ除算防止）
export const MAX_AREA = 10.0;  // cm²
export const DEFAULT_AREA = 4.0; // cm²（均一管）

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
  | { type: 'setAspiration'; level: number };

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

// ===== UI コールバック型 =====

export type AreasChangeCallback = (areas: Float64Array) => void;
export type StateChangeCallback = (state: AppState) => void;
