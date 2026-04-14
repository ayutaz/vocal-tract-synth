// ============================================================================
// PhraseManager — フレーズ構造、休符、ADSR、フレーズ音量カーブの管理
// ----------------------------------------------------------------------------
// update() でノートごとの状態を取得し、tick() で毎フレーム ADSR/ブレスを進行。
//
// フレーズ: 4-8拍（偶数やや優先）、間に 0.5-1拍休符
// ADSR: Attack 30ms, Decay 75ms, Sustain 0.8, Release 45ms
// フレーズカーブ: sin(π * progress)^0.7
// ブレス: 休符冒頭に F0 急降下 + 振幅フェードアウト
// ============================================================================

// ===== 定数 =====

/** ADSR アタック時間 (秒) */
const ATTACK_SEC = 0.030;

/** ADSR ディケイ時間 (秒) */
const DECAY_SEC = 0.075;

/** ADSR サステインレベル */
const SUSTAIN_LEVEL = 0.8;

/** ADSR リリース時間 (秒) */
const RELEASE_SEC = 0.045;

// フレーズ拍数の範囲: 4-8拍（generatePhraseBeats() 内で直接使用）

/** 休符最小拍数 */
const REST_MIN_BEATS = 0.5;

/** 休符最大拍数 */
const REST_MAX_BEATS = 1.0;

/** フレーズ末判定: 残り何音以内でフレーズ末とみなすか */
const PHRASE_END_NOTE_THRESHOLD = 2;

/** ブレス時間 (秒) — 休符の冒頭部分に適用 */
const BREATH_DURATION_SEC = 0.3;

// ===== ADSR ステート =====

type AdsrStage = 'idle' | 'attack' | 'decay' | 'sustain' | 'release';

// ===== 出力型 =====

export interface PhraseState {
  /** 現在休符中か */
  isResting: boolean;
  /** フレーズ内進捗 0.0-1.0 */
  phraseProgress: number;
  /** ADSR エンベロープ値 0.0-1.0 */
  noteEnvelope: number;
  /** フレーズ音量カーブ sin(π*progress)^0.7 — 0.0-1.0 */
  phraseEnvelope: number;
  /** フレーズ末2音以内か */
  isApproachingPhraseEnd: boolean;
  /** ブレス進捗 0.0-1.0（非ブレス時は 0） */
  breathProgress: number;
}

// ===== デフォルト RNG =====

/** デフォルトの乱数生成器（Math.random） */
function defaultRng(): number {
  return Math.random();
}

// ===== PhraseManager =====

export class PhraseManager {
  private readonly rng: () => number;

  // --- BPM（将来的にフレーズ長の拍→秒変換等で使用予定） ---
  // @ts-expect-error -- 将来のBPM依存計算で使用。現在は setBpm() で書き込みのみ。
  private _bpm: number = 120;

  // --- フレーズ状態 ---
  /** 現在のフレーズの全拍数 */
  private phraseBeats: number = 0;
  /** フレーズ内で消費済みの拍数 */
  private phraseElapsedBeats: number = 0;
  /** フレーズ内のノート数（update呼び出し回数） */
  private phraseNoteCount: number = 0;
  /** 現在フレーズ進行中か（false = 休符フェーズ） */
  private inPhrase: boolean = false;
  /** 休符の全拍数 */
  private restBeats: number = 0;
  /** 休符内で消費済みの拍数 */
  private restElapsedBeats: number = 0;

  // --- ADSR 状態 ---
  private adsrStage: AdsrStage = 'idle';
  /** ADSR 現在のステージ内経過時間 (秒) */
  private adsrTime: number = 0;
  /** ADSR エンベロープ現在値 */
  private adsrValue: number = 0;
  /** 現在のノート全体の長さ (秒) — リリース開始タイミング計算用 */
  private noteDurationSec: number = 0;
  /** ノート開始からの経過時間 (秒) */
  private noteElapsedSec: number = 0;

  // --- ブレス状態 ---
  /** ブレス中フラグ */
  private breathActive: boolean = false;
  /** ブレス経過時間 (秒) */
  private breathTime: number = 0;
  /** ブレス全体の長さ (秒) */
  private breathDuration: number = BREATH_DURATION_SEC;

  constructor(rng?: () => number) {
    this.rng = rng ?? defaultRng;
  }

  // ==========================================================================
  // 公開 API
  // ==========================================================================

