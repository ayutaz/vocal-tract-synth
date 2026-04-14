// ============================================================================
// Start/Stop ボタン・UI状態表示 (Controls)
// ----------------------------------------------------------------------------
// AppState ('idle' | 'initializing' | 'running' | 'error') に応じて、
// Start/Stop ボタンの表示・有効状態、ステータステキスト、エラーテキストを
// 更新する薄いコントローラ。
//
// - idle          : Start ボタン有効、「停止中」
// - initializing  : ボタン無効、「初期化中...」
// - running       : Stop ボタン有効、「再生中」
// - error         : Retry ボタン、エラーメッセージ表示
// ============================================================================

import type { AppState, VowelId, GlottalModelType } from '../types/index';
import { MIN_F0, MAX_F0 } from '../types/index';

// ============================================================================
// Controls クラス
// ============================================================================

export class Controls {
  private readonly startStopBtn: HTMLButtonElement;
  private readonly statusText: HTMLElement;
  private readonly errorText: HTMLElement;
  private readonly onStart: () => Promise<void>;
  private readonly onStop: () => void;

  private currentState: AppState = 'idle';

  constructor(
    startStopBtn: HTMLButtonElement,
    statusText: HTMLElement,
    errorText: HTMLElement,
    onStart: () => Promise<void>,
    onStop: () => void,
  ) {
    this.startStopBtn = startStopBtn;
    this.statusText = statusText;
    this.errorText = errorText;
    this.onStart = onStart;
    this.onStop = onStop;

    this.startStopBtn.addEventListener('click', this.handleClick);

    // 初期表示を idle にリセット
    this.setState('idle');
  }

  // ==========================================================================
  // 公開 API
  // ==========================================================================

  /**
   * アプリケーション状態に応じて UI を更新する。
   * idle/running 以外ではボタンを無効化し、running ではラベルを Stop に切替える。
   */
  setState(state: AppState): void {
    this.currentState = state;

    switch (state) {
      case 'idle':
        this.startStopBtn.textContent = 'Start';
        this.startStopBtn.disabled = false;
        this.setStatus('停止中');
        this.hideError();
        break;

      case 'initializing':
        this.startStopBtn.textContent = 'Start';
        this.startStopBtn.disabled = true;
        this.setStatus('初期化中...');
        this.hideError();
        break;

      case 'running':
        this.startStopBtn.textContent = 'Stop';
        this.startStopBtn.disabled = false;
        this.setStatus('再生中');
        this.hideError();
        break;

      case 'error':
        this.startStopBtn.textContent = 'Retry';
        this.startStopBtn.disabled = false;
        this.setStatus('エラー');
        // エラーテキストは showError() で別途設定される想定
        break;
    }
  }

  /**
   * エラーメッセージを表示し、状態を error に遷移させる。
   * setState('error') では errorText を上書きしないので、
   * 呼び出し側は showError() を使うこと。
   */
  showError(message: string): void {
    this.errorText.textContent = message;
    this.errorText.hidden = false;
    this.setState('error');
  }

  /**
   * Phase 9: OperationModeManager からの一括 enable/disable 用 API。
   * Start/Stop ボタンは 3 モード全てで常時有効であるため no-op とする。
   * 他のコントロールクラスと API を統一するためだけに存在する。
   */
  setEnabled(_enabled: boolean): void {
    // Start/Stop は常時有効（モードに関係なく再生停止可能）
  }

  /** リソース解放（イベント解除） */
  destroy(): void {
    this.startStopBtn.removeEventListener('click', this.handleClick);
  }

  // ==========================================================================
  // 内部
  // ==========================================================================

  private handleClick = async (): Promise<void> => {
    // 現在の状態に応じて onStart / onStop を呼び分ける。
    // Autoplay Policy 対策のため、AudioContext 生成は必ずこの
    // click ハンドラ内（呼び出し先の onStart() の中）で行うこと。
    switch (this.currentState) {
      case 'idle':
      case 'error':
        // Start / Retry
        try {
          await this.onStart();
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);
          this.showError(`初期化に失敗しました: ${message}`);
        }
        break;

      case 'running':
        this.onStop();
        break;

      case 'initializing':
        // 二重クリック無視
        break;
    }
  };

  private setStatus(text: string): void {
    this.statusText.textContent = text;
  }

  private hideError(): void {
    this.errorText.textContent = '';
    this.errorText.hidden = true;
  }
}

// ============================================================================
// プリセットボタン・Noiseトグル (PresetControls)
// ----------------------------------------------------------------------------
// 母音プリセットボタン（あ/い/う/え/お/Flat）の選択と、
// Noise ボタンのトグル操作を管理する。
// ============================================================================

