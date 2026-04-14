// ===== LF (Liljencrants-Fant) 声門音源モデル =====
//
// KLGLOTT88 の上位互換として、より物理的に忠実な声門波形を生成する。
// Rd パラメータ (Fant 1995) で音声品質を制御:
//   Rd ≈ 0.3: pressed voice（緊張した声）
//   Rd ≈ 1.0: modal voice（通常の声）
//   Rd ≈ 2.7: breathy voice（息まじりの声）
//
// LF 波形:
//   開放相 (0 <= t <= Te):
//     E(t) = E0 * exp(alpha * t) * sin(omega_g * t)
//   閉鎖相 (Te <= t <= T0):
//     E(t) = -(Ee / (epsilon * Ta)) * (exp(-epsilon*(t-Te)) - exp(-epsilon*(T0-Te)))
//
// GlottalModel インターフェース (types/index.ts) を実装する。
// process() から呼ばれるため GC-free (new/[]/{} 禁止)。

import {
  CROSSFADE_SAMPLES,
  SAMPLE_RATE,
} from '../types/index.js';
import type { GlottalModel, SourceType } from '../types/index.js';

// LF パラメータの安全限界
const RD_MIN = 0.3;
const RD_MAX = 2.7;
const RD_DEFAULT = 1.0;

// Newton-Raphson 反復上限
const NR_MAX_ITER = 10;
// Newton-Raphson 収束判定閾値
const NR_TOLERANCE = 1e-10;

// 気息ノイズバンドパスフィルタ (2次IIR biquad) の係数
// 中心周波数 ≈ 2000Hz, Q ≈ 0.7 (広帯域)、fs = 44100Hz
// 事前計算した固定係数（GC回避のため定数化）
const BPF_CENTER = 2000;
const BPF_Q = 0.7;
// 以下は initBiquadCoeffs() で一度だけ計算する値をモジュールレベルで事前算出
const BPF_W0 = 2 * Math.PI * BPF_CENTER / SAMPLE_RATE;
const BPF_ALPHA_BQ = Math.sin(BPF_W0) / (2 * BPF_Q);
const BPF_B0 = BPF_ALPHA_BQ;
const BPF_B1 = 0;
const BPF_B2 = -BPF_ALPHA_BQ;
const BPF_A0 = 1 + BPF_ALPHA_BQ;
const BPF_A1 = -2 * Math.cos(BPF_W0);
const BPF_A2 = 1 - BPF_ALPHA_BQ;
// 正規化済み係数
const BPF_NB0 = BPF_B0 / BPF_A0;
const BPF_NB1 = BPF_B1 / BPF_A0;
const BPF_NB2 = BPF_B2 / BPF_A0;
const BPF_NA1 = BPF_A1 / BPF_A0;
const BPF_NA2 = BPF_A2 / BPF_A0;


export class LFGlottalSource implements GlottalModel {
  // === Rd パラメータ ===
  private rd: number = RD_DEFAULT;
  private pendingRd: number | null = null;

  // === 気息ノイズレベル ===
  private aspirationLevel: number = 0;

  // === LF 波形パラメータ (Rd と F0 から導出) ===
  private Tp: number = 0;
  private Te: number = 0;
  private Ta: number = 0;
  private T0: number = 0;
  private alpha: number = 0;
  private epsilon: number = 0;
  private E0: number = 0;
  private omegaG: number = 0;

  // 閉鎖相の正規化定数: -(Ee / (epsilon * Ta))
  private returnCoeff: number = 0;
  // 閉鎖相の減衰終端: exp(-epsilon * (T0 - Te))
  private returnTail: number = 0;

  // 前回の F0 (再計算判定用)
  private lastF0: number = 0;

  // 正規化された Ee (開放相ピーク振幅から導出)
  private Ee: number = 1;

  // === 有声/無声クロスフェード (Klglott88Source と同パターン) ===
  private sourceType: SourceType = 'voiced';
  private crossfadeRemaining: number = 0;
  private crossfadeTotal: number = CROSSFADE_SAMPLES;
  private voicedGain: number = 1.0;
  private noiseGain: number = 0.0;

  // === LCG 乱数シード (Uint32 相当) ===
  private noiseSeed: number = 12345;

  // === 気息ノイズ用 Biquad バンドパスフィルタの状態変数 ===
  private bpfX1: number = 0;
  private bpfX2: number = 0;
  private bpfY1: number = 0;
  private bpfY2: number = 0;

