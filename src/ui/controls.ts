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

import type { AppState } from '../types/index';

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