export class PresetControls {
  private readonly presetContainer: HTMLElement;
  private readonly noiseBtn: HTMLButtonElement;
  private readonly onPresetSelect: (id: VowelId) => void;
  private readonly onNoiseToggle: (isNoise: boolean) => void;

  private readonly presetButtons: HTMLButtonElement[];
  private isNoise = false;

  constructor(
    presetContainer: HTMLElement,
    noiseBtn: HTMLButtonElement,
    onPresetSelect: (id: VowelId) => void,
    onNoiseToggle: (isNoise: boolean) => void,
  ) {
    this.presetContainer = presetContainer;
    this.noiseBtn = noiseBtn;
    this.onPresetSelect = onPresetSelect;
    this.onNoiseToggle = onNoiseToggle;

    // プリセットボタンを収集
    this.presetButtons = Array.from(
      this.presetContainer.querySelectorAll<HTMLButtonElement>('.preset-btn'),
    );

    // イベント登録
    this.presetContainer.addEventListener('click', this.handlePresetClick);
    this.noiseBtn.addEventListener('click', this.handleNoiseClick);
  }

  // ==========================================================================
  // 公開 API
  // ==========================================================================

  /** 選択中のプリセットをハイライトする。null で全解除。 */
  setActivePreset(id: VowelId | null): void {
    for (const btn of this.presetButtons) {
      const vowel = btn.dataset['vowel'] as VowelId | undefined;
      btn.classList.toggle('active', vowel === id);
    }
  }

  /** ノイズ状態を更新する。 */
  setNoiseActive(active: boolean): void {
    this.isNoise = active;
    this.noiseBtn.classList.toggle('active', active);
  }

  /**
   * プリセットボタンの有効/無効を一括設定する。
   * Auto Sing 中はプリセットボタンを無効化し、停止時に再有効化する。
   */
  setEnabled(enabled: boolean): void {
    for (const btn of this.presetButtons) {
      btn.disabled = !enabled;
    }
  }

  /**
   * Phase 9: Noise ボタンの enable/disable を独立制御する。
   * Noise トグルは母音プリセットとは別系統のため、操作モード遷移時に
   * プリセットとは独立して有効/無効を切替える必要がある。
   */
  setNoiseEnabled(enabled: boolean): void {
    this.noiseBtn.disabled = !enabled;
  }

  /** リソース解放（イベント解除） */
  destroy(): void {
    this.presetContainer.removeEventListener('click', this.handlePresetClick);
    this.noiseBtn.removeEventListener('click', this.handleNoiseClick);
  }

  // ==========================================================================
  // 内部
  // ==========================================================================

  private handlePresetClick = (e: Event): void => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('preset-btn')) return;

    const vowelId = target.dataset['vowel'] as VowelId | undefined;
    if (vowelId == null) return;

    this.setActivePreset(vowelId);
    this.onPresetSelect(vowelId);
  };

  private handleNoiseClick = (): void => {
    this.isNoise = !this.isNoise;
    this.noiseBtn.classList.toggle('active', this.isNoise);
    this.onNoiseToggle(this.isNoise);
  };
}

// ============================================================================
// スライダー変換関数（F0 対数スケール）
// ----------------------------------------------------------------------------
// sliderValue ∈ [0, 1] ⟷ F0 ∈ [MIN_F0, MAX_F0] を対数スケールで相互変換。
// ============================================================================

/** スライダー値 (0-1) → F0 (Hz)。対数スケール。 */
export function sliderToF0(value: number): number {
  return MIN_F0 * Math.pow(MAX_F0 / MIN_F0, value);
}

/** F0 (Hz) → スライダー値 (0-1)。対数スケール。 */
export function f0ToSlider(hz: number): number {
  return Math.log(hz / MIN_F0) / Math.log(MAX_F0 / MIN_F0);
}

// ============================================================================
// F0スライダー・音量スライダー (SliderControls)
// ----------------------------------------------------------------------------
// F0スライダー（対数スケール: 50–400Hz）と音量スライダー（リニア: 0–100%）を
// 管理する。外部から setF0() で値を変更可能（Auto Sing 等で使用）。
// ============================================================================

const DEFAULT_F0_HZ = 120;
const DEFAULT_VOLUME = 0.3;

export class SliderControls {
  private readonly f0Slider: HTMLInputElement;
  private readonly f0ValueEl: HTMLElement;
  private readonly volumeSlider: HTMLInputElement;
  private readonly volumeValueEl: HTMLElement;
  private readonly onF0Change: (hz: number) => void;
  private readonly onVolumeChange: (value: number) => void;

