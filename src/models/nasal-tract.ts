// ===== 鼻腔管モデル（Phase 7: Kelly-Lochbaum 30 区間） =====
//
// 30 区間の鼻腔管を Smith 式 1 乗算接合で実装する。VocalTract と対称形で、
// 全バッファをコンストラクタで事前確保し、processSample() 内では
// new / [] / {} を行わない（GC-free）。
//
// 物理モデル:
//   index 0   = 鼻孔端（出力側、口腔の唇端に相当）
//   index N-1 = 鼻咽腔端（3 ポート接合で口腔軟口蓋に接続される側）
//
//   前進波 f は鼻咽腔端 (N-1) → 鼻孔端 (0) の方向に進む。
//   後退波 b は鼻孔端 (0) → 鼻咽腔端 (N-1) の方向に進む。
//
//   VocalTract と同じ符号規約:
//     r[k]    = (A[k+1] - A[k]) / (A[k+1] + A[k])
//     delta   = r[k] * (sf[k+1] - sb[k])
//     f[k]    = sf[k+1] + delta    ← 前進波が k+1 側から k 側へ通過・反射
//     b[k+1]  = sb[k]   + delta    ← 後退波が k 側から k+1 側へ通過・反射
//
// 1 サンプル = 2 半ステップ:
//   Kelly-Lochbaum の物理離散化条件（1 区間 = Δt/2 の遅延）を得るため、
//   1 サンプルにつき散乱 + 境界条件を 2 回実行する。
//
// 境界条件 (各半ステップで適用):
//   鼻咽腔端 (区間 N-1 側): f[N-1] = pharyngealInput
//     ※ VocalTract の声門端と異なり「声門反射」に相当するものは無い。
//        3 ポート接合側（VocalTract）でエネルギー保存が成立するため、
//        NasalTract 側は外部入力を素直に f[N-1] へ書き込むだけで良い。
//   鼻孔端 (区間 0 側):     b[0]   = LIP_REFLECTION * sf[0]
//     ※ 簡略化のため口腔の唇端反射係数 LIP_REFLECTION (-0.85) を流用。
//
// 断面積は時間不変（人間の鼻腔は発声中にほぼ変化しない）。
// よって反射係数もコンストラクタで 1 回計算するのみ。

import {
  NASAL_NUM_SECTIONS,
  WALL_LOSS_FACTOR,
  LIP_REFLECTION,
  RADIATION_ALPHA,
} from '../types/index.js';

// 鼻腔管の典型的断面積プロファイル (cm²)
// Dang & Honda (1994) の MRI ベース計測値を簡略化したもの。
// index 0 = 鼻孔端（出力側）, index 29 = 鼻咽腔端（口腔接合側）
// 長さ 11.4 cm に対して 30 点で離散化。
const NASAL_AREA_PROFILE: readonly number[] = [
  // 鼻孔（前方、出力端）: 狭く始まる
  0.5, 0.7, 1.0, 1.4, 1.8, 2.2,
  // 中央部（広い）
  2.5, 2.8, 3.0, 3.0, 2.9, 2.7, 2.5, 2.4, 2.3,
  // 後方部（一旦狭まる）
  2.1, 1.9, 1.7, 1.5, 1.4, 1.3, 1.3, 1.4, 1.5,
  // 鼻咽腔接合部（広めに開く）
  1.8, 2.2, 2.5, 2.8, 3.0, 3.2,
];

// 数値発散防止のソフトクリッピング閾値（VocalTract と共通値）
const SOFT_CLIP_THRESHOLD = 10.0;

export class NasalTract {
  // 区間数 (= NASAL_NUM_SECTIONS = 30)
  private readonly n: number = NASAL_NUM_SECTIONS;

  // 波動変数 (前進波 / 後退波)
  private readonly forwardWave: Float64Array;
  private readonly backwardWave: Float64Array;

  // 散乱計算用の旧値スクラッチ
  private readonly scratchForward: Float64Array;
  private readonly scratchBackward: Float64Array;

  // 反射係数 (区間境界 N-1 個、固定値)
  private readonly reflectionCoefficients: Float64Array;

  // 断面積 (cm²、固定プロファイル)
  private readonly areas: Float64Array;

