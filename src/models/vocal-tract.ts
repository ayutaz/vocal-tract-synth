// ===== 声道フィルタ（Kelly-Lochbaum 連結管モデル） =====
//
// 44区間の連結管を Smith 式 1 乗算接合で実装する。
// 全バッファはコンストラクタで事前確保し、processSample() 内では new / [] / {} を行わない。
//
// 物理モデル:
//   各区間 k に断面積 A[k] を持ち、境界 k (区間 k と区間 k+1 の間) で散乱が起こる。
//   index 規約: 0 が唇側、N-1 が声門側。
//   前進波 f は声門側 (N-1) → 唇側 (0) の方向に進む。
//   後退波 b は唇側 (0) → 声門側 (N-1) の方向に進む。
//
//   Smith の 1 乗算接合公式 (境界 k で、区間 k+1 側から区間 k 側へ向かう前進波の視点):
//     r[k]    = (A[k+1] - A[k]) / (A[k+1] + A[k])
//     delta   = r[k] * (sf[k+1] - sb[k])
//     f[k]    = sf[k+1] + delta    ← 前進波が k+1 側から k 側に通過・反射
//     b[k+1]  = sb[k]   + delta    ← 後退波が k 側から k+1 側に通過・反射
//
// 離散化と 1 サンプル 2 半ステップ:
//   N=44 区間の離散化では区間長 Δx = c / (2·fs) ≈ 0.397 cm であり、
//   1 区間の通過時間は Δt/2 = 1/(2·fs)。すなわち 1 半ステップで波が 1 区間進み、
//   1 サンプル (Δt) の中で半ステップを 2 回実行する必要がある (Pink Trombone と同じ方式)。
//   そうすると片道 L (= N 区間) の伝搬時間は N 半ステップ = N/2 サンプルとなり、
//   L=17.5cm, c=35000cm/s の場合に基本共鳴 f1 = c / (4L) = 500 Hz が正しく現れる。
//   (半ステップが 1 回しかないと実効管長が 2L となり、基本共鳴が 250 Hz に半減する。)
//
// 境界条件 (各半ステップで適用):
//   声門端 (区間 N-1 側): f[N-1] = glottalSample + GLOTTAL_REFLECTION * sb[N-1]
//   唇端   (区間 0 側):   b[0]   = LIP_REFLECTION * sf[0]
//
// 実装上の重要点:
//   散乱ループは「現時刻の f, b」を入力として「次時刻の f, b」を計算するため、
//   単純な in-place 更新では一部の値を書き換えた後に旧値を読むことになり不正確。
//   ここでは f, b の旧値をスクラッチバッファに複製してから散乱と境界条件を適用する。
//
// 壁面損失:
//   1 サンプル (2 半ステップ) につき 1 回、全区間に係数 mu (≒0.999) を乗じる。
//
// 放射フィルタ:
//   唇先からの放射は 1 次差分: output = f[0] - alpha * prev_f0

import {
  NUM_SECTIONS,
  MIN_AREA,
  DEFAULT_AREA,
  WALL_LOSS_FACTOR,
  GLOTTAL_REFLECTION,
  LIP_REFLECTION,
  RADIATION_ALPHA,
} from '../types/index.js';

// 数値発散防止のソフトクリッピング閾値
const SOFT_CLIP_THRESHOLD = 10.0;

export class VocalTract {
  // 区間数
  private readonly n: number;

  // 波動変数 (前進波 / 後退波)
  private readonly forwardWave: Float64Array;
  private readonly backwardWave: Float64Array;

  // 散乱計算用の旧値スクラッチ
  private readonly scratchForward: Float64Array;
  private readonly scratchBackward: Float64Array;

  // 反射係数 (区間境界 N-1 個)
  private readonly reflectionCoefficients: Float64Array;

  // 断面積 (cm²)
  private readonly areas: Float64Array;

  // 放射フィルタの 1 サンプル前の唇側入力 (= 1 サンプル前の f[0])
  private prevLipInput: number = 0;

  constructor() {
    this.n = NUM_SECTIONS;
    this.forwardWave = new Float64Array(this.n);
    this.backwardWave = new Float64Array(this.n);
    this.scratchForward = new Float64Array(this.n);
    this.scratchBackward = new Float64Array(this.n);
    this.reflectionCoefficients = new Float64Array(this.n - 1);
    this.areas = new Float64Array(this.n);

    // デフォルトの均一管 (断面積 = 4.0 cm²) で初期化
    for (let i = 0; i < this.n; i++) {
      this.areas[i] = DEFAULT_AREA;
    }
    // 均一管なので反射係数は全てゼロ
    this.updateReflectionCoefficients();
  }

