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
import { LFGlottalSource } from '../models/lf-source.js';
import { VocalTract } from '../models/vocal-tract.js';
import {
  VOCAL_TRACT_PARAMETER_DESCRIPTORS,
  type VocalTractParamDescriptor,
} from './parameters.js';
import { NUM_SECTIONS, DEFAULT_F0 } from '../types/index.js';
import type { WorkletMessage, GlottalModel, GlottalModelType } from '../types/index.js';

class VocalTractProcessor extends AudioWorkletProcessor {
  // 声門音源と声道フィルタ
  private klglott88: Klglott88Source;
  private lfSource: LFGlottalSource;
  private glottalSource: GlottalModel; // 現在のアクティブモデル
  private pendingModelSwitch: GlottalModelType | null = null;
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

  // ===== Phase 6: サンプル精度線形補間 =====
  // scheduleTransition メッセージで指定された targetAreas へ durationSamples かけて
  // 線形補間する状態。補間中の中間値は transitionInterimAreas に書き込み、
  // vocalTract.setAreas() 経由で反射係数を更新する。
  // 全バッファはコンストラクタで事前確保し、process() 内では new を行わない (GC-free)。
  private transitionActive: boolean = false;
  private transitionStartAreas: Float64Array = new Float64Array(NUM_SECTIONS);
  private transitionTargetAreas: Float64Array = new Float64Array(NUM_SECTIONS);
  private transitionInterimAreas: Float64Array = new Float64Array(NUM_SECTIONS);
  private transitionElapsedSamples: number = 0;
  private transitionDurationSamples: number = 0;

  // ===== Phase 7: velum 線形補間 =====
  // scheduleTransition の拡張で targetVelumArea が指定されたとき、
  // velopharyngealArea も 44 区間断面積と同じ補間カーブで線形補間する。
  // 鼻音の遷移時に velum を瞬時に開閉するとクリックノイズが出るため、
  // 断面積補間と同期させて滑らかに開閉する。
  // transitionVelumActive が false のときは velum 補間をスキップする。
  private transitionStartVelumArea: number = 0;
  private transitionTargetVelumArea: number = 0;
  private transitionVelumActive: boolean = false;

  static get parameterDescriptors(): VocalTractParamDescriptor[] {
    return VOCAL_TRACT_PARAMETER_DESCRIPTORS;
  }

