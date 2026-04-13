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

// ===== 声道フィルタパラメータ =====

export const WALL_LOSS_FACTOR = 0.999;     // 壁面損失 mu
export const GLOTTAL_REFLECTION = 0.95;    // 声門端反射係数 r_glottis
export const LIP_REFLECTION = -0.85;       // 唇端反射係数 R_L
export const RADIATION_ALPHA = 0.97;       // 放射フィルタ係数 alpha

// ===== アプリケーション状態 =====

export type AppState = 'idle' | 'initializing' | 'running' | 'error';

// ===== メインスレッド → Worklet 通信メッセージ型（判別共用体） =====

export type WorkletMessage =
  | { type: 'setAreas'; areas: ArrayLike<number> }
  | { type: 'setSourceType'; sourceType: 'pulse' | 'noise' };
  // Phase 2 で追加: { type: 'setOQ'; oq: number }
  // Phase 4 で追加: { type: 'setJitter'; amount: number }
  // Phase 4 で追加: { type: 'setShimmer'; amount: number }
  // Phase 5 で追加: { type: 'setGlottalModel'; model: 'klglott88' | 'lf' }
  // Phase 5 で追加: { type: 'setRd'; rd: number }
  // Phase 5 で追加: { type: 'setAspiration'; level: number }

// ===== 母音プリセット型（Phase 2 で実データ投入） =====

export interface VowelPreset {
  name: string;           // 'a', 'i', 'u', 'e', 'o'
  label: string;          // 'あ', 'い', 'う', 'え', 'お'
  controlPoints: number[];  // 16要素 (cm²)
}

// ===== 声門パラメータ =====

export interface GlottalParams {
  openQuotient: number;   // 0.0〜1.0, デフォルト 0.6
  // Phase 2 で追加予定:
  // speedQuotient: number;
  // amplitude: number;
}

// ===== UI コールバック型 =====

export type AreasChangeCallback = (areas: Float64Array) => void;
export type StateChangeCallback = (state: AppState) => void;
