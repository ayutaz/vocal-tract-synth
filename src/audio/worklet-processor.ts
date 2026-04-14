// ===== AudioWorkletProcessor =====
//
// 声道合成のリアルタイム処理を AudioWorklet スレッドで実行する。
// process() は 128 サンプル単位で呼ばれるため、この中でのメモリ割り当て (new / [] / {}) は厳禁。
// 全ての状態バッファはコンストラクタで事前確保し、ループ内では既存バッファを再利用する。
//
// Vite は `new URL('./worklet-processor.ts', import.meta.url)` パターンで worklet ファイルを
// バンドルするため、models/ 以下からの import も動作する。

// ===== AudioWorkletGlobalScope の型宣言 =====
//
// TypeScript の lib.dom.d.ts には AudioWorkletProcessor / registerProcessor / sampleRate などの
// AudioWorkletGlobalScope 固有の API が含まれていないため、必要最小限の型をここで宣言する。
// (@types/audioworklet を別途インストールするのが公式だが、依存を増やさないためここで定義する)

interface VocalTractParamDescriptorLocal {
  name: string;
  defaultValue?: number;
  minValue?: number;
  maxValue?: number;
  automationRate?: 'a-rate' | 'k-rate';
}

interface AudioWorkletProcessorConstructor {
  new (): AudioWorkletProcessor;
  parameterDescriptors?: VocalTractParamDescriptorLocal[];
}

declare const sampleRate: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: AudioWorkletProcessorConstructor,
): void;

// ===== 実装 =====

import { Klglott88Source } from '../models/glottal-source.js';
import { VocalTract } from '../models/vocal-tract.js';
import {
  VOCAL_TRACT_PARAMETER_DESCRIPTORS,
  type VocalTractParamDescriptor,
} from './parameters.js';
import { NUM_SECTIONS, DEFAULT_F0 } from '../types/index.js';
import type { WorkletMessage } from '../types/index.js';

class VocalTractProcessor extends AudioWorkletProcessor {
  // 声門音源 (KLGLOTT88) と声道フィルタ (Kelly-Lochbaum)
  private glottalSource: Klglott88Source;
  private vocalTract: VocalTract;

  // 位相アキュムレータ (声門音源の位相 [0, 1))
  private phase: number = 0;

  // ジッター/シマー (Phase 4 Auto Sing)
  private jitterAmount: number = 0;
  private shimmerAmount: number = 0;
  // LCG 乱数シード（独立シードで jitter/shimmer の相関を回避）
  private jitterSeed: number = 54321;
  private shimmerSeed: number = 98765;
  // 周期単位ジッター: 新しい声門周期開始時のみ更新
  private currentJitterFactor: number = 0;

  static get parameterDescriptors(): VocalTractParamDescriptor[] {
    return VOCAL_TRACT_PARAMETER_DESCRIPTORS;
  }

  constructor() {
    super();

    this.glottalSource = new Klglott88Source();
    this.vocalTract = new VocalTract();

    // メインスレッドからの断面積 / 音源切替メッセージを受信
    this.port.onmessage = (event: MessageEvent<WorkletMessage>): void => {
      const msg = event.data;
      if (msg.type === 'setAreas') {
        // 断面積更新 (反射係数の再計算は setAreas 内で実行される)
        // 配列長の不整合を防ぐバリデーション
        if (msg.areas.length === NUM_SECTIONS) {
          this.vocalTract.setAreas(msg.areas);
        }
      } else if (msg.type === 'setSourceType') {
        // 有声/無声の切り替え (CROSSFADE_SAMPLES かけてクロスフェード)
        this.glottalSource.setSourceType(msg.sourceType);
      } else if (msg.type === 'setOQ') {
        // Open Quotient の更新（NaN/Infinity は無視）
        if (Number.isFinite(msg.oq)) {
          this.glottalSource.setOpenQuotient(msg.oq);
        }
      } else if (msg.type === 'setJitter') {
        if (Number.isFinite(msg.amount)) {
          this.jitterAmount = msg.amount;
        }
      } else if (msg.type === 'setShimmer') {
        if (Number.isFinite(msg.amount)) {
          this.shimmerAmount = msg.amount;
        }
      }
    };
  }

  process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    // 出力バス 0 (モノラル出力を想定)
    const output = outputs[0];
    if (output === undefined || output.length === 0) {
      // 出力が存在しない場合でも必ず true を返す (Chrome 互換性)
      return true;
    }
    const outputChannel = output[0];
    if (outputChannel === undefined) {
      return true;
    }

    // k-rate パラメータ: ブロック先頭の値を使用
    // (k-rate の場合、Float32Array の長さは 1)
    const freqParam = parameters.frequency;
    const f0 = (freqParam !== undefined && freqParam.length > 0)
      ? (freqParam[0] ?? DEFAULT_F0)
      : DEFAULT_F0;

    const basePhaseIncrement = f0 / sampleRate;
    const blockSize = outputChannel.length;
    let phase = this.phase;
    const jitterAmt = this.jitterAmount;
    const shimmerAmt = this.shimmerAmount;
    let jitterFactor = this.currentJitterFactor;

    for (let i = 0; i < blockSize; i++) {
      // 位相を進める（ジッター適用済みF0で）
      phase += basePhaseIncrement * (1 + jitterFactor);
      if (phase >= 1.0) {
        phase -= 1.0;
        // 新しい声門周期の開始 → ジッター値を更新（周期単位の変動）
        if (jitterAmt > 0) {
          this.jitterSeed = (this.jitterSeed * 1664525 + 1013904223) >>> 0;
          jitterFactor = jitterAmt * (this.jitterSeed / 4294967296 * 2 - 1);
        }
      }

      // 声門音源 (KLGLOTT88 + 有声/無声ミキシング) → 声道フィルタ
      let glottalSample = this.glottalSource.generateWithMix(phase);

      // シマー: 周期開始時に独立シードで振幅変動（shimmerSeed使用で相関回避）
      if (shimmerAmt > 0) {
        this.shimmerSeed = (this.shimmerSeed * 1664525 + 1013904223) >>> 0;
        const shimmerNoise = this.shimmerSeed / 4294967296 * 2 - 1;
        glottalSample *= (1 + shimmerAmt * shimmerNoise);
      }

      const sample = this.vocalTract.processSample(glottalSample);

      outputChannel[i] = sample;
    }

    this.phase = phase;
    this.currentJitterFactor = jitterFactor;

    // 他に出力チャンネルがある場合は同じ値をコピー (ステレオ互換)
    for (let c = 1; c < output.length; c++) {
      const ch = output[c];
      if (ch !== undefined) {
        for (let i = 0; i < blockSize; i++) {
          ch[i] = outputChannel[i]!;
        }
      }
    }

    // 必ず true を返す (Chrome 互換性: false を返すとプロセッサが破棄される)
    return true;
  }
}

registerProcessor('vocal-tract-processor', VocalTractProcessor);