  constructor() {
    super();

    this.klglott88 = new Klglott88Source();
    this.lfSource = new LFGlottalSource();
    this.glottalSource = this.lfSource; // デフォルトはLFモデル
    this.vocalTract = new VocalTract();

    // メインスレッドからの断面積 / 音源切替メッセージを受信
    this.port.onmessage = (event: MessageEvent<WorkletMessage>): void => {
      const msg = event.data;
      if (msg.type === 'setAreas') {
        // 断面積更新 (反射係数の再計算は setAreas 内で実行される)
        // 配列長の不整合を防ぐバリデーション
        // Phase 6: 手動操作優先 — 補間中であれば即座に確定値で上書きし、補間を停止する。
        // Phase 7: velum 補間も同時に停止する (手動操作優先の原則)。
        this.transitionActive = false;
        this.transitionVelumActive = false;
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
      } else if (msg.type === 'setGlottalModel') {
        // モデル切替はゼロクロス（phase≈0）で実行するため pending に
        this.pendingModelSwitch = msg.model;
      } else if (msg.type === 'setRd') {
        if (Number.isFinite(msg.rd)) {
          this.lfSource.setRd!(msg.rd);
        }
      } else if (msg.type === 'setAspiration') {
        if (Number.isFinite(msg.level)) {
          this.lfSource.setAspiration!(msg.level);
        }
      } else if (msg.type === 'setConstrictionNoise') {
        // Phase 6: 狭窄ノイズ注入の有効化/無効化
        // position < 0 や intensity === 0 で無効化される (vocal-tract.ts 側で処理)。
        this.vocalTract.setConstrictionNoise(
          msg.position,
          msg.intensity,
          msg.centerFreq,
          msg.bandwidth,
        );
      } else if (msg.type === 'setNasalCoupling') {
        // Phase 7: velopharyngeal port (鼻腔カップリング面積) の即時設定。
        // 0 で velum 閉鎖 (鼻腔経路を完全にスキップ = Phase 6 と同一挙動)。
        // 1.5-2.0 cm² で鼻音時の全開状態 (3 ポート Smith 接合が起動)。
        // 進行中の velum 補間があれば上書きされる (手動操作優先の原則)。
        if (Number.isFinite(msg.velopharyngealArea) && msg.velopharyngealArea >= 0) {
          this.vocalTract.setNasalCoupling(msg.velopharyngealArea);
          this.transitionVelumActive = false;
        }
      } else if (msg.type === 'scheduleTransition') {
        // Phase 6: サンプル精度の線形補間を開始
        // 補間途中で新たな scheduleTransition を受信した場合は、
        // 「補間中の現在値」を始点として新 target へ即座切替える (クリック回避)。
        // 始点と target はメッセージ内 Float64Array をコピーして保持する (構造化クローン後の参照は安全だが、
        // 明示的にコピーすることで上流の意図しない変更からも独立させる)。
        const currentAreas = this.vocalTract.getCurrentAreas();
        for (let k = 0; k < NUM_SECTIONS; k++) {
          this.transitionStartAreas[k] = currentAreas[k]!;
          // targetAreas が NUM_SECTIONS 未満の場合は現在値を維持
          this.transitionTargetAreas[k] = msg.targetAreas[k] ?? this.transitionStartAreas[k]!;
        }
        this.transitionElapsedSamples = 0;
        // Phase 6 レビュー対応: 簡易版クリックノイズ対策
        // 補間は quantum (128 サンプル) 単位で進めているため、5ms (220 サンプル) だと
        // 最大 2 段階の階段しかできず耳につきやすい。下限を 512 サンプル (~12 ms) に
        // 切り上げることで最低 4 段階の補間を保証する。
        // サンプル単位の完全補間は Phase 8 で反射係数の直接線形補間として実装予定。
        const requested = msg.durationSamples > 0 ? msg.durationSamples : 1;
        this.transitionDurationSamples = requested < 512 ? 512 : requested;
        this.transitionActive = true;
        // Phase 7: velum 補間のセットアップ
        // targetVelumArea が指定された場合のみ velum 補間を有効化する。
        // 指定なしの場合 (既存 Phase 6 の呼び出し) は velum を触らず、
        // 現在の velopharyngealArea を維持する。
        if (msg.targetVelumArea !== undefined && Number.isFinite(msg.targetVelumArea)) {
          this.transitionStartVelumArea = this.vocalTract.getNasalCoupling();
          this.transitionTargetVelumArea = msg.targetVelumArea < 0 ? 0 : msg.targetVelumArea;
          this.transitionVelumActive = true;
        } else {
          this.transitionVelumActive = false;
        }
      } else if (msg.type === 'cancelTransition') {
        // Phase 6: 補間を中断する (現在の中間状態のまま停止)
        // Phase 7: velum 補間も同時に停止する
        this.transitionActive = false;
        this.transitionVelumActive = false;
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

    // ===== Phase 6 + 7: サンプル精度線形補間 (quantum 単位の更新) =====
    // 128 サンプル quantum の先頭で 1 回補間を進める。
    // (子音遷移は 5–60 ms = 220–2640 サンプルなので、128 サンプル粒度でも
    //  人間の聴覚的に十分滑らか。process() 内のコストを最小化するため
    //  サンプル毎ではなく quantum 毎の更新としている。)
    //
    // Phase 7: transitionVelumActive が true のとき、velopharyngealArea も
    // 同じ補間カーブで線形補間する。鼻音の開閉時にクリックノイズを防ぐ目的。
    if (this.transitionActive) {
      const t = this.transitionElapsedSamples / this.transitionDurationSamples;
      if (t >= 1.0) {
        // 補間完了: 最終値を確定して停止
        this.vocalTract.setAreas(this.transitionTargetAreas);
        if (this.transitionVelumActive) {
          this.vocalTract.setNasalCoupling(this.transitionTargetVelumArea);
          this.transitionVelumActive = false;
        }
        this.transitionActive = false;
      } else {
        // 線形補間: interim = start + (target - start) * t
        const start = this.transitionStartAreas;
        const target = this.transitionTargetAreas;
        const interim = this.transitionInterimAreas;
        for (let k = 0; k < NUM_SECTIONS; k++) {
          interim[k] = start[k]! + (target[k]! - start[k]!) * t;
        }
        this.vocalTract.setAreas(interim);
        // Phase 7: velum 線形補間 (同じ t を適用)
        if (this.transitionVelumActive) {
          const velumInterim = this.transitionStartVelumArea
            + (this.transitionTargetVelumArea - this.transitionStartVelumArea) * t;
          this.vocalTract.setNasalCoupling(velumInterim);
        }
      }
      this.transitionElapsedSamples += blockSize;
    }

    for (let i = 0; i < blockSize; i++) {
      // 位相を進める（ジッター適用済みF0で）
      phase += basePhaseIncrement * (1 + jitterFactor);
      if (phase >= 1.0) {
        phase -= 1.0;
        // 新しい声門周期の開始
        // ジッター更新
        if (jitterAmt > 0) {
          this.jitterSeed = (this.jitterSeed * 1664525 + 1013904223) >>> 0;
          jitterFactor = jitterAmt * (this.jitterSeed / 4294967296 * 2 - 1);
        }
        // モデル切替（ゼロクロスタイミング）
        if (this.pendingModelSwitch !== null) {
          this.glottalSource = this.pendingModelSwitch === 'lf'
            ? this.lfSource : this.klglott88;
          this.pendingModelSwitch = null;
        }
        // LFモデルのパラメータ更新（周期開始時のみ）
        this.lfSource.updateParams(f0);
      }

      // 声門音源 → 声道フィルタ
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
