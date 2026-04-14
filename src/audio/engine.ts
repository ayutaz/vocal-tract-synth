// ============================================================================
// AudioEngine — AudioContext / AudioWorklet 管理
// ----------------------------------------------------------------------------
// - AudioContext の生成（Start ボタンの click イベント内からのみ呼ばれる前提）
// - AudioWorklet モジュールのロード
// - AudioWorkletNode → GainNode → destination のノード接続
// - メインスレッド → Worklet への postMessage（断面積・音源切替）
// - F0 の AudioParam 設定
// - AnalyserNode によるスペクトル分析（Phase 3）
// ============================================================================

import type { WorkletMessage, SourceType } from '../types/index';
import { SAMPLE_RATE, DEFAULT_F0 } from '../types/index';
// Vite の `?worker&url` サフィックスにより、worklet-processor.ts は JavaScript に
// トランスパイル＆バンドルされ、その最終ファイルの URL が import される。
// これにより AudioWorklet は ES Module として正しくロードできる。
// AudioWorklet 用途だが、Vite はワーカーパスとしてバンドルしてくれるのでこの書き方で動く。
import workletUrl from './worklet-processor.ts?worker&url';

// Phase 1 ではデフォルトのマスタ音量（安全に耳に優しい値）
const DEFAULT_MASTER_GAIN = 0.3;

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private gainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private frequencyParam: AudioParam | null = null;

  /**
   * 音声合成を開始する。
   *
   * 必ず Start ボタンの click イベントハンドラ内から呼ぶこと
   * （Autoplay Policy 対策: AudioContext 生成にユーザーインタラクションが必要）。
   *
   * @param initialAreas Worklet に送信する初期断面積配列（44要素）
   * @throws ブラウザが Web Audio API / AudioWorklet に非対応の場合
   */
  async start(initialAreas: Readonly<Float64Array>): Promise<void> {
    if (this.audioContext !== null) {
      // 既に起動済み
      return;
    }

    // AudioContext の生成（ここで失敗すると catch 側でエラー状態に遷移）
    const ctx = new AudioContext({
      sampleRate: SAMPLE_RATE,
      latencyHint: 'interactive',
    });
    this.audioContext = ctx;

    // suspended 状態なら resume（一部ブラウザで発生）
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // AudioWorklet モジュールのロード（Promise が reject されると throw）
    await ctx.audioWorklet.addModule(workletUrl);

    // AudioWorkletNode の生成
    const node = new AudioWorkletNode(ctx, 'vocal-tract-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.workletNode = node;

    // F0 パラメータの取得（デフォルト 120Hz）
    const freqParam = node.parameters.get('frequency') ?? null;
    this.frequencyParam = freqParam;
    if (freqParam !== null) {
      freqParam.setValueAtTime(DEFAULT_F0, ctx.currentTime);
    }

    // GainNode（音量制御）
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(DEFAULT_MASTER_GAIN, ctx.currentTime);
    this.gainNode = gain;

    // AnalyserNode（スペクトル分析）
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6; // 0.8だと母音遷移(150ms)に追従しきれない
    this.analyserNode = analyser;

    // ノード接続: WorkletNode → GainNode → AnalyserNode → destination
    node.connect(gain);
    gain.connect(analyser);
    analyser.connect(ctx.destination);

    // 初期断面積を送信
    this.sendAreas(initialAreas);
  }

  /**
   * 音声合成を停止する。AudioContext を close してすべてのリソースを解放する。
   */
  stop(): void {
    if (this.audioContext === null) return;

    // ノード切断（念のため）
    if (this.workletNode !== null) {
      try {
        this.workletNode.disconnect();
      } catch {
        // 既に切断済み等は無視
      }
      this.workletNode = null;
    }
    if (this.gainNode !== null) {
      try {
        this.gainNode.disconnect();
      } catch {
        // 既に切断済み等は無視
      }
      this.gainNode = null;
    }
    if (this.analyserNode !== null) {
      try {
        this.analyserNode.disconnect();
      } catch {
        // 既に切断済み等は無視
      }
      this.analyserNode = null;
    }

    // AudioContext を close（Promise は待たずに投げっぱなし）
    const ctx = this.audioContext;
    this.audioContext = null;
    this.frequencyParam = null;
    ctx.close().catch(() => {
      // close の失敗は無視（既に close 済みの可能性）
    });
  }

  /**
   * 断面積配列を Worklet に送信する。
   * running 状態でないときはサイレント no-op。
   */
  sendAreas(areas: Readonly<Float64Array>): void {
    if (this.workletNode === null) return;

    // Float64Array を構造化クローンで直接送信（Array.from を避けて GC 圧力を削減）
    const msg: WorkletMessage = { type: 'setAreas', areas };
    this.workletNode.port.postMessage(msg);
  }

  /**
   * F0（基本周波数）を設定する。
   * Phase 1 では UI からは変更しないが、API として用意しておく。
   */
  setFrequency(hz: number): void {
    if (this.frequencyParam === null || this.audioContext === null) return;
    this.frequencyParam.setValueAtTime(hz, this.audioContext.currentTime);
  }

  /**
   * 音源タイプ（有声/無声）を切り替える。Worklet側でクロスフェードが行われる。
   */
  setSourceType(type: SourceType): void {
    if (this.workletNode === null) return;
    const msg: WorkletMessage = { type: 'setSourceType', sourceType: type };
    this.workletNode.port.postMessage(msg);
  }

  /**
   * Open Quotient を設定する。
   */
  setOQ(oq: number): void {
    if (this.workletNode === null) return;
    const msg: WorkletMessage = { type: 'setOQ', oq };
    this.workletNode.port.postMessage(msg);
  }

  /**
   * ジッター量を設定する (0.0-0.015)。Auto Sing から使用。
   */
  setJitter(amount: number): void {
    if (this.workletNode === null) return;
    const msg: WorkletMessage = { type: 'setJitter', amount };
    this.workletNode.port.postMessage(msg);
  }

  /**
   * シマー量を設定する (0.0-0.020)。Auto Sing から使用。
   */
  setShimmer(amount: number): void {
    if (this.workletNode === null) return;
    const msg: WorkletMessage = { type: 'setShimmer', amount };
    this.workletNode.port.postMessage(msg);
  }

  /**
   * AnalyserNode を返す。未初期化時は null。
   * スペクトル表示やフォルマント計算に使用する。
   */
  getAnalyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  /**
   * マスタ音量を設定する。
   * @param value 0.0（無音）〜 1.0（最大）
   */
  setVolume(value: number): void {
    if (this.gainNode === null || this.audioContext === null) return;
    this.gainNode.gain.setValueAtTime(value, this.audioContext.currentTime);
  }

  /**
   * AudioContext を返す。未初期化時は null。
   * Auto Singer の lookahead スケジューラで currentTime を参照するために使用。
   */
  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  /**
   * 現在 running 状態か（= AudioContext が生存しているか）。
   */
  isRunning(): boolean {
    return this.audioContext !== null;
  }
}