  // 放射フィルタの 1 サンプル前の鼻孔側入力 (= 1 サンプル前の f[0])
  private prevNostrilInput: number = 0;

  constructor() {
    this.forwardWave = new Float64Array(this.n);
    this.backwardWave = new Float64Array(this.n);
    this.scratchForward = new Float64Array(this.n);
    this.scratchBackward = new Float64Array(this.n);
    this.reflectionCoefficients = new Float64Array(this.n - 1);

    // NASAL_AREA_PROFILE からコピーして断面積を固定
    // (長さが合致しない場合は事前確保した Float64Array の範囲内でコピー)
    this.areas = new Float64Array(this.n);
    const len = NASAL_AREA_PROFILE.length < this.n ? NASAL_AREA_PROFILE.length : this.n;
    for (let i = 0; i < len; i++) {
      this.areas[i] = NASAL_AREA_PROFILE[i]!;
    }

    // 反射係数をコンストラクタで 1 回のみ計算（以降は不変）
    this.updateReflectionCoefficients();
  }

  /**
   * 1 半ステップ分の散乱 + 境界条件のみを進める（壁面損失 / ソフトクリップ / 放射フィルタは適用しない）。
   *
   * Phase 7 レビュー対応: 鼻腔管呼び出しの時間スケール不整合修正。
   * VocalTract.processSample は 1 サンプル内で 2 半ステップのループを回し、
   * 各 step ごとに 3 ポート接合で鼻咽腔への入射波を更新する。
   * 以前の実装では NasalTract.processSample が内部で再度 2 半ステップ回していたため、
   * 1 サンプル呼び出しで鼻腔管は実質 4 半ステップ進み、かつ step=0 の入射波は捨てられていた。
   *
   * この processHalfStep は VocalTract 側の step ループと 1:1 で同期するために使用する。
   * 1 サンプルにつき 2 回呼ばれる想定で、壁面損失 / ソフトクリップ / 放射は
   * 2 半ステップ目の直後に finalizeSample() で 1 回だけ適用する。
   *
   * @param pharyngealInput この半ステップで 3 ポート接合から鼻咽腔端 (index N-1) に入射する波
   */
  processHalfStep(pharyngealInput: number): void {
    const f = this.forwardWave;
    const b = this.backwardWave;
    const sf = this.scratchForward;
    const sb = this.scratchBackward;
    const r = this.reflectionCoefficients;
    const N = this.n;

    // ---- 1. 旧値をスクラッチへ複製 ----
    for (let k = 0; k < N; k++) {
      sf[k] = f[k]!;
      sb[k] = b[k]!;
    }

    // ---- 2. 散乱ループ (境界 k = 0, ..., N-2) ----
    // Smith 1 乗算接合 (VocalTract と同じ符号規約):
    //   delta   = r[k] * (sf[k+1] - sb[k])
    //   f[k]    = sf[k+1] + delta
    //   b[k+1]  = sb[k]   + delta
    for (let k = 0; k < N - 1; k++) {
      const delta = r[k]! * (sf[k + 1]! - sb[k]!);
      f[k] = sf[k + 1]! + delta;
      b[k + 1] = sb[k]! + delta;
    }

    // ---- 3. 鼻咽腔端境界条件 (区間 N-1 側) ----
    // 3 ポート接合から入射する波を f[N-1] にそのまま書き込む。
    // 散乱ループでは f[N-1] は書かれない (k+1 <= N-1 ⇒ k <= N-2) ため、
    // ここが唯一の書き込みとなる。
    f[N - 1] = pharyngealInput;

    // ---- 4. 鼻孔端境界条件 (区間 0 側) ----
    // 鼻孔での開口端反射 (放射インピーダンスにより負の反射係数)。
    // 簡略化のため LIP_REFLECTION (-0.85) を流用する。
    // 散乱ループでは b[0] は書かれないので、ここが唯一の書き込みとなる。
    b[0] = LIP_REFLECTION * sf[0]!;
  }

