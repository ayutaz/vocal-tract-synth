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

import type { AppState, VowelId } from '../types/index';
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
