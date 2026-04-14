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

import type {
  WorkletMessage,
  SourceType,
  GlottalModelType,
  ConsonantId,
} from '../types/index';
import { SAMPLE_RATE, DEFAULT_F0, NUM_SECTIONS } from '../types/index';
import { CONSONANT_PRESETS } from './consonant-presets';
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

  // Phase 6 レビュー対応: 子音シーケンスの setTimeout ID を追跡し、
  // 連打 / stop() 時に確実にキャンセルできるようにする (競合・ゴーストノイズ防止)。
  private consonantTimeouts: ReturnType<typeof setTimeout>[] = [];

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

    // Phase 6 レビュー対応: 進行中の子音シーケンスをすべてキャンセル
    for (const t of this.consonantTimeouts) clearTimeout(t);
    this.consonantTimeouts.length = 0;

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
   * Rd パラメータ（声質）を設定する。
   * 0.3–2.7: Pressed → Modal → Lax → Breathy
   */
  setRd(rd: number): void {
    if (this.workletNode === null) return;
    const msg: WorkletMessage = { type: 'setRd', rd };
    this.workletNode.port.postMessage(msg);
  }

  /**
   * 気息成分（aspiration）レベルを設定する。
   * @param level 0.0（なし）〜 1.0（最大）
   */
  setAspiration(level: number): void {
    if (this.workletNode === null) return;
    const msg: WorkletMessage = { type: 'setAspiration', level };
    this.workletNode.port.postMessage(msg);
  }

  /**
   * 声門音源モデルを切り替える。
   * @param model 'klglott88' | 'lf'
   */
  setGlottalModel(model: GlottalModelType): void {
    if (this.workletNode === null) return;
    const msg: WorkletMessage = { type: 'setGlottalModel', model };
    this.workletNode.port.postMessage(msg);
  }

  // ==========================================================================
  // Phase 6: 子音基盤 API
  // --------------------------------------------------------------------------
  // 狭窄ノイズの注入 / サンプル精度補間 / 子音単独発声を、Worklet との間で
  // postMessage 経由で実行する API 群。
  // ==========================================================================

  /**
   * 狭窄ノイズ注入を設定/無効化する。
   *
   * 摩擦音 (/s/, /sh/ 等) の持続的乱流ノイズや、破裂音 (/k/, /t/, /p/ 等) の
   * バーストノイズを、指定 position の前進波 f[position] へ Biquad BPF 整形済みで
   * 加算する。position < 0 または intensity === 0 で無効化される。
   *
   * @param position    44 区間中のノイズ注入インデックス (0..N-1, 負値で無効化)
   * @param intensity   ノイズゲイン (0..1 程度を想定。0 で無効化)
   * @param centerFreq  BPF 中心周波数 [Hz]
   * @param bandwidth   BPF 帯域幅 [Hz] (Q = centerFreq / bandwidth)
   */
  setConstrictionNoise(
    position: number,
    intensity: number,
    centerFreq: number,
    bandwidth: number,
  ): void {
    if (this.workletNode === null) return;
    const msg: WorkletMessage = {
      type: 'setConstrictionNoise',
      position,
      intensity,
      centerFreq,
      bandwidth,
    };
    this.workletNode.port.postMessage(msg);
  }

  /**
   * Worklet 側で targetAreas へ durationSamples かけて線形補間を開始する。
   *
   * 補間中は process() 内で quantum 単位 (128 サンプル) に補間値を再計算し、
   * vocal-tract.ts の反射係数を逐次更新する。補間途中で再度呼び出した場合は
   * 「現在の補間中の値」を始点として新 target へ即座切替わる (クリック回避)。
   *
   * @param targetAreas      長さ NUM_SECTIONS の遷移先断面積配列
   * @param durationSamples  遷移時間 (サンプル数)
   */
  scheduleTransition(targetAreas: Float64Array, durationSamples: number): void {
    if (this.workletNode === null) return;
    const msg: WorkletMessage = {
      type: 'scheduleTransition',
      targetAreas,
      durationSamples,
    };
    this.workletNode.port.postMessage(msg);
  }

  /**
   * 進行中の補間を中断する (現在の中間状態のまま停止)。
   * 中断後は setAreas() で確定値を送信するか、新たな scheduleTransition で
   * 別の遷移を開始すること。
   */
  cancelTransition(): void {
    if (this.workletNode === null) return;
    const msg: WorkletMessage = { type: 'cancelTransition' };
    this.workletNode.port.postMessage(msg);
  }

  /**
   * 子音を単独発声する。
   *
   * 現在の母音形状 (currentAreas) を起点に、プリセットの constrictionRange の区間のみを
   * constrictionArea で上書きした「狭窄形状」へ scheduleTransition で遷移し、
   * カテゴリに応じてノイズ ON/OFF と母音への復帰遷移を setTimeout でスケジュールする。
   *
   * Phase 6 では setTimeout ベースの簡易シーケンサで実装する (Phase 8 の phoneme-player で
   * AudioContext.currentTime ベースの精密スケジューリングに置き換える予定)。
   *
   * @param id            子音 ID
   * @param currentAreas  先行母音の 44 区間断面積配列 (呼び出し側がコピーを保持)
   */
  playConsonant(id: ConsonantId, currentAreas: Float64Array): void {
    if (!this.isRunning()) return;
    const preset = CONSONANT_PRESETS[id];
    if (!preset) return;

    // Phase 6 レビュー対応: 連打時の競合回避
    // 前のシーケンスが残っていると setTimeout が並走し、ノイズ ON/OFF と遷移が交錯する。
    // 既存の timeout をすべてクリアし、ノイズも確実に停止してから新シーケンスを開始する。
    for (const t of this.consonantTimeouts) clearTimeout(t);
    this.consonantTimeouts.length = 0;
    this.setConstrictionNoise(-1, 0, 0, 0);

    // 狭窄形状を生成: 現在の areas をコピーし、constrictionRange の区間のみ上書き。
    // currentAreas は呼び出し側 (main.ts) で既にコピー済みの想定だが、
    // ここでもう一度コピーして「子音用の上書きバッファ」を作ることで、
    // 呼び出し側の元配列を破壊しないようにする。
    const constrictionAreas = new Float64Array(currentAreas);
    const { start, end } = preset.constrictionRange;
    if (start >= 0) {
      // start..end の範囲を constrictionArea で上書き (NUM_SECTIONS 範囲外は無視)
      for (let k = start; k <= end && k < NUM_SECTIONS; k++) {
        constrictionAreas[k] = preset.constrictionArea;
      }
    }

    const msToSamples = (ms: number): number =>
      Math.round((ms * SAMPLE_RATE) / 1000);

    // 中央位置 (ノイズ注入用)。constrictionRange.start < 0 (例: /h/) の場合は無効値。
    const midPos = start >= 0 ? Math.round((start + end) / 2) : -1;

    if (preset.category === 'fricative') {
      // ===== 摩擦音シーケンス =====
      // 1. 母音 → 狭窄形状に 20 ms 遷移
      // 2. ノイズ ON
      // 3. frictionMs (デフォルト 70 ms) 持続
      // 4. 狭窄 → 母音に 20 ms 遷移
      // 5. ノイズ OFF
      this.scheduleTransition(constrictionAreas, msToSamples(20));
      if (preset.noise && midPos >= 0) {
        this.setConstrictionNoise(
          midPos,
          preset.noise.gain,
          preset.noise.centerFreq,
          preset.noise.bandwidth,
        );
      }
      const frictionMs = preset.frictionMs ?? 70;
      const t1 = setTimeout(() => {
        this.scheduleTransition(currentAreas, msToSamples(20));
        this.setConstrictionNoise(-1, 0, 0, 0); // ノイズ OFF
      }, frictionMs + 20);
      this.consonantTimeouts.push(t1);
    } else if (preset.category === 'plosive') {
      // ===== 破裂音シーケンス =====
      // 1. 母音 → 閉鎖形状に 10 ms 遷移
      // 2. closureMs (デフォルト 60 ms) 閉鎖保持
      // 3. バーストノイズ ON + 閉鎖 → 母音に 5 ms 開放遷移
      // 4. burstMs + max(VOT, 0) 後にノイズ OFF
      this.scheduleTransition(constrictionAreas, msToSamples(10));
      const closureMs = preset.closureMs ?? 60;
      const t1 = setTimeout(() => {
        // バースト + 開放
        if (preset.noise && midPos >= 0) {
          this.setConstrictionNoise(
            midPos,
            preset.noise.gain,
            preset.noise.centerFreq,
            preset.noise.bandwidth,
          );
        }
        this.scheduleTransition(currentAreas, msToSamples(5));
        const burstMs = preset.burstMs ?? 10;
        const votMs = preset.vot !== undefined ? Math.max(preset.vot, 0) : 0;
        const t2 = setTimeout(() => {
          this.setConstrictionNoise(-1, 0, 0, 0); // ノイズ OFF
        }, burstMs + votMs);
        this.consonantTimeouts.push(t2);
      }, closureMs + 10);
      this.consonantTimeouts.push(t1);
    } else {
      // ===== 破擦音 / 弾音 / 半母音 (簡易実装) =====
      // 母音 → 狭窄 → 母音 を 15 ms 遷移で行う。Phase 6 の暫定実装で、
      // Phase 8 で各カテゴリ専用の精密シーケンサに置き換える予定。
      this.scheduleTransition(constrictionAreas, msToSamples(15));
      if (preset.noise && midPos >= 0) {
        this.setConstrictionNoise(
          midPos,
          preset.noise.gain,
          preset.noise.centerFreq,
          preset.noise.bandwidth,
        );
      }
      const holdMs = preset.frictionMs ?? preset.closureMs ?? 30;
      const t1 = setTimeout(() => {
        this.scheduleTransition(currentAreas, msToSamples(15));
        this.setConstrictionNoise(-1, 0, 0, 0); // ノイズ OFF
      }, holdMs + 15);
      this.consonantTimeouts.push(t1);
    }
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