  /**
   * 次のノートの状態を取得する。
   * フレーズの開始・終了を自動管理し、休符を挟む。
   *
   * @param noteDurationBeats このノートの長さ（拍）
   * @returns PhraseState
   */
  update(noteDurationBeats: number): PhraseState {
    // 新しいフレーズ開始が必要かチェック
    if (!this.inPhrase) {
      // 休符フェーズ中
      if (this.restElapsedBeats < this.restBeats) {
        // まだ休符中 — 残りの休符を消費
        this.restElapsedBeats += noteDurationBeats;

        // ブレスを開始（休符冒頭で）
        if (!this.breathActive) {
          this.breathActive = true;
          this.breathTime = 0;
          this.breathDuration = BREATH_DURATION_SEC;
        }

        return this.buildState(true);
      }

      // 休符完了 → 新しいフレーズを開始
      this.startNewPhrase();
    }

    // フレーズ内のノート処理
    this.phraseElapsedBeats += noteDurationBeats;
    this.phraseNoteCount++;

    // フレーズ末判定用の残り拍数を推定
    const remainingBeats = this.phraseBeats - this.phraseElapsedBeats;

    // フレーズ完了チェック
    if (this.phraseElapsedBeats >= this.phraseBeats) {
      // フレーズ終了 → 休符フェーズへ
      this.inPhrase = false;
      this.restBeats = this.generateRestBeats();
      this.restElapsedBeats = 0;
    }

    // フレーズ進捗（クランプ）
    const progress = Math.min(this.phraseElapsedBeats / this.phraseBeats, 1.0);

    // フレーズ末2音以内か（残り拍数が1拍以下 ≈ 2音以内と近似）
    const isApproachingEnd = remainingBeats <= noteDurationBeats * PHRASE_END_NOTE_THRESHOLD;

    return {
      isResting: false,
      phraseProgress: progress,
      noteEnvelope: this.adsrValue,
      phraseEnvelope: this.computePhraseEnvelope(progress),
      isApproachingPhraseEnd: isApproachingEnd,
      breathProgress: 0,
    };
  }

  /**
   * ノート開始通知。ADSR のアタックを開始する。
   *
   * @param durationMs ノートの長さ (ミリ秒)
   */
  onNoteStart(durationMs: number): void {
    this.adsrStage = 'attack';
    this.adsrTime = 0;
    this.adsrValue = 0;
    this.noteDurationSec = durationMs / 1000;
    this.noteElapsedSec = 0;
  }

  /**
   * ノート終了通知。ADSR のリリースを開始する。
   */
  onNoteEnd(): void {
    if (this.adsrStage !== 'idle' && this.adsrStage !== 'release') {
      this.adsrStage = 'release';
      this.adsrTime = 0;
      // adsrValue はリリース開始時の値をそのまま使う（tick で減衰）
    }
  }

  /**
   * 毎フレーム呼び出す。ADSR とブレスの時間進行を行う。
   *
   * @param deltaTime 前フレームからの経過時間 (秒)
   */
  tick(deltaTime: number): void {
    this.tickAdsr(deltaTime);
    this.tickBreath(deltaTime);
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
    this._bpm = 120;
    this.phraseBeats = 0;
    this.phraseElapsedBeats = 0;
    this.phraseNoteCount = 0;
    this.inPhrase = false;
    this.restBeats = 0;
    this.restElapsedBeats = 0;
    this.adsrStage = 'idle';
    this.adsrTime = 0;
    this.adsrValue = 0;
    this.noteDurationSec = 0;
    this.noteElapsedSec = 0;
    this.breathActive = false;
    this.breathTime = 0;
  }

  // ==========================================================================
  // 内部: フレーズ生成
  // ==========================================================================

  /**
   * 新しいフレーズを開始する。4-8拍（偶数やや優先）。
   */
  private startNewPhrase(): void {
    this.phraseBeats = this.generatePhraseBeats();
    this.phraseElapsedBeats = 0;
    this.phraseNoteCount = 0;
    this.inPhrase = true;
    this.breathActive = false;
  }

  /**
   * フレーズの拍数を生成する。4-8 の範囲で偶数をやや優先。
   *
   * 偶数 (4, 6, 8) を 60%、奇数 (5, 7) を 40% の確率で選択。
   */
  private generatePhraseBeats(): number {
    const r = this.rng();

    if (r < 0.6) {
      // 偶数: 4, 6, 8 を均等に（各 20%）
      const evenOptions = [4, 6, 8];
      const idx = Math.floor(this.rng() * evenOptions.length);
      return evenOptions[Math.min(idx, evenOptions.length - 1)]!;
    } else {
      // 奇数: 5, 7 を均等に（各 20%）
      const oddOptions = [5, 7];
      const idx = Math.floor(this.rng() * oddOptions.length);
      return oddOptions[Math.min(idx, oddOptions.length - 1)]!;
    }
  }

  /**
   * 休符の拍数を生成する。0.5-1.0拍。
   */
  private generateRestBeats(): number {
    return REST_MIN_BEATS + (REST_MAX_BEATS - REST_MIN_BEATS) * this.rng();
  }

