// ============================================================================
// ExpressionEngine — ビブラート、ポルタメント、ジッター/シマー計算
// ----------------------------------------------------------------------------
// 毎フレーム update(deltaTime) で ExpressionOutput を返す。
// - ビブラート: 5.5Hz, +-30cent, 200ms ディレイ後 100ms フェードイン
// - ポルタメント: 50-200ms（跳躍幅比例）、対数空間コサイン補間
// - ジッター: F0 に 0.5-1.5% のランダム変動
// - シマー: 振幅に 0.5-2.0% のランダム変動
// ============================================================================

// ===== 定数 =====

/** ビブラート周波数 (Hz) */
const VIBRATO_RATE = 5.5;

/** ビブラート深さ (cent) — +-30cent */
const VIBRATO_DEPTH_CENTS = 30;

/** ビブラート開始ディレイ (秒) — ノート先頭から 200ms */
const VIBRATO_DELAY_SEC = 0.2;

/** ビブラートフェードイン時間 (秒) — ディレイ後 100ms かけて 0→1 */
const VIBRATO_FADE_SEC = 0.1;

/** ポルタメント最小時間 (秒) */
const PORTAMENTO_MIN_SEC = 0.05;

/** ポルタメント最大時間 (秒) */
const PORTAMENTO_MAX_SEC = 0.2;

/** ポルタメント跳躍幅の基準 (半音) — 7半音で最大時間に達する */
const PORTAMENTO_REF_SEMITONES = 7;

/** ジッター下限 (0.5%) */
const JITTER_MIN = 0.005;

/** ジッター上限 (1.5%) */
const JITTER_MAX = 0.015;

/** シマー下限 (0.5%) */
const SHIMMER_MIN = 0.005;

/** シマー上限 (2.0%) */
const SHIMMER_MAX = 0.020;

// ===== 出力型 =====

export interface ExpressionOutput {
  /** F0 に乗算する係数（ビブラート + ポルタメント合成） */
  f0Modifier: number;
  /** ジッター量 0.005-0.015 (0.5-1.5%) */
  jitterAmount: number;
  /** シマー量 0.005-0.020 (0.5-2.0%) */
  shimmerAmount: number;
}

// ===== デフォルト RNG =====

/** デフォルトの乱数生成器（Math.random） */
function defaultRng(): number {
  return Math.random();
}

// ===== ExpressionEngine =====

export class ExpressionEngine {
  private readonly rng: () => number;

  // --- BPM（将来的にビブラート速度のBPM同期等で使用予定） ---
  // @ts-expect-error -- 将来のBPM同期で使用。現在は setBpm() で書き込みのみ。
  private _bpm: number = 120;

  // --- ビブラート状態 ---
  /** ノート開始からの経過時間 (秒) */
  private noteTime: number = 0;
  /** ビブラート位相アキュムレータ (秒単位の連続時間) */
  private vibratoPhase: number = 0;

  // --- ポルタメント状態 ---
  /** ポルタメント有効フラグ */
  private portamentoActive: boolean = false;
  /** ポルタメント経過時間 (秒) */
  private portamentoTime: number = 0;
  /** ポルタメント全体の長さ (秒) */
  private portamentoDuration: number = 0;
  /** ポルタメント開始周波数 (Hz) */
  private portamentoPrevFreq: number = 120;
  /** ポルタメント目標周波数 (Hz) */
  private portamentoTargetFreq: number = 120;

  // --- ジッター/シマー（ノートごとに固定値） ---
  private jitterAmount: number = 0.01;
  private shimmerAmount: number = 0.01;

  constructor(rng?: () => number) {
    this.rng = rng ?? defaultRng;

    // 初期ジッター/シマー値を生成
    this.randomizeJitterShimmer();
  }

  // ==========================================================================
  // 公開 API
  // ==========================================================================

  /**
   * ノート開始時にリセットする。
   * ビブラートディレイを再開し、ポルタメントを設定する。
   *
   * @param targetFreq 今回のノートの目標周波数 (Hz)
   * @param prevFreq 直前のノートの周波数 (Hz)
   * @param usePortamento ポルタメントを適用するか
   */
  onNoteStart(targetFreq: number, prevFreq: number, usePortamento: boolean): void {
    // ビブラート: ノート時間をリセット（ディレイ再開）
    this.noteTime = 0;
    // ビブラート位相は連続（リセットしない→ノート間で位相が跳ばない）

    // ポルタメント設定
    if (usePortamento && prevFreq > 0 && targetFreq > 0 && prevFreq !== targetFreq) {
      this.portamentoActive = true;
      this.portamentoTime = 0;
      this.portamentoPrevFreq = prevFreq;
      this.portamentoTargetFreq = targetFreq;

      // 跳躍幅（半音数）に比例してポルタメント時間を決定
      const semitones = Math.abs(12 * Math.log2(targetFreq / prevFreq));
      const ratio = Math.min(semitones / PORTAMENTO_REF_SEMITONES, 1.0);
      this.portamentoDuration =
        PORTAMENTO_MIN_SEC + (PORTAMENTO_MAX_SEC - PORTAMENTO_MIN_SEC) * ratio;
    } else {
      this.portamentoActive = false;
    }

    // ジッター/シマー: ノートごとにランダム値を更新
    this.randomizeJitterShimmer();
  }

