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
  MIN_AREA_PROGRAM,
  DEFAULT_AREA,
  WALL_LOSS_FACTOR,
  GLOTTAL_REFLECTION,
  LIP_REFLECTION,
  RADIATION_ALPHA,
  SAMPLE_RATE,
  NASAL_JUNCTION_INDEX,
} from '../types/index.js';
import { NasalTract } from './nasal-tract.js';

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

  // ===== Phase 6: 狭窄ノイズ注入 =====
  // 摩擦音・破裂音バーストのために、指定区間 k の前進波 f[k] にバンドパス整形済みノイズを注入する。
  // 全パラメータと状態をコンストラクタで事前確保し、processSample() 内ではアロケーション一切なし。
  // -1 は無効状態 (ノイズ計算自体をスキップ)。
  private constrictionPosition: number = -1;
  private constrictionGain: number = 0;
  // LCG ノイズ用シード（声門音源の乱数とは独立）
  private noiseSeed: number = 13579;
  // Biquad BPF 係数 (RBJ Cookbook, constant 0 dB peak gain, Direct Form II Transposed)
  private bpfB0: number = 0;
  private bpfB1: number = 0;
  private bpfB2: number = 0;
  private bpfA1: number = 0;
  private bpfA2: number = 0;
  // Biquad BPF 状態変数（Direct Form II Transposed）
  private bpfZ1: number = 0;
  private bpfZ2: number = 0;

  // ===== Phase 7: 鼻腔分岐管 =====
  // 30 区間の鼻腔管を保持し、velum 開放時 (velopharyngealArea > 0) のみ
  // 3 ポート Smith 接合を経由して口腔管と結合する。
  // velopharyngealArea === 0 のとき、散乱ループは従来の 2 ポート分岐のみを実行し、
  // 鼻腔管の processSample 呼び出しもスキップされるため、Phase 6 までの動作と完全同一。
  private readonly nasalTract: NasalTract;
  // velopharyngeal port area (cm²): 0 = 閉鎖, 1.5〜2.0 = 全開（鼻音時の典型値）
  private velopharyngealArea: number = 0;
  // 3 ポート接合の事前計算: 1 / (A_p + A_o + A_n)
  // setNasalCoupling / setAreas 時に再計算し、processSample では参照のみ。
  private cachedNasalASumInv: number = 0;
  // 3 ポート接合から鼻腔管側へ注入される入射波 (= 2k - w_n)
  // 散乱ループ内で計算し、processSample 末尾で nasalTract.processSample に渡す。
  private nasalPharyngealInput: number = 0;

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

    // Phase 7: 鼻腔分岐管を初期化（velum 閉鎖状態なので発声には影響しない）
    this.nasalTract = new NasalTract();
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

    // Phase 7: 鼻腔カップリング判定（散乱ループ内の毎サンプル分岐を避けるためループ外で計算）
    // velopharyngealArea === 0 のときはループ内で 3 ポート分岐に入らない = Phase 6 と完全同一挙動。
    const nasalOn = this.velopharyngealArea > 0;
    const J = NASAL_JUNCTION_INDEX;

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
      //
      // Phase 7: nasalOn && k === J - 1 のとき、境界 J-1（区間 J-1 と J の間、
      // すなわち軟口蓋位置）で通常の 2 ポート接合を 3 ポート Smith 接合に置き換える。
      // A_n = 0 （velum 閉鎖）のときは分岐に入らないため、既存の 2 ポート挙動と完全同一。
      for (let k = 0; k < N - 1; k++) {
        if (nasalOn && k === J - 1) {
          // ---- 3 ポート Smith 接合（軟口蓋 velum 位置） ----
          // 口腔前方ポート p: 区間 J 側（声門側）から接合点へ向かう前進波 = sf[J]
          // 口腔後方ポート o: 区間 J-1 側（唇側）から接合点へ向かう後退波 = sb[J-1]
          // 鼻腔ポート n:    鼻咽腔端 (nasal idx N_nasal-1) から接合点へ向かう後退波
          //
          // 接合点の共通圧力 k_pressure = (A_p*w_p + A_o*w_o + A_n*w_n) / (A_p+A_o+A_n)
          // 散乱後の各波:
          //   f[k]  (= 区間 J-1 の前進波、唇側方向)        = 2k - w_p
          //   b[k+1](= 区間 J   の後退波、声門側方向)      = 2k - w_o
          //   鼻腔への入射波                                = 2k - w_n
          const w_p = sf[k + 1]!;
          const w_o = sb[k]!;
          const w_n = this.nasalTract.getPharyngealBackwardWave();
          const A_p = this.areas[k + 1]!;
          const A_o = this.areas[k]!;
          const A_n = this.velopharyngealArea;
          const k_pressure = (A_p * w_p + A_o * w_o + A_n * w_n) * this.cachedNasalASumInv;
          const two_k = 2 * k_pressure;
          f[k] = two_k - w_p;
          b[k + 1] = two_k - w_o;
          // 鼻腔への入射波は step ごとに上書きされ、最終的に step=1 の値が nasalTract に渡される
          this.nasalPharyngealInput = two_k - w_n;
        } else {
          // 通常の 2 ポート Smith 1 乗算接合
          const delta = r[k]! * (sf[k + 1]! - sb[k]!);
          f[k] = sf[k + 1]! + delta;
          b[k + 1] = sb[k]! + delta;
        }
      }

      // ---- 2.5 Phase 6: 狭窄ノイズ注入 ----
      // 散乱直後・境界条件適用前に、指定区間 k の前進波 f[k] へ BPF 整形済み白色雑音を加算する。
      // 計算コスト削減のため step===0 (1 サンプルあたり 1 回) のみ実行する。
      // 合計 8 ops/sample (LCG 2 + Biquad 5 + 加算 1)。
      if (step === 0 && this.constrictionPosition >= 0) {
        // LCG 線形合同法による白色雑音 (32bit Math.imul で GC-free)
        this.noiseSeed = (Math.imul(this.noiseSeed, 1664525) + 1013904223) | 0;
        // 2^-31 で正規化 → [-1, 1)
        const white = this.noiseSeed * 4.6566128730773926e-10;

        // Biquad BPF (Direct Form II Transposed)
        const bp = this.bpfB0 * white + this.bpfZ1;
        this.bpfZ1 = this.bpfB1 * white - this.bpfA1 * bp + this.bpfZ2;
        this.bpfZ2 = this.bpfB2 * white - this.bpfA2 * bp;

        // 前進波に注入
        const cp = this.constrictionPosition;
        f[cp] = f[cp]! + this.constrictionGain * bp;
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

    // ---- 7. 口腔放射フィルタ (1 次差分 HPF) ----
    //   oralOutput = f[0] - alpha * prev_f0
    const currentLipInput = f[0]!;
    const oralOutput = currentLipInput - RADIATION_ALPHA * this.prevLipInput;
    this.prevLipInput = currentLipInput;

    // ---- 8. Phase 7: 鼻腔管の処理と出力ミキシング ----
    // velum 閉鎖時 (velopharyngealArea === 0) は鼻腔管の処理自体をスキップし、
    // nasalPharyngealInput も 0 のままなので鼻腔管の状態は進まない → Phase 6 と完全同一。
    // velum 開放時は step ループ内で計算された最新の nasalPharyngealInput
    // （= 2 半ステップ目で上書きされた値）を 1 サンプル分の入射波として鼻腔管に渡す。
    // 1 サンプル = 2 半ステップ構造は NasalTract.processSample 側が内部的に実装しているため、
    // ここでは 1 サンプルにつき 1 回だけ呼ぶ。
    let nasalOutput = 0;
    if (nasalOn) {
      nasalOutput = this.nasalTract.processSample(this.nasalPharyngealInput);
      // 次サンプルで散乱ループが走るまで再利用されないようクリア
      this.nasalPharyngealInput = 0;
    }

    return oralOutput + nasalOutput;
  }

  /**
   * 断面積配列を更新し、反射係数を再計算する。
   * Phase 6 以降は MIN_AREA_PROGRAM (=0.01 cm²) でクランプし、子音の完全閉鎖や強い狭窄を許容する。
   * UI ドラッグ操作の下限 (MIN_AREA=0.3 cm²) は tract-editor.ts 側で別途クランプされるため、
   * ここでは触らない。これにより「UI 上は 0.3 cm² まで、プログラム制御は 0.01 cm² まで」の二段化を実現する。
   *
   * @param newAreas 長さ NUM_SECTIONS の断面積配列
   */
  setAreas(newAreas: ArrayLike<number>): void {
    const N = this.n;
    const len = newAreas.length < N ? newAreas.length : N;
    for (let i = 0; i < len; i++) {
      let a = newAreas[i];
      if (a === undefined) continue;
      if (a < MIN_AREA_PROGRAM) a = MIN_AREA_PROGRAM;
      this.areas[i] = a;
    }
    // 入力が N より短い場合は残りをデフォルト値で埋める (念のため)
    for (let i = len; i < N; i++) {
      this.areas[i] = DEFAULT_AREA;
    }
    this.updateReflectionCoefficients();
  }

  /**
   * Phase 6: 狭窄ノイズ注入を設定する。
   *
   * 摩擦音 (s, sh, h 等) の持続的狭窄ノイズや、破裂音 (k, t, p 等) のバースト用に、
   * 指定区間 position の前進波 f[position] へ Biquad BPF 整形済み白色雑音を加算する。
   *
   * Biquad 係数は RBJ Audio EQ Cookbook の BPF (constant 0 dB peak gain) で計算する。
   *
   * 無効化:
   *   - position < 0
   *   - intensity === 0
   *   いずれかの場合は constrictionPosition = -1 とし、processSample() 内のノイズ計算をスキップする。
   *   合わせて Biquad 状態変数 (bpfZ1, bpfZ2) もリセットする。
   *
   * @param position    44区間中のノイズ注入インデックス (0..N-1, 負値で無効化)
   * @param intensity   ノイズゲイン (0..1 程度を想定。0 で無効化)
   * @param centerFreq  BPF の中心周波数 [Hz]
   * @param bandwidth   BPF の帯域幅 [Hz] (Q = centerFreq / bandwidth)
   * @param sampleRate  サンプルレート [Hz] (デフォルト SAMPLE_RATE)
   */
  setConstrictionNoise(
    position: number,
    intensity: number,
    centerFreq: number,
    bandwidth: number,
    sampleRate: number = SAMPLE_RATE,
  ): void {
    // 無効化条件: position が負、または intensity が 0 → ノイズ計算自体をスキップ
    if (position < 0 || intensity === 0 || centerFreq <= 0 || bandwidth <= 0) {
      this.constrictionPosition = -1;
      this.constrictionGain = 0;
      // フィルタ状態リセット (再有効化時のクリックノイズ防止)
      this.bpfZ1 = 0;
      this.bpfZ2 = 0;
      return;
    }

    // 範囲チェック (区間外は無効化)
    if (position >= this.n) {
      this.constrictionPosition = -1;
      this.constrictionGain = 0;
      this.bpfZ1 = 0;
      this.bpfZ2 = 0;
      return;
    }

    this.constrictionPosition = position | 0;
    this.constrictionGain = intensity;

    // ===== RBJ Audio EQ Cookbook: BPF (constant 0 dB peak gain) =====
    //   omega = 2π * f0 / fs
    //   Q     = f0 / BW
    //   alpha = sin(omega) / (2Q)
    //   b0 =  alpha
    //   b1 =  0
    //   b2 = -alpha
    //   a0 =  1 + alpha
    //   a1 = -2 * cos(omega)
    //   a2 =  1 - alpha
    // 全係数を a0 で正規化して保存する。
    const omega = (2 * Math.PI * centerFreq) / sampleRate;
    const Q = centerFreq / bandwidth;
    const sinOmega = Math.sin(omega);
    const cosOmega = Math.cos(omega);
    const alpha = sinOmega / (2 * Q);

    const b0 = alpha;
    const b1 = 0;
    const b2 = -alpha;
    const a0 = 1 + alpha;
    const a1 = -2 * cosOmega;
    const a2 = 1 - alpha;

    const invA0 = 1 / a0;
    this.bpfB0 = b0 * invA0;
    this.bpfB1 = b1 * invA0;
    this.bpfB2 = b2 * invA0;
    this.bpfA1 = a1 * invA0;
    this.bpfA2 = a2 * invA0;
  }

  /**
   * 反射係数 r[k] = (A[k+1] - A[k]) / (A[k+1] + A[k]) を計算する。
   * 区間 k と区間 k+1 の境界の反射係数で、N 区間に対して N-1 個。
   * A[k+1] + A[k] >= 2 * MIN_AREA_PROGRAM なのでゼロ除算は発生しない。
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
   * 現在の断面積配列を読み取り専用ビューとして返す。
   *
   * Phase 6: scheduleTransition の補間始点として「現在の声道形状」を取得するために追加。
   * worklet-processor.ts 側で transitionStartAreas に複製する用途を想定し、
   * 内部バッファをそのまま返す（コピーは呼び出し側の責務）。
   */
  getCurrentAreas(): Readonly<Float64Array> {
    return this.areas;
  }

  /**
   * Phase 7: 鼻腔カップリング面積（velopharyngeal area）を設定する。
   *
   * area === 0 で velum 閉鎖（鼻腔側の計算を完全スキップ → Phase 6 と同一挙動）。
   * area > 0 で velum 開放（3 ポート Smith 接合が起動し、鼻腔管が駆動される）。
   *
   * 事前計算として 1 / (A_p + A_o + A_n) を cachedNasalASumInv に格納する。
   * これにより processSample 内の 3 ポート接合で除算を回避できる。
   * なお setAreas で A_p, A_o が変わった場合にも再計算が必要だが、
   * 呼び出し側 (worklet-processor) が setAreas 後に setNasalCoupling を呼び直す運用を想定する。
   *
   * @param area velopharyngeal area (cm²). 0=閉鎖, 1.5-2.0=鼻音時全開
   */
  setNasalCoupling(area: number): void {
    if (!Number.isFinite(area) || area < 0) return;
    this.velopharyngealArea = area;
    if (area > 0) {
      // A_p = 声門側区間 (NASAL_JUNCTION_INDEX)
      // A_o = 唇側区間 (NASAL_JUNCTION_INDEX - 1)
      // A_n = velopharyngealArea
      const Ap = this.areas[NASAL_JUNCTION_INDEX]!;
      const Ao = this.areas[NASAL_JUNCTION_INDEX - 1]!;
      this.cachedNasalASumInv = 1.0 / (Ap + Ao + area);
    } else {
      this.cachedNasalASumInv = 0;
    }
  }

  /**
   * Phase 7: 現在の velopharyngeal area を返す。
   */
  getNasalCoupling(): number {
    return this.velopharyngealArea;
  }

  /**
   * Phase 7: 内部の NasalTract インスタンスを返す（テスト/デバッグ用）。
   */
  getNasalTract(): NasalTract {
    return this.nasalTract;
  }

  /**
   * 波動変数と放射フィルタ状態をゼロクリアする。断面積は保持する。
   * Phase 6: 狭窄ノイズ用 Biquad BPF の状態変数もクリア (フィルタ係数と
   * constrictionPosition/Gain は保持し、setConstrictionNoise() の再呼び出しを不要にする)。
   * Phase 7: NasalTract の状態と 3 ポート接合由来の入射波バッファもクリア。
   */
  reset(): void {
    this.forwardWave.fill(0);
    this.backwardWave.fill(0);
    this.scratchForward.fill(0);
    this.scratchBackward.fill(0);
    this.prevLipInput = 0;
    // Phase 6: BPF 状態変数のクリア
    this.bpfZ1 = 0;
    this.bpfZ2 = 0;
    // Phase 7: 鼻腔管の状態と 3 ポート接合由来の入射波バッファをクリア
    this.nasalTract.reset();
    this.nasalPharyngealInput = 0;
  }
}