  // === パラメータ再計算済みフラグ ===
  private paramsValid: boolean = false;

  constructor() {
    // process() 内でのメモリアロケーションを避けるため、クラスフィールドで状態を保持する。
  }

  // ================================================================
  // Rd → LF パラメータ変換 (Fant 1995)
  // ================================================================

  /**
   * LF モデルのパラメータを Rd と F0 から再計算する。
   * 声門周期の開始時 (phase ≈ 0) にのみ呼ぶ。
   */
  updateParams(f0: number): void {
    // pending Rd があれば適用
    const hasPendingRd = this.pendingRd !== null;
    if (hasPendingRd) {
      this.rd = this.pendingRd!;
      this.pendingRd = null;
    }

    // F0 も Rd も変わっていなければ再計算不要
    if (this.paramsValid && f0 === this.lastF0 && !hasPendingRd) return;

    const Rd = this.rd;
    const T0 = 1.0 / f0;

    // Fant 1995 の回帰式
    const Rap = (-1 + 4.8 * Rd) / 100;
    const Rkp = (22.4 + 11.8 * Rd) / 100;
    // Rgp = T0 / (2 * Tp) → Tp = T0 / (2 * Rgp)
    const denom = 0.5 + 1.2 * Rkp;
    // 分母ゼロ防御
    const Rgp = denom > 1e-12
      ? 1 / (4 * (0.11 * Rd / denom - Rap))
      : 1.0;

    // Rgp が非正 or 非有限 → フォールバック
    let Tp: number;
    let Te: number;
    let Ta: number;

    if (!isFinite(Rgp) || Rgp <= 0) {
      // 安全なフォールバック: modal voice 的な値
      Tp = T0 * 0.4;
      Te = T0 * 0.6;
      Ta = T0 * 0.02;
    } else {
      Tp = T0 / (2 * Rgp);
      Te = Tp * (1 + Rkp);
      Ta = Rap * T0;
    }

    // 物理的妥当性のクランプ: 0 < Tp < Te < T0, Ta > 0
    if (Tp <= 0) Tp = T0 * 0.01;
    if (Te <= Tp) Te = Tp + T0 * 0.01;
    if (Te >= T0) Te = T0 * 0.99;
    if (Ta <= 0) Ta = T0 * 0.001;
    // Ta が T0 - Te より大きい場合もクランプ
    const maxTa = (T0 - Te) * 0.5;
    if (Ta > maxTa) Ta = maxTa;

    this.Tp = Tp;
    this.Te = Te;
    this.Ta = Ta;
    this.T0 = T0;
    this.omegaG = Math.PI / this.Tp;
    this.lastF0 = f0;

    // alpha を Newton-Raphson で求める (this.Te, this.Tp を参照)
    this.alpha = this.solveAlpha();

    // epsilon を Newton-Raphson で求める (this.T0, this.Te, this.Ta を参照)
    this.epsilon = this.solveEpsilon();

    // Ee を求める: E(Te) での振幅（開放相の最大流量微分値）
    // E(Te) = E0 * exp(alpha * Te) * sin(omega_g * Te) = -Ee (負のピーク)
    // ここでは Ee を正の値として格納
    const sinTe = Math.sin(this.omegaG * this.Te);
    const expTe = Math.exp(this.alpha * this.Te);
    const absETe = Math.abs(expTe * sinTe);

    // E0 を正規化: 最終出力のピークが概ね 1.0 になるように
    // E0 = Ee / |exp(alpha*Te) * sin(omega_g*Te)|
    // Ee = 1.0 (正規化) として E0 を逆算
    this.Ee = 1.0;
    if (absETe > 1e-12) {
      this.E0 = 1.0 / absETe;
    } else {
      this.E0 = 1.0;
    }

    // 閉鎖相の定数を事前計算
    const epsTa = this.epsilon * this.Ta;
    if (Math.abs(epsTa) > 1e-12) {
      this.returnCoeff = -(this.Ee / epsTa);
    } else {
      this.returnCoeff = 0;
    }
    const expReturnTail = -this.epsilon * (this.T0 - this.Te);
    // exp の引数が極端に負の場合は 0 として扱う
    this.returnTail = expReturnTail > -500 ? Math.exp(expReturnTail) : 0;

    this.paramsValid = true;
  }

  // ================================================================
  // Newton-Raphson: alpha の求解
  // ================================================================

