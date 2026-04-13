// ===== KLGLOTT88 声門音源モデル =====
//
// Phase 1 の三角波パルスを KLGLOTT88 多項式モデルに置き換えた声門音源。
// GlottalModel インターフェース (types/index.ts) を実装する。
//
// KLGLOTT88 波形関数:
//   正規化位相 t_n = phase / OQ (開放相のみ)
//   開放相 (0 <= phase < OQ):
//     output = 27/4 * t_n^2 * (1 - t_n)
//     → t_n=2/3 で最大値 1.0、t_n=0 と t_n=1 で 0
//   閉鎖相 (OQ <= phase < 1.0):
//     output = 0
//
// 有声/無声クロスフェード:
//   generateWithMix(phase) は有声パルスとノイズを voicedGain / noiseGain で
//   線形クロスフェードする。切替時は CROSSFADE_SAMPLES (330サンプル ≈ 7.5ms) で遷移。
//   ノイズはLCG乱数で生成し、Math.random() を避ける (GC回避)。

import {
  DEFAULT_OQ,
  MIN_OQ,
  MAX_OQ,
  CROSSFADE_SAMPLES,
} from '../types/index.js';
import type { GlottalModel, SourceType } from '../types/index.js';

export class Klglott88Source implements GlottalModel {
  // OQ (Open Quotient): 声門が開いている割合
  private openQuotient: number = DEFAULT_OQ;
  // OQ変更を次の閉鎖相まで遅延（開放相途中の変更による波形不連続を防止）
  private pendingOQ: number | null = null;

  // 有声/無声の状態
  private sourceType: SourceType = 'voiced';
  private crossfadeRemaining: number = 0;
  private crossfadeTotal: number = CROSSFADE_SAMPLES;
  private voicedGain: number = 1.0;
  private noiseGain: number = 0.0;

  // LCG 乱数シード (Uint32相当、>>> 0 でビット演算)
  private noiseSeed: number = 12345;

  constructor() {
    // process() 内でのメモリアロケーションを避けるため、クラスフィールドで状態を保持する。
  }

  /**
   * KLGLOTT88 多項式による声門パルス波形を返す。
   * 純粋な声門パルスのみ（ノイズミキシングなし）。
   *
   * @param phase 現在の位相 [0.0, 1.0)
   * @returns 声門波形サンプル [0, 1]
   */
  generate(phase: number): number {
    const oq = this.openQuotient;

    if (phase >= oq) {
      // 閉鎖相 — pending OQ があればここで適用（波形不連続を防止）
      if (this.pendingOQ !== null) {
        this.openQuotient = this.pendingOQ;
        this.pendingOQ = null;
      }
      return 0;
    }

    // 開放相: 正規化位相 t_n = phase / OQ
    const tn = phase / oq;
    // KLGLOTT88: 27/4 * t_n^2 * (1 - t_n)
    // 6.75 = 27/4、t_n=2/3 で最大値 1.0
    return 6.75 * tn * tn * (1 - tn);
  }

  /**
   * 有声パルスとノイズをクロスフェードミキシングした最終出力を返す。
   * AudioWorklet の process() ループからはこちらを呼ぶ。
   *
   * @param phase 現在の位相 [0.0, 1.0)
   * @returns ミキシング済みサンプル
   */
  generateWithMix(phase: number): number {
    // クロスフェード進行
    if (this.crossfadeRemaining > 0) {
      this.crossfadeRemaining--;
      const t = 1 - this.crossfadeRemaining / this.crossfadeTotal;
      if (this.sourceType === 'noise') {
        // voiced → noise 遷移
        this.voicedGain = 1 - t;
        this.noiseGain = t;
      } else {
        // noise → voiced 遷移
        this.voicedGain = t;
        this.noiseGain = 1 - t;
      }
    }

    const voiced = this.generate(phase);
    const noise = this.generateNoise();
    return voiced * this.voicedGain + noise * this.noiseGain;
  }

  /**
   * 音源タイプを切り替える。同一タイプの場合は何もしない。
   * 切替時は CROSSFADE_SAMPLES かけて線形クロスフェードする。
   */
  setSourceType(type: SourceType): void {
    if (type === this.sourceType) return;
    this.sourceType = type;
    this.crossfadeRemaining = this.crossfadeTotal;
  }

  /**
   * Open Quotient を設定する。MIN_OQ〜MAX_OQ でクランプ。
   */
  setOpenQuotient(oq: number): void {
    if (oq < MIN_OQ) oq = MIN_OQ;
    if (oq > MAX_OQ) oq = MAX_OQ;
    // 次の閉鎖相で適用（開放相途中の変更による波形クリックを防止）
    this.pendingOQ = oq;
  }

  /**
   * 内部状態をリセットする。
   */
  reset(): void {
    this.openQuotient = DEFAULT_OQ;
    this.pendingOQ = null;
    this.sourceType = 'voiced';
    this.crossfadeRemaining = 0;
    this.voicedGain = 1.0;
    this.noiseGain = 0.0;
    this.noiseSeed = 12345;
  }

  /**
   * LCG (Linear Congruential Generator) による擬似乱数ノイズ。
   * Math.random() を避けて GC を回避する。
   *
   * @returns [-1, 1] の範囲のノイズサンプル
   */
  private generateNoise(): number {
    // LCG パラメータ: Numerical Recipes 準拠
    this.noiseSeed = (this.noiseSeed * 1664525 + 1013904223) >>> 0;
    return this.noiseSeed / 4294967296 * 2 - 1;
  }
}