  // ==========================================================================
  // 内部: ADSR エンベロープ
  // ==========================================================================

  /**
   * ADSR を deltaTime 分進行させる。
   */
  private tickAdsr(deltaTime: number): void {
    if (this.adsrStage === 'idle') {
      return;
    }

    this.adsrTime += deltaTime;
    this.noteElapsedSec += deltaTime;

    // リリースを自動開始: ノート終了の少し手前で開始
    // (onNoteEnd が明示的に呼ばれなかった場合のフォールバック)
    if (
      this.adsrStage !== 'release' &&
      this.noteDurationSec > 0 &&
      this.noteElapsedSec >= this.noteDurationSec - RELEASE_SEC
    ) {
      this.adsrStage = 'release';
      this.adsrTime = 0;
    }

    switch (this.adsrStage) {
      case 'attack': {
        if (this.adsrTime >= ATTACK_SEC) {
          // アタック完了 → ディケイへ
          this.adsrValue = 1.0;
          this.adsrStage = 'decay';
          this.adsrTime = 0;
        } else {
          // 0 → 1 リニア上昇
          this.adsrValue = this.adsrTime / ATTACK_SEC;
        }
        break;
      }

      case 'decay': {
        if (this.adsrTime >= DECAY_SEC) {
          // ディケイ完了 → サステインへ
          this.adsrValue = SUSTAIN_LEVEL;
          this.adsrStage = 'sustain';
          this.adsrTime = 0;
        } else {
          // 1 → SUSTAIN_LEVEL リニア下降
          const t = this.adsrTime / DECAY_SEC;
          this.adsrValue = 1.0 - (1.0 - SUSTAIN_LEVEL) * t;
        }
        break;
      }

      case 'sustain': {
        // サステインレベルを維持（リリースは onNoteEnd() またはフォールバックで開始）
        this.adsrValue = SUSTAIN_LEVEL;
        break;
      }

      case 'release': {
        if (this.adsrTime >= RELEASE_SEC) {
          // リリース完了
          this.adsrValue = 0;
          this.adsrStage = 'idle';
          this.adsrTime = 0;
        } else {
          // リリース開始時の値 → 0 リニア下降
          // （リリース開始時に adsrValue にはその時点の値が入っている）
          const releaseStartValue = this.getReleaseStartValue();
          const t = this.adsrTime / RELEASE_SEC;
          this.adsrValue = releaseStartValue * (1.0 - t);
        }
        break;
      }

      // 'idle' は冒頭の早期リターンで到達しない
    }

    // クランプ
    this.adsrValue = Math.max(0, Math.min(1, this.adsrValue));
  }

  /**
   * リリース開始時のエンベロープ値を推定する。
   * 通常はサステインレベルだが、アタック/ディケイ途中からリリースに入る場合もある。
   */
  private getReleaseStartValue(): number {
    // リリース中は adsrTime=0 でリセットされるため、
    // 開始直前の値は SUSTAIN_LEVEL（ほとんどのケース）か、
    // アタック/ディケイ途中の値。
    // ここではサステインレベルを返す（短いノートでも自然に聞こえる近似）。
    return SUSTAIN_LEVEL;
  }

  // ==========================================================================
  // 内部: ブレス
  // ==========================================================================

  /**
   * ブレスを deltaTime 分進行させる。
   */
  private tickBreath(deltaTime: number): void {
    if (!this.breathActive) {
      return;
    }

    this.breathTime += deltaTime;

    if (this.breathTime >= this.breathDuration) {
      this.breathActive = false;
      this.breathTime = 0;
    }
  }

  // ==========================================================================
  // 内部: フレーズエンベロープ
  // ==========================================================================

  /**
   * フレーズ音量カーブ: sin(π * progress)^0.7
   * フレーズの最初と最後で自然に減衰する。
   */
  private computePhraseEnvelope(progress: number): number {
    if (progress <= 0 || progress >= 1) {
      return 0;
    }
    return Math.pow(Math.sin(Math.PI * progress), 0.7);
  }

  // ==========================================================================
  // 内部: 状態構築ヘルパ
  // ==========================================================================

  /**
   * 休符中の PhraseState を構築する。
   */
  private buildState(isResting: boolean): PhraseState {
    // ブレス進捗
    let breathProgress = 0;
    if (this.breathActive && this.breathDuration > 0) {
      breathProgress = Math.min(this.breathTime / this.breathDuration, 1.0);
    }

    return {
      isResting,
      phraseProgress: isResting ? 0 : Math.min(this.phraseElapsedBeats / this.phraseBeats, 1.0),
      noteEnvelope: this.adsrValue,
      phraseEnvelope: 0,
      isApproachingPhraseEnd: false,
      breathProgress,
    };
  }
}