  /**
   * alpha を Newton-Raphson 法で求める。
   *
   * 条件: 開放相の終端 t=Te で E(Te) が負のピーク (Ee) となること。
   * sin(omega_g * Te) が既知なので、alpha は exp(alpha*Te) の増加率を決定する。
   *
   * 初期推定: alpha ≈ -ln(|sin(omega_g*Te)|) / Te (簡易近似)
   *
   * 正確な方程式:
   *   f(alpha) = alpha * sin(wg*Te) - wg * cos(wg*Te)
   *              + wg * exp(-alpha*Te)
   *   f'(alpha) = sin(wg*Te) + wg * Te * exp(-alpha*Te)  ... ではなく
   *
   * より正確: 開放相微分の積分条件から
   *   開放相で E(t) = E0*exp(a*t)*sin(wg*t)
   *   dE/dt = E0*exp(a*t)*(a*sin(wg*t) + wg*cos(wg*t))
   *   E(0)=0 (sin(0)=0 で自動的に満たされる)
   *
   * alpha の決定条件として、開放相の面積 (積分値) が閉鎖相と一致する
   * (流量保存条件) を使う:
   *   ∫[0,Te] E(t)dt + ∫[Te,T0] E(t)dt = 0
   *
   * 開放相積分:
   *   ∫[0,Te] E0*exp(a*t)*sin(wg*t)dt
   *   = E0 * [exp(a*t)*(a*sin(wg*t)-wg*cos(wg*t))] / (a^2+wg^2) |[0,Te]
   *
   * 閉鎖相積分:
   *   = -(Ee/(eps*Ta)) * [(1/eps)(exp(-eps*(t-Te))-1) - Ta*(exp(-eps*(T0-Te))-1)... ]
   *   簡略化すると ≈ Ee / epsilon (近似)
   *
   * 実装では Fant の実用的なアプローチに従い:
   *   f(a) = 1 - exp(a*Te)*cos(wg*Te)
   *          + a * exp(a*Te)*sin(wg*Te)/wg = 0  ... ではなく
   *
   * 最も安定な定式化:
   *   開放相積分 I_open = E0/(a^2+wg^2) * [exp(a*Te)*(a*sin(wg*Te)-wg*cos(wg*Te)) + wg]
   *   閉鎖相積分 I_return = Ee * (1/(eps) - Ta) (近似)
   *   条件: I_open + I_return = 0
   *
   * ここでは簡略化として、alpha の初期近似値を使い、
   * Newton-Raphson で微調整する方法を採用する。
   *
   * 方程式: g(a) = a*Te + (1/(tan(wg*Te))) - (exp(a*Te)*cos(wg*Te))/(exp(a*Te)*sin(wg*Te))
   * を整理すると:
   *   g(a) = a + (wg*cos(wg*Te) - a*sin(wg*Te)) * exp(-a*Te) / sin(wg*Te) ... 複雑
   *
   * 実用: 以下の簡潔な方程式を使う (Fant et al. 1985 に基づく)
   *   開放相の積分 = E0/(a^2+wg^2)*[exp(a*Te)*(a*sin(wg*Te)-wg*cos(wg*Te))+wg]
   *   これが Ee/epsilon と等しい (流量保存)
   *   E0 = Ee / (exp(a*Te)*sin(wg*Te)) より代入して整理
   *   → f(a) = (a*sin(wg*Te)-wg*cos(wg*Te)+wg*exp(-a*Te)) / (a^2+wg^2) - sin(wg*Te)/epsilon
   *
   * 最終的に使う式:
   *   f(a) = a*sin(wTe) - wg*cos(wTe) + wg*exp(-a*Te) = 0  ... (*)
   *   ただし wTe = wg*Te
   *   f'(a) = sin(wTe) - wg*Te*exp(-a*Te)
   */
  private solveAlpha(): number {
    const Te = this.Te;
    const wg = Math.PI / this.Tp;
    const wTe = wg * Te;
    const sinWTe = Math.sin(wTe);
    const cosWTe = Math.cos(wTe);

    // sin(wg*Te) ≈ 0 の場合は alpha = 0 (フォールバック)
    if (Math.abs(sinWTe) < 1e-12) {
      return 0;
    }

    // 初期推定値: alpha ≈ (wg * cosWTe - wg) / sinWTe (f(a)=0 を exp 項無視で解く)
    // つまり a_init ≈ wg * (cosWTe - 1) / sinWTe ... ただし安定性のためクランプ
    let a = wg * (cosWTe - 1) / sinWTe;

    // 極端な値はクランプ（発散防止）
    const aMax = 10000;
    if (a > aMax) a = aMax;
    if (a < -aMax) a = -aMax;
    if (!isFinite(a)) a = 0;

    // Newton-Raphson 反復
    // f(a)  = a*sin(wTe) - wg*cos(wTe) + wg*exp(-a*Te)
    // f'(a) = sin(wTe) - wg*Te*exp(-a*Te)
    for (let i = 0; i < NR_MAX_ITER; i++) {
      const expNeg = Math.exp(-a * Te);
      // exp がオーバーフロー/アンダーフローした場合は中断
      if (!isFinite(expNeg)) break;

      const f = a * sinWTe - wg * cosWTe + wg * expNeg;
      const fp = sinWTe - wg * Te * expNeg;

      // 導関数がほぼゼロの場合は中断
      if (Math.abs(fp) < 1e-15) break;

      const da = -f / fp;
      a += da;

      // クランプ
      if (a > aMax) a = aMax;
      if (a < -aMax) a = -aMax;
      if (!isFinite(a)) { a = 0; break; }

      // 収束判定
      if (Math.abs(da) < NR_TOLERANCE) break;
    }

    return a;
  }