  /**
   * 毎フレーム呼び出す。表現パラメータを更新して返す。
   *
   * @param deltaTime 前フレームからの経過時間 (秒)
   * @returns ExpressionOutput
   */
  update(deltaTime: number): ExpressionOutput {
    this.noteTime += deltaTime;

    // --- ビブラート ---
    const vibratoModifier = this.computeVibrato(deltaTime);

    // --- ポルタメント ---
    const portamentoModifier = this.computePortamento(deltaTime);

    // F0 修飾: ポルタメント係数 × ビブラート係数
    // ポルタメントが非アクティブの場合は 1.0 が返る
    const f0Modifier = portamentoModifier * vibratoModifier;

    return {
      f0Modifier,
      jitterAmount: this.jitterAmount,
      shimmerAmount: this.shimmerAmount,
    };
  }

  /**
   * BPM を設定する。
   */
  setBpm(bpm: number): void {
    this._bpm = bpm;
  }

  /**
   * 全状態をリセットする。
   */
  reset(): void {
    this.noteTime = 0;
    this.vibratoPhase = 0;
    this.portamentoActive = false;
    this.portamentoTime = 0;
    this.portamentoDuration = 0;
    this.portamentoPrevFreq = 120;
    this.portamentoTargetFreq = 120;
    this.randomizeJitterShimmer();
  }

  // ==========================================================================
  // 内部: ビブラート
  // ==========================================================================

  /**
   * ビブラートによる F0 係数を計算する。
   *
   * 200ms ディレイ → 100ms フェードイン → フル振幅
   * vibrato_factor = depth * sin(2π * 5.5 * t) * envelope
   * F0_modifier = 2^(vibrato_factor / 1200)
   */
  private computeVibrato(deltaTime: number): number {
    // ビブラート位相を進める（ノートをまたいで連続）
    this.vibratoPhase += deltaTime;

    // エンベロープ: ディレイ + フェードイン
    let envelope = 0;
    if (this.noteTime > VIBRATO_DELAY_SEC) {
      const fadeElapsed = this.noteTime - VIBRATO_DELAY_SEC;
      if (fadeElapsed >= VIBRATO_FADE_SEC) {
        envelope = 1.0;
      } else {
        // 0→1 のリニアフェードイン
        envelope = fadeElapsed / VIBRATO_FADE_SEC;
      }
    }

    if (envelope <= 0) {
      return 1.0;
    }

    // ビブラート振幅 (cent)
    const vibratoFactor =
      VIBRATO_DEPTH_CENTS * Math.sin(2 * Math.PI * VIBRATO_RATE * this.vibratoPhase) * envelope;

    // cent → 周波数比
    return Math.pow(2, vibratoFactor / 1200);
  }

  // ==========================================================================
  // 内部: ポルタメント
  // ==========================================================================

  /**
   * ポルタメントによる F0 係数を計算する。
   *
   * 対数空間でのコサイン補間:
   *   t_smooth = 0.5 * (1 - cos(π * progress))
   *   F0 = prevFreq * (targetFreq / prevFreq)^t_smooth
   *
   * 返す値は targetFreq に対する係数（= 計算結果 / targetFreq）。
   */
  private computePortamento(deltaTime: number): number {
    if (!this.portamentoActive) {
      return 1.0;
    }

    this.portamentoTime += deltaTime;

    if (this.portamentoTime >= this.portamentoDuration) {
      // ポルタメント完了
      this.portamentoActive = false;
      return 1.0;
    }

    // 進捗 0→1
    const progress = this.portamentoTime / this.portamentoDuration;

    // コサイン補間で滑らかに 0→1
    const tSmooth = 0.5 * (1 - Math.cos(Math.PI * progress));

    // 対数空間での補間: prevFreq * (targetFreq / prevFreq)^tSmooth
    const currentFreq =
      this.portamentoPrevFreq *
      Math.pow(this.portamentoTargetFreq / this.portamentoPrevFreq, tSmooth);

    // targetFreq に対する比率を返す（呼び出し元が targetFreq を基準 F0 として使うため）
    return currentFreq / this.portamentoTargetFreq;
  }

  // ==========================================================================
  // 内部: ジッター/シマー
  // ==========================================================================

  /**
   * ジッター・シマーのランダム値を生成する（ノートごとに1回）。
   */
  private randomizeJitterShimmer(): void {
    this.jitterAmount = JITTER_MIN + (JITTER_MAX - JITTER_MIN) * this.rng();
    this.shimmerAmount = SHIMMER_MIN + (SHIMMER_MAX - SHIMMER_MIN) * this.rng();
  }
}