  constructor(
    f0Slider: HTMLInputElement,
    f0ValueEl: HTMLElement,
    volumeSlider: HTMLInputElement,
    volumeValueEl: HTMLElement,
    onF0Change: (hz: number) => void,
    onVolumeChange: (value: number) => void,
  ) {
    this.f0Slider = f0Slider;
    this.f0ValueEl = f0ValueEl;
    this.volumeSlider = volumeSlider;
    this.volumeValueEl = volumeValueEl;
    this.onF0Change = onF0Change;
    this.onVolumeChange = onVolumeChange;

    // F0スライダー初期化（対数スケール）
    this.f0Slider.min = '0';
    this.f0Slider.max = '1';
    this.f0Slider.step = '0.001';
    this.f0Slider.value = String(f0ToSlider(DEFAULT_F0_HZ));
    this.updateF0Display(DEFAULT_F0_HZ);

    // 音量スライダー初期化（リニア）
    this.volumeSlider.min = '0';
    this.volumeSlider.max = '1';
    this.volumeSlider.step = '0.01';
    this.volumeSlider.value = String(DEFAULT_VOLUME);
    this.updateVolumeDisplay(DEFAULT_VOLUME);

    // イベント登録
    this.f0Slider.addEventListener('input', this.handleF0Input);
    this.volumeSlider.addEventListener('input', this.handleVolumeInput);
  }

  // ==========================================================================
  // 公開 API
  // ==========================================================================

  /** 外部からF0を設定する（Auto Sing 等で使用）。スライダー位置と表示も更新。 */
  setF0(hz: number): void {
    this.f0Slider.value = String(f0ToSlider(hz));
    this.updateF0Display(hz);
    this.onF0Change(hz);
  }

  /**
   * Phase 9: F0 スライダーの enable/disable。
   * textRead モードでは phonemePlayer 側が F0 を制御するため無効化する。
   */
  setF0Enabled(enabled: boolean): void {
    this.f0Slider.disabled = !enabled;
  }

  /**
   * Phase 9: 音量スライダーの enable/disable。
   * textRead モードでは phonemePlayer 側が amplitude を制御するため無効化する。
   */
  setVolumeEnabled(enabled: boolean): void {
    this.volumeSlider.disabled = !enabled;
  }

  /**
   * Phase 9: 両スライダーを一括 enable/disable する。
   */
  setEnabled(enabled: boolean): void {
    this.setF0Enabled(enabled);
    this.setVolumeEnabled(enabled);
  }

  /** リソース解放（イベント解除） */
  destroy(): void {
    this.f0Slider.removeEventListener('input', this.handleF0Input);
    this.volumeSlider.removeEventListener('input', this.handleVolumeInput);
  }

  // ==========================================================================
  // 内部
  // ==========================================================================

  private handleF0Input = (): void => {
    const sliderValue = parseFloat(this.f0Slider.value);
    const hz = sliderToF0(sliderValue);
    this.updateF0Display(hz);
    this.onF0Change(hz);
  };

  private handleVolumeInput = (): void => {
    const value = parseFloat(this.volumeSlider.value);
    this.updateVolumeDisplay(value);
    this.onVolumeChange(value);
  };

  private updateF0Display(hz: number): void {
    this.f0ValueEl.textContent = `${Math.round(hz)} Hz`;
  }

  private updateVolumeDisplay(value: number): void {
    this.volumeValueEl.textContent = `${Math.round(value * 100)}%`;
  }
}

// ============================================================================
// Rd ラベル取得
// ----------------------------------------------------------------------------
// Rd 値に応じた声質ラベルを返す。
// 0.3-0.7: Pressed, 0.7-1.2: Modal, 1.2-2.0: Lax, 2.0-2.7: Breathy
// ============================================================================

function getVoiceLabel(rd: number): string {
  if (rd < 0.7) return 'Pressed';
  if (rd < 1.2) return 'Modal';
  if (rd < 2.0) return 'Lax';
  return 'Breathy';
}

// ============================================================================
// 声質制御 (VoiceQualityControls)
// ----------------------------------------------------------------------------
// Rd スライダー（声質: 0.3–2.7）、Aspiration スライダー（気息量: 0–100%）、
// 声門モデル切替セレクトを管理する。
// ============================================================================