  /**
   * 1 サンプル分の波動伝搬を計算し、唇先からの放射音圧を返す。
   *
   * @param glottalSample 声門音源サンプル
   * @returns 唇先からの放射出力
   */
  processSample(glottalSample: number): number {
    const f = this.forwardWave;
    const b = this.backwardWave;
    const sf = this.scratchForward;
    const sb = this.scratchBackward;
    const r = this.reflectionCoefficients;
    const N = this.n;

    // ---- 1 サンプル = 2 半ステップ ----
    // 物理的に正しい離散化 (1 区間 = Δt/2 の遅延) を得るため、
    // 1 サンプルにつき散乱 + 境界条件を 2 回実行する。
    // glottalSample は 1 サンプル間 (Δt) 持続する圧源とみなし、両半ステップで注入する。
    for (let step = 0; step < 2; step++) {
      // ---- 1. 旧値をスクラッチへ複製 ----
      // 散乱 / 境界条件の計算では現時刻の値を参照するため、in-place 更新が誤作動しないよう
      // f, b の旧値を別バッファに保持する。
      for (let k = 0; k < N; k++) {
        sf[k] = f[k]!;
        sb[k] = b[k]!;
      }

      // ---- 2. 散乱ループ (境界 k = 0, ..., N-2) ----
      // Smith 1 乗算接合 (前進波は声門側 N-1 → 唇側 0 へ、後退波は逆方向へ進む):
      //   delta   = r[k] * (sf[k+1] - sb[k])
      //   f[k]    = sf[k+1] + delta
      //   b[k+1]  = sb[k]   + delta
      // 均一管では r[k]=0 なので f[k] = sf[k+1], b[k+1] = sb[k] の純粋な遅延となる。
      for (let k = 0; k < N - 1; k++) {
        const delta = r[k]! * (sf[k + 1]! - sb[k]!);
        f[k] = sf[k + 1]! + delta;
        b[k + 1] = sb[k]! + delta;
      }

      // ---- 3. 声門端境界条件 (区間 N-1 側) ----
      // 声門から新規入射される波と、声門端反射による b[N-1] の跳ね返りを合成。
      // 散乱ループでは f[N-1] は書かれない (k+1 <= N-1 ⇒ k <= N-2) ので、
      // ここで唯一の書き込みとなる。
      f[N - 1] = glottalSample + GLOTTAL_REFLECTION * sb[N - 1]!;

      // ---- 4. 唇端境界条件 (区間 0 側) ----
      // 唇端での反射 (放射インピーダンスにより負の反射係数)。
      // 声門端と同じく「前時刻の端点値」を反射するため、旧値 sf[0] を使う。
      // 散乱ループでは b[0] は書かれないので、ここが唯一の書き込みとなる。
      b[0] = LIP_REFLECTION * sf[0]!;
    }

    // ---- 5. 壁面損失 (1 サンプルにつき 1 回、全区間) ----
    const mu = WALL_LOSS_FACTOR;
    for (let k = 0; k < N; k++) {
      f[k] = f[k]! * mu;
      b[k] = b[k]! * mu;
    }

    // ---- 6. ソフトクリッピング (数値発散防止) ----
    // 通常動作では発動しないが、パラメータ変化による過渡で発振する場合に備えた保険。
    for (let k = 0; k < N; k++) {
      if (f[k]! > SOFT_CLIP_THRESHOLD) f[k] = SOFT_CLIP_THRESHOLD;
      else if (f[k]! < -SOFT_CLIP_THRESHOLD) f[k] = -SOFT_CLIP_THRESHOLD;
      if (b[k]! > SOFT_CLIP_THRESHOLD) b[k] = SOFT_CLIP_THRESHOLD;
      else if (b[k]! < -SOFT_CLIP_THRESHOLD) b[k] = -SOFT_CLIP_THRESHOLD;
    }

    // ---- 7. 放射フィルタ (1 次差分 HPF) ----
    //   output = f[0] - alpha * prev_f0
    const currentLipInput = f[0]!;
    const output = currentLipInput - RADIATION_ALPHA * this.prevLipInput;
    this.prevLipInput = currentLipInput;

    return output;
  }

  /**
   * 断面積配列を更新し、反射係数を再計算する。
   * MIN_AREA でクランプしてゼロ除算を防ぐ。
   *
   * @param newAreas 長さ NUM_SECTIONS の断面積配列
   */
  setAreas(newAreas: ArrayLike<number>): void {
    const N = this.n;
    const len = newAreas.length < N ? newAreas.length : N;
    for (let i = 0; i < len; i++) {
      let a = newAreas[i];
      if (a === undefined) continue;
      if (a < MIN_AREA) a = MIN_AREA;
      this.areas[i] = a;
    }
    // 入力が N より短い場合は残りをデフォルト値で埋める (念のため)
    for (let i = len; i < N; i++) {
      this.areas[i] = DEFAULT_AREA;
    }
    this.updateReflectionCoefficients();
  }

  /**
   * 反射係数 r[k] = (A[k+1] - A[k]) / (A[k+1] + A[k]) を計算する。
   * 区間 k と区間 k+1 の境界の反射係数で、N 区間に対して N-1 個。
   * A[k+1] + A[k] >= 2 * MIN_AREA なのでゼロ除算は発生しない。
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

  /**
   * 波動変数と放射フィルタ状態をゼロクリアする。断面積は保持する。
   */
  reset(): void {
    this.forwardWave.fill(0);
    this.backwardWave.fill(0);
    this.scratchForward.fill(0);
    this.scratchBackward.fill(0);
    this.prevLipInput = 0;
  }
}
