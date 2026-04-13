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

import { GlottalSource } from '../models/glottal-source.js';
import { VocalTract } from '../models/vocal-tract.js';
import {
  VOCAL_TRACT_PARAMETER_DESCRIPTORS,
  type VocalTractParamDescriptor,
} from './parameters.js';
import { NUM_SECTIONS, DEFAULT_F0 } from '../types/index.js';
import type { WorkletMessage } from '../types/index.js';

class VocalTractProcessor extends AudioWorkletProcessor {
  // 声門音源 (三角波パルス) と声道フィルタ (Kelly-Lochbaum)
  private glottalSource: GlottalSource;
  private vocalTract: VocalTract;

  // 位相アキュムレータ (声門音源の位相 [0, 1))
  // F0 / sampleRate を毎サンプル加算し、1.0 を超えたら 1.0 を減算する。
  private phase: number = 0;

  static get parameterDescriptors(): VocalTractParamDescriptor[] {
    return VOCAL_TRACT_PARAMETER_DESCRIPTORS;
  }

  constructor() {
    super();

    this.glottalSource = new GlottalSource();
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
        // Phase 1 では pulse のみサポート。noise は Phase 2 以降で実装するため、
        // ここでは将来拡張用にメッセージを受け取っておく (現時点では何もしない)。
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
      ? freqParam[0]
      : DEFAULT_F0;

    const phaseIncrement = f0! / sampleRate;
    const blockSize = outputChannel.length;
    let phase = this.phase;

    for (let i = 0; i < blockSize; i++) {
      // 位相を進める
      phase += phaseIncrement;
      if (phase >= 1.0) {
        phase -= 1.0;
      }

      // 声門音源 → 声道フィルタ
      const glottalSample = this.glottalSource.generate(phase);
      const sample = this.vocalTract.processSample(glottalSample);

      outputChannel[i] = sample;
    }

    this.phase = phase;

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