export class VoiceQualityControls {
  private readonly rdSlider: HTMLInputElement;
  private readonly rdValueEl: HTMLElement;
  private readonly aspirationSlider: HTMLInputElement;
  private readonly aspirationValueEl: HTMLElement;
  private readonly modelSelect: HTMLSelectElement;
  private readonly onRdChange: (rd: number) => void;
  private readonly onAspirationChange: (level: number) => void;
  private readonly onModelChange: (model: GlottalModelType) => void;

  constructor(
    rdSlider: HTMLInputElement,
    rdValueEl: HTMLElement,
    aspirationSlider: HTMLInputElement,
    aspirationValueEl: HTMLElement,
    modelSelect: HTMLSelectElement,
    onRdChange: (rd: number) => void,
    onAspirationChange: (level: number) => void,
    onModelChange: (model: GlottalModelType) => void,
  ) {
    this.rdSlider = rdSlider;
    this.rdValueEl = rdValueEl;
    this.aspirationSlider = aspirationSlider;
    this.aspirationValueEl = aspirationValueEl;
    this.modelSelect = modelSelect;
    this.onRdChange = onRdChange;
    this.onAspirationChange = onAspirationChange;
    this.onModelChange = onModelChange;

    // Rd スライダー初期化
    this.rdSlider.min = '0.3';
    this.rdSlider.max = '2.7';
    this.rdSlider.step = '0.1';
    this.rdSlider.value = '1.0';
    this.updateRdDisplay(1.0);

    // Aspiration スライダー初期化
    this.aspirationSlider.min = '0';
    this.aspirationSlider.max = '1';
    this.aspirationSlider.step = '0.01';
    this.aspirationSlider.value = '0';
    this.updateAspirationDisplay(0);

    // イベント登録
    this.rdSlider.addEventListener('input', this.handleRdInput);
    this.aspirationSlider.addEventListener('input', this.handleAspirationInput);
    this.modelSelect.addEventListener('change', this.handleModelChange);
  }

  // ==========================================================================
  // 公開 API
  // ==========================================================================

  /** 外部から Rd を設定する。スライダー位置と表示も更新。 */
  setRd(rd: number): void {
    this.rdSlider.value = String(rd);
    this.updateRdDisplay(rd);
  }

  /**
   * Phase 9: Rd / Aspiration / 声門モデルを一括 enable/disable する。
   * textRead モードでは phonemePlayer 側が声質パラメータを制御するため無効化する。
   */
  setEnabled(enabled: boolean): void {
    this.rdSlider.disabled = !enabled;
    this.aspirationSlider.disabled = !enabled;
    this.modelSelect.disabled = !enabled;
  }

  /** リソース解放（イベント解除） */
  destroy(): void {
    this.rdSlider.removeEventListener('input', this.handleRdInput);
    this.aspirationSlider.removeEventListener('input', this.handleAspirationInput);
    this.modelSelect.removeEventListener('change', this.handleModelChange);
  }

  // ==========================================================================
  // 内部
  // ==========================================================================

  private handleRdInput = (): void => {
    const rd = parseFloat(this.rdSlider.value);
    this.updateRdDisplay(rd);
    this.onRdChange(rd);
  };

  private handleAspirationInput = (): void => {
    const level = parseFloat(this.aspirationSlider.value);
    this.updateAspirationDisplay(level);
    this.onAspirationChange(level);
  };

  private handleModelChange = (): void => {
    const model = this.modelSelect.value as GlottalModelType;
    this.onModelChange(model);
  };

  private updateRdDisplay(rd: number): void {
    this.rdValueEl.textContent = `${rd.toFixed(1)} ${getVoiceLabel(rd)}`;
  }

  private updateAspirationDisplay(level: number): void {
    this.aspirationValueEl.textContent = `${Math.round(level * 100)}%`;
  }
}

// ============================================================================
// テキスト読み上げ UI (TextReadControls) — Phase 9 新規
// ----------------------------------------------------------------------------
// Phase 9 で追加されたテキスト読み上げ機能の UI コントローラ。
// - textarea (ひらがな入力、IME 対応)
// - 再生/停止トグルボタン
// - 速度スライダー (0.5x〜2.0x)
//
// 再生状態は外部 (main.ts) から setPlaying() で同期され、
// ボタンラベルと CSS クラス .playing を切替える。
//
// IME 入力中 (compositionstart〜compositionend) はボタンを無効化して
// Enter キー確定によるうっかり再生を防ぐ。
// ============================================================================

export class TextReadControls {
  private readonly textInput: HTMLTextAreaElement;
  private readonly textReadBtn: HTMLButtonElement;
  private readonly rateSlider: HTMLInputElement;
  private readonly rateValueEl: HTMLElement;
  private readonly onPlayRequested: (text: string, rate: number) => void;
  private readonly onStopRequested: () => void;