  /**
   * 1 サンプル分の締め処理（壁面損失 + ソフトクリップ + 放射フィルタ）を実行し、
   * 鼻孔からの放射出力を返す。
   *
   * Phase 7 レビュー対応: VocalTract の processSample で 2 回の processHalfStep を
   * 呼び終えたあと、1 サンプルにつき 1 回だけ呼ぶ。
   *
   * @returns 鼻孔端 (index 0) からの放射出力
   */
  finalizeSample(): number {
    const f = this.forwardWave;
    const b = this.backwardWave;
    const N = this.n;

    // ---- 5. 壁面損失 (1 サンプルにつき 1 回、全区間) ----
    const mu = WALL_LOSS_FACTOR;
    for (let k = 0; k < N; k++) {
      f[k] = f[k]! * mu;
      b[k] = b[k]! * mu;
    }

    // ---- 6. ソフトクリッピング (数値発散防止) ----
    for (let k = 0; k < N; k++) {
      if (f[k]! > SOFT_CLIP_THRESHOLD) f[k] = SOFT_CLIP_THRESHOLD;
      else if (f[k]! < -SOFT_CLIP_THRESHOLD) f[k] = -SOFT_CLIP_THRESHOLD;
      if (b[k]! > SOFT_CLIP_THRESHOLD) b[k] = SOFT_CLIP_THRESHOLD;
      else if (b[k]! < -SOFT_CLIP_THRESHOLD) b[k] = -SOFT_CLIP_THRESHOLD;
    }

    // ---- 7. 放射フィルタ (1 次差分 HPF) ----
    //   output = f[0] - alpha * prev_f0
    const currentNostrilInput = f[0]!;
    const output = currentNostrilInput - RADIATION_ALPHA * this.prevNostrilInput;
    this.prevNostrilInput = currentNostrilInput;

    return output;
  }

  /**
   * 1 サンプル分の波動伝搬を計算し、鼻孔からの放射音圧を返す。
   *
   * Phase 7 レビュー対応: 内部で processHalfStep を 2 回呼び、
   * 最後に finalizeSample で締める構造に変更した。
   * 両半ステップとも同じ pharyngealInput を受け取るので、後方互換を維持しつつ
   * 既存テスト（インパルス応答・長時間安定性・reset 同一性等）は従来通り動作する。
   *
   * VocalTract 側と連携する運用では processHalfStep / finalizeSample を直接呼び、
   * step ごとに正しい pharyngealInput を渡すことで時間スケールの整合性を確保する。
   *
   * @param pharyngealInput 3 ポート接合から鼻咽腔端 (index N-1) に入射する波
   * @returns 鼻孔端 (index 0) からの放射出力
   */
  processSample(pharyngealInput: number): number {
    this.processHalfStep(pharyngealInput);
    this.processHalfStep(pharyngealInput);
    return this.finalizeSample();
  }

  /**
   * 3 ポート接合の b_n に対応: 鼻咽腔端 (index N-1) の現在の後退波。
   * VocalTract 側の 3 ポート接合で「鼻腔から接合点へ向かう後退波」として参照される。
   */
  getPharyngealBackwardWave(): number {
    return this.backwardWave[this.n - 1]!;
  }

  /**
   * 3 ポート接合の A_n に対応: 鼻咽腔端の断面積。
   */
  getPharyngealArea(): number {
    return this.areas[this.n - 1]!;
  }

  /**
   * 波動変数と放射フィルタ状態をゼロクリアする。断面積は保持する
   * （鼻腔断面積は固定プロファイルのため、そもそも変更されない）。
   */
  reset(): void {
    this.forwardWave.fill(0);
    this.backwardWave.fill(0);
    this.scratchForward.fill(0);
    this.scratchBackward.fill(0);
    this.prevNostrilInput = 0;
  }

  /**
   * 反射係数 r[k] = (A[k+1] - A[k]) / (A[k+1] + A[k]) を計算する。
   * 区間 k と区間 k+1 の境界の反射係数で、N 区間に対して N-1 個。
   * 断面積プロファイルは全要素 > 0 なのでゼロ除算は発生しない。
   *
   * NasalTract ではコンストラクタで 1 回のみ呼ばれる（以降は不変）。
   */
  private updateReflectionCoefficients(): void {
    const A = this.areas;
    const r = this.reflectionCoefficients;
    const N = this.n;
    for (let k = 0; k < N - 1; k++) {
      const sum = A[k + 1]! + A[k]!;
      const diff = A[k + 1]! - A[k]!;
      r[k] = diff / sum;
    }
  }
}