  // ================================================================
  // Newton-Raphson: epsilon の求解
  // ================================================================

  /**
   * epsilon を Newton-Raphson 法で求める。
   *
   * 方程式: 1 - exp(-epsilon * (T0 - Te)) = epsilon * Ta
   *   f(eps) = 1 - exp(-eps * Tc) - eps * Ta
   *   f'(eps) = Tc * exp(-eps * Tc) - Ta
   *   ただし Tc = T0 - Te (閉鎖相の長さ)
   *
   * 初期推定: epsilon ≈ 1 / Ta (Ta が小さい場合の近似)
   */
  private solveEpsilon(): number {
    const Ta = this.Ta;
    const Tc = this.T0 - this.Te;

    // Tc ≈ 0 の場合はフォールバック
    if (Tc < 1e-12) {
      return Ta > 1e-12 ? 1 / Ta : 10000;
    }

    // 初期推定
    let eps = 1 / Ta;
    if (!isFinite(eps) || eps <= 0) eps = 10000;

    // Newton-Raphson 反復
    for (let i = 0; i < NR_MAX_ITER; i++) {
      const expTerm = Math.exp(-eps * Tc);
      if (!isFinite(expTerm)) break;

      const f = 1 - expTerm - eps * Ta;
      const fp = Tc * expTerm - Ta;

      if (Math.abs(fp) < 1e-15) break;

      const dEps = -f / fp;
      eps += dEps;

      // epsilon は正の値でなければならない
      if (eps <= 0) eps = 1e-6;
      if (!isFinite(eps)) { eps = 1 / Ta; break; }

      if (Math.abs(dEps) < NR_TOLERANCE) break;
    }

    // 最終防御
    if (!isFinite(eps) || eps <= 0) {
      eps = 1 / Ta;
    }
    if (!isFinite(eps) || eps <= 0) {
      eps = 10000;
    }

    return eps;
  }

  // ================================================================
  // GlottalModel インターフェース実装
  // ================================================================

  /**
   * LF 波形による声門パルスを返す。
   * phase は [0.0, 1.0) の正規化位相。
   *
   * @param phase 現在の位相 [0.0, 1.0)
   * @returns 声門波形サンプル
   */
  generate(phase: number): number {
    if (!this.paramsValid) return 0;

    // 現在の時刻 t (秒)
    const t = phase * this.T0;

    if (t <= this.Te) {
      // 開放相: E(t) = E0 * exp(alpha * t) * sin(omega_g * t)
      const expAt = Math.exp(this.alpha * t);
      const sinWt = Math.sin(this.omegaG * t);

      // NaN/Infinity 防御
      if (!isFinite(expAt)) return 0;

      return this.E0 * expAt * sinWt;
    }

    // 閉鎖相: E(t) = returnCoeff * (exp(-epsilon*(t-Te)) - returnTail)
    const dt = t - this.Te;
    const expEpsDt = Math.exp(-this.epsilon * dt);

    if (!isFinite(expEpsDt)) return 0;

    return this.returnCoeff * (expEpsDt - this.returnTail);
  }