  private playing = false;
  // IME 入力中フラグ。compositionstart で true、compositionend で false。
  private isComposing = false;

  constructor(
    textInput: HTMLTextAreaElement,
    textReadBtn: HTMLButtonElement,
    rateSlider: HTMLInputElement,
    rateValueEl: HTMLElement,
    onPlayRequested: (text: string, rate: number) => void,
    onStopRequested: () => void,
  ) {
    this.textInput = textInput;
    this.textReadBtn = textReadBtn;
    this.rateSlider = rateSlider;
    this.rateValueEl = rateValueEl;
    this.onPlayRequested = onPlayRequested;
    this.onStopRequested = onStopRequested;

    // イベント結線
    this.textInput.addEventListener('input', this.handleTextInput);
    this.textInput.addEventListener('compositionstart', this.handleCompositionStart);
    this.textInput.addEventListener('compositionend', this.handleCompositionEnd);
    this.textReadBtn.addEventListener('click', this.handleButtonClick);
    this.rateSlider.addEventListener('input', this.handleRateInput);

    // 初期表示
    this.updateRateLabel();
    this.updateButtonState();
  }

  // ==========================================================================
  // 公開 API
  // ==========================================================================

  /**
   * 再生中フラグを外部から同期する (main.ts から phonemePlayer の状態を反映)。
   * 再生中は CSS クラス .playing とラベル「停止」を、停止中はラベル「読み上げ」を設定。
   */
  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.textReadBtn.classList.toggle('playing', playing);
    this.textReadBtn.textContent = playing ? '停止' : '読み上げ';
    this.updateButtonState();
  }

  /**
   * Phase 9: textarea + 速度スライダーを一括 enable/disable する。
   * ボタン状態は updateButtonState() が再計算する。
   */
  setEnabled(enabled: boolean): void {
    this.textInput.disabled = !enabled;
    this.rateSlider.disabled = !enabled;
    this.updateButtonState();
  }

  /**
   * Phase 9: 再生ボタンのみを enable/disable する (engine 状態に応じた制御用)。
   * enabled=true の場合は空文字列/IME 中を考慮した updateButtonState() を呼ぶ。
   */
  setButtonEnabled(enabled: boolean): void {
    if (enabled) {
      this.updateButtonState();
    } else {
      this.textReadBtn.disabled = true;
    }
  }

  /** 現在の入力テキストを取得する。 */
  getText(): string {
    return this.textInput.value;
  }

  /** 現在の速度スライダー値を取得する (0.5〜2.0)。 */
  getRate(): number {
    return parseFloat(this.rateSlider.value);
  }

  /** リソース解放（イベント解除） */
  destroy(): void {
    this.textInput.removeEventListener('input', this.handleTextInput);
    this.textInput.removeEventListener('compositionstart', this.handleCompositionStart);
    this.textInput.removeEventListener('compositionend', this.handleCompositionEnd);
    this.textReadBtn.removeEventListener('click', this.handleButtonClick);
    this.rateSlider.removeEventListener('input', this.handleRateInput);
  }

  // ==========================================================================
  // 内部
  // ==========================================================================

  private handleTextInput = (): void => {
    this.updateButtonState();
  };

  private handleCompositionStart = (): void => {
    this.isComposing = true;
    this.updateButtonState();
  };

  private handleCompositionEnd = (): void => {
    this.isComposing = false;
    this.updateButtonState();
  };

  private handleButtonClick = (): void => {
    if (this.playing) {
      this.onStopRequested();
    } else {
      const text = this.textInput.value.trim();
      if (text.length === 0) return;
      const rate = this.getRate();
      this.onPlayRequested(text, rate);
    }
  };

  private handleRateInput = (): void => {
    this.updateRateLabel();
  };

  private updateRateLabel(): void {
    const rate = parseFloat(this.rateSlider.value);
    this.rateValueEl.textContent = `${rate.toFixed(1)}x`;
  }

  /**
   * ボタン有効性の計算ロジック。
   * - 再生中: 常に有効（停止ボタンとして機能）
   * - 停止中: テキスト空 / IME 中 / textarea disabled のいずれかで無効
   */
  private updateButtonState(): void {
    if (this.playing) {
      this.textReadBtn.disabled = false;
      return;
    }
    const empty = this.textInput.value.trim().length === 0;
    this.textReadBtn.disabled = empty || this.isComposing || this.textInput.disabled;
  }
}
