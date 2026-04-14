// ============================================================================
// AutoSingControls — Auto Sing ボタン + BPM スライダーの UI 制御
// ----------------------------------------------------------------------------
// - Auto Sing ボタン: トグル動作 + .active CSS クラスの付け外し
// - BPM スライダー: 40-200, デフォルト 120, input イベントで即時反映
// - destroy() でイベントリスナーを解除
// ============================================================================

export class AutoSingControls {
  private readonly autoSingBtn: HTMLButtonElement;
  private readonly bpmSlider: HTMLInputElement;
  private readonly bpmValueEl: HTMLElement;
  private readonly onToggle: (active: boolean) => void;
  private readonly onBpmChange: (bpm: number) => void;

  private active = false;

  constructor(
    autoSingBtn: HTMLButtonElement,
    bpmSlider: HTMLInputElement,
    bpmValueEl: HTMLElement,
    onToggle: (active: boolean) => void,
    onBpmChange: (bpm: number) => void,
  ) {
    this.autoSingBtn = autoSingBtn;
    this.bpmSlider = bpmSlider;
    this.bpmValueEl = bpmValueEl;
    this.onToggle = onToggle;
    this.onBpmChange = onBpmChange;

    // イベント登録
    this.autoSingBtn.addEventListener('click', this.handleToggle);
    this.bpmSlider.addEventListener('input', this.handleBpmInput);

    // BPM 表示の初期値
    this.bpmValueEl.textContent = `${this.bpmSlider.value} BPM`;
  }

  // ==========================================================================
  // 公開 API
  // ==========================================================================

  /**
   * 外部から Active 状態を変更する（Auto Sing 開始/停止時に UI を同期）。
   */
  setActive(active: boolean): void {
    this.active = active;
    this.autoSingBtn.classList.toggle('active', active);
  }

  /**
   * Phase 9: Auto Sing ボタンの enable/disable を制御する。
   * textRead モードでは Auto Sing への遷移を禁止するためボタンを無効化する。
   */
  setEnabled(enabled: boolean): void {
    this.autoSingBtn.disabled = !enabled;
  }

  /**
   * Phase 9: BPM スライダーの enable/disable を制御する。
   * textRead モードでは BPM 調整も不要なため無効化する。
   */
  setBpmEnabled(enabled: boolean): void {
    this.bpmSlider.disabled = !enabled;
  }

  /** リソース解放（イベント解除） */
  destroy(): void {
    this.autoSingBtn.removeEventListener('click', this.handleToggle);
    this.bpmSlider.removeEventListener('input', this.handleBpmInput);
  }

  // ==========================================================================
  // 内部
  // ==========================================================================

  private handleToggle = (): void => {
    this.active = !this.active;
    this.autoSingBtn.classList.toggle('active', this.active);
    this.onToggle(this.active);
  };

  private handleBpmInput = (): void => {
    const bpm = parseInt(this.bpmSlider.value, 10);
    this.bpmValueEl.textContent = `${bpm} BPM`;
    this.onBpmChange(bpm);
  };
}