  /**
   * 有声パルス + 気息ノイズ + 有声/無声クロスフェードの最終出力を返す。
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
        this.voicedGain = 1 - t;
        this.noiseGain = t;
      } else {
        this.voicedGain = t;
        this.noiseGain = 1 - t;
      }
    }

    const voiced = this.generate(phase);

    // 気息ノイズ: LCG ホワイトノイズをバンドパスフィルタに通す
    const rawNoise = this.generateNoise();
    const filteredNoise = this.applyBiquadBPF(rawNoise);

    // 気息成分は有声音に加算（aspirationLevel で制御）
    // aspirationLevel: 0 = ノイズなし, 1 = フルノイズ
    const voicedWithAspiration = voiced + filteredNoise * this.aspirationLevel * 0.3;

    // 有声/無声クロスフェードノイズ (Klglott88 と同じ仕組み)
    const crossfadeNoise = this.generateNoise();
    return voicedWithAspiration * this.voicedGain + crossfadeNoise * this.noiseGain;
  }

  /**
   * 音源タイプを切り替える。同一タイプの場合は何もしない。
   */
  setSourceType(type: SourceType): void {
    if (type === this.sourceType) return;
    this.sourceType = type;
    this.crossfadeRemaining = this.crossfadeTotal;
  }

  /**
   * Open Quotient を設定する。LF モデルでは Rd で制御するため無視する。
   * GlottalModel インターフェース互換のために存在。
   */
  setOpenQuotient(_oq: number): void {
    // LF モデルでは OQ は Rd から自動的に導出されるため、明示的な設定は不要。
  }

  /**
   * Rd パラメータを設定する。次の声門周期開始時に反映。
   * @param rd Rd 値 (0.3〜2.7、自動クランプ)
   */
  setRd(rd: number): void {
    let clamped = rd;
    if (clamped < RD_MIN) clamped = RD_MIN;
    if (clamped > RD_MAX) clamped = RD_MAX;
    if (!isFinite(clamped)) clamped = RD_DEFAULT;
    this.pendingRd = clamped;
  }

  /**
   * 気息ノイズレベルを設定する。
   * @param level 0.0 (ノイズなし) 〜 1.0 (フルノイズ)
   */
  setAspiration(level: number): void {
    if (level < 0) level = 0;
    if (level > 1) level = 1;
    if (!isFinite(level)) level = 0;
    this.aspirationLevel = level;
  }

  /**
   * 内部状態をリセットする。
   */
  reset(): void {
    this.rd = RD_DEFAULT;
    this.pendingRd = null;
    this.aspirationLevel = 0;

    this.Tp = 0;
    this.Te = 0;
    this.Ta = 0;
    this.T0 = 0;
    this.alpha = 0;
    this.epsilon = 0;
    this.E0 = 0;
    this.omegaG = 0;
    this.returnCoeff = 0;
    this.returnTail = 0;
    this.lastF0 = 0;
    this.Ee = 1;
    this.paramsValid = false;

    this.sourceType = 'voiced';
    this.crossfadeRemaining = 0;
    this.voicedGain = 1.0;
    this.noiseGain = 0.0;
    this.noiseSeed = 12345;

    this.bpfX1 = 0;
    this.bpfX2 = 0;
    this.bpfY1 = 0;
    this.bpfY2 = 0;
  }

  // ================================================================
  // プライベートヘルパー
  // ================================================================

  /**
   * LCG 擬似乱数ノイズ。Math.random() を避けて GC を回避する。
   * @returns [-1, 1] の範囲のノイズサンプル
   */
  private generateNoise(): number {
    this.noiseSeed = (this.noiseSeed * 1664525 + 1013904223) >>> 0;
    return this.noiseSeed / 4294967296 * 2 - 1;
  }

  /**
   * 2次 IIR バンドパスフィルタ (Direct Form I) を適用する。
   * 気息ノイズの帯域制限に使用。
   *
   * @param x 入力サンプル
   * @returns フィルタ済みサンプル
   */
  private applyBiquadBPF(x: number): number {
    const y = BPF_NB0 * x + BPF_NB1 * this.bpfX1 + BPF_NB2 * this.bpfX2
              - BPF_NA1 * this.bpfY1 - BPF_NA2 * this.bpfY2;

    // 状態変数を更新
    this.bpfX2 = this.bpfX1;
    this.bpfX1 = x;
    this.bpfY2 = this.bpfY1;
    this.bpfY1 = y;

    // デノーマル防止: 極小値をゼロにフラッシュ
    if (this.bpfY1 > -1e-20 && this.bpfY1 < 1e-20) this.bpfY1 = 0;
    if (this.bpfY2 > -1e-20 && this.bpfY2 < 1e-20) this.bpfY2 = 0;

    return y;
  }
}
