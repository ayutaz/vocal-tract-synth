// ===== 声門音源（三角波パルス列） =====
//
// Phase 1 の簡易音源。位相アキュムレータ方式で三角波パルス列を生成する。
// phase は呼び出し側（Worklet）で管理し、generate(phase) に渡すシグネチャにすることで
// Phase 2 以降で KLGLOTT88 / LF モデルに差し替え可能な統一インターフェースを取る。
//
// パルス形状（OQ = Open Quotient = 開放率）:
//   phase < OQ/2:  output = 2 * phase / OQ                (立ち上がり)
//   phase < OQ:    output = 2 * (1 - phase / OQ)          (立ち下がり)
//   phase >= OQ:   output = 0                              (閉鎖期)

import { DEFAULT_OQ } from '../types/index.js';

export class GlottalSource {
  // OQ は Phase 1 では固定（後で setOQ を追加予定）
  private openQuotient: number = DEFAULT_OQ;

  constructor() {
    // process() 内でのメモリアロケーションを避けるため、クラスフィールドで状態を保持する。
    // 現時点では内部状態は OQ のみだが、Phase 2 以降で LF モデルのパラメータを追加する。
  }

  /**
   * 与えられた位相（0.0〜1.0）から三角波パルス値を返す。
   * 位相の進行は呼び出し側で管理する（AudioWorklet 側で F0 / sampleRate を加算）。
   *
   * @param phase 現在の位相 [0.0, 1.0)
   * @returns 声門波形サンプル（概ね [0, 1]）
   */
  generate(phase: number): number {
    const oq = this.openQuotient;
    const halfOq = oq * 0.5;

    if (phase < halfOq) {
      // 立ち上がり期: 0 → 1
      return (2 * phase) / oq;
    } else if (phase < oq) {
      // 立ち下がり期: 1 → 0
      return 2 * (1 - phase / oq);
    } else {
      // 閉鎖期
      return 0;
    }
  }

  /**
   * 内部状態をリセットする（Phase 2 以降で LF モデルの状態変数を初期化する想定）。
   */
  reset(): void {
    // Phase 1 では内部状態がないため、特に何もしない。
    // インターフェースとして用意しておくことで、呼び出し側の変更を防ぐ。
  }

  /**
   * Open Quotient を設定する（Phase 2 以降で使用）。
   */
  setOpenQuotient(oq: number): void {
    // 0.01 〜 0.99 でクランプ（ゼロ除算 / 閉鎖期消失を防ぐ）
    if (oq < 0.01) oq = 0.01;
    if (oq > 0.99) oq = 0.99;
    this.openQuotient = oq;
  }
}
