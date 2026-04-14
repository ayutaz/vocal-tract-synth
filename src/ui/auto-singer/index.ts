// ============================================================================
// AutoSinger — Phase 4 統合コーディネータ
// ----------------------------------------------------------------------------
// 全ての Auto Sing サブモジュールを結線し、2系統のタイミングループで駆動する。
//
// 系統1: setInterval(25ms) + AudioContext.currentTime の lookahead scheduling
//   → ノートイベント発行、F0/母音/ジッター/シマーのスケジューリング
//   → Chris Wilson "A Tale of Two Clocks" パターン
//
// 系統2: requestAnimationFrame
//   → 表現パラメータ（ビブラート/ポルタメント）の描画同期更新
//   → フレーズ ADSR エンベロープの進行
//   → engine への F0 反映
// ============================================================================

import { MelodyGenerator } from './melody-generator';
import type { MelodyEvent } from './melody-generator';
import { RhythmEngine } from './rhythm-engine';
import { ExpressionEngine } from './expression-engine';
import { PhraseManager } from './phrase-manager';
import { VowelSequencer } from './vowel-sequencer';
import type { TransitionManager } from '../../models/vowel-presets';
import type { AudioEngine } from '../../audio/engine';
import type { TractEditor } from '../tract-editor';
import type { FormantController } from '../../models/formant-controller';

// ===== 定数 =====

/** スケジューラ間隔 (ms) */
const SCHEDULER_INTERVAL_MS = 25;

/** lookahead 秒数 — AudioContext.currentTime からこの先までスケジュール */
const LOOKAHEAD_SEC = 0.1;

/** デフォルト BPM */
const DEFAULT_BPM = 120;

/** ポルタメント適用確率 (65%) */
const PORTAMENTO_PROBABILITY = 0.65;

/** デフォルト F0 基準値 (Hz) — ユーザーの F0 スライダーとの合算用 */
const DEFAULT_F0_REF = 120;

// ===== 依存インターフェース =====

export interface AutoSingerDeps {
  /** AudioEngine — F0 設定、jitter/shimmer 送信 */
  engine: AudioEngine;
  /** TransitionManager — 母音遷移 (コサイン補間) */
  transitionManager: TransitionManager;
  /** TractEditor — ドラッグ無効化の通知 */
  tractEditor: TractEditor;
  /** FormantController — フォルマント再計算トリガー */
  formantController: FormantController;
  /** F0 スライダーの基準値を取得する関数 */
  getBaseF0: () => number;
}

// ===== 将来追加されるメソッドの型（別途統合で engine / tractEditor に追加予定） =====

/** AudioEngine に setJitter/setShimmer が追加される想定 */
interface AudioEngineWithJitterShimmer {
  setJitter(amount: number): void;
  setShimmer(amount: number): void;
}

/** TractEditor に setDragEnabled が追加される想定 */
interface TractEditorWithDragControl {
  setDragEnabled(enabled: boolean): void;
}

// ===== AutoSinger =====

export class AutoSinger {
  // --- 依存 ---
  private readonly engine: AudioEngine;
  private readonly transitionManager: TransitionManager;
  private readonly tractEditor: TractEditor;
  private readonly formantController: FormantController;
  private readonly getBaseF0: () => number;

  // --- サブモジュール ---
  private readonly melody: MelodyGenerator;
  private readonly rhythm: RhythmEngine;
  private readonly expression: ExpressionEngine;
  private readonly phrase: PhraseManager;
  private readonly vowel: VowelSequencer;

  // --- 状態 ---
  private active = false;
  private audioContext: AudioContext | null = null;
  private bpm: number = DEFAULT_BPM;

  // --- スケジューラ ---
  private schedulerTimerId: ReturnType<typeof setInterval> | null = null;
  /** 次のノートを発音すべき AudioContext 時刻 (秒) */
  private nextNoteTime: number = 0;

  // --- rAF 描画ループ ---
  private rafId: number = 0;
  private lastRafTimestamp: number = 0;

  // --- 現在のノート情報（rAF ループから参照） ---
  private currentNoteFreq: number = DEFAULT_F0_REF;
  /** 直前のノート周波数（ポルタメント用） */
  private prevNoteFreq: number = DEFAULT_F0_REF;

  constructor(deps: AutoSingerDeps) {
    this.engine = deps.engine;
    this.transitionManager = deps.transitionManager;
    this.tractEditor = deps.tractEditor;
    this.formantController = deps.formantController;
    this.getBaseF0 = deps.getBaseF0;

    // サブモジュール生成
    this.melody = new MelodyGenerator();
    this.rhythm = new RhythmEngine();
    this.expression = new ExpressionEngine();
    this.phrase = new PhraseManager();
    this.vowel = new VowelSequencer();
  }

  // ==========================================================================
  // 公開 API
  // ==========================================================================

  /**
   * Auto Sing を開始する。
   * AudioContext が running 状態であることが前提。
   */
  start(audioContext: AudioContext): void {
    if (this.active) return;

    this.active = true;
    this.audioContext = audioContext;

    // サブモジュールのリセット
    this.melody.reset();
    this.rhythm.reset();
    this.expression.reset();
    this.expression.setBpm(this.bpm);
    this.phrase.reset();
    this.phrase.setBpm(this.bpm);
    this.vowel.reset();

    // 初期ノート時刻を現在時刻に設定
    this.nextNoteTime = audioContext.currentTime;
    this.prevNoteFreq = this.getBaseF0();
    this.currentNoteFreq = this.prevNoteFreq;

    // ドラッグ無効化
    this.setDragEnabled(false);

    // 系統1: lookahead スケジューラ開始
    this.schedulerTimerId = setInterval(this.schedulerTick, SCHEDULER_INTERVAL_MS);

    // 系統2: rAF 描画ループ開始
    this.lastRafTimestamp = performance.now();
    this.rafId = requestAnimationFrame(this.renderLoop);
  }

  /**
   * Auto Sing を停止する。
   * 現在の断面積はそのまま保持し、手動操作可能状態に復帰する。
   */
  stop(): void {
    if (!this.active) return;

    this.active = false;

    // スケジューラ停止
    if (this.schedulerTimerId !== null) {
      clearInterval(this.schedulerTimerId);
      this.schedulerTimerId = null;
    }

    // rAF 停止
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }

    // 進行中の母音遷移をキャンセル（目標値を即座に適用）
    this.transitionManager.cancelTransition();

    // ジッター/シマーをゼロに戻す
    this.sendJitter(0);
    this.sendShimmer(0);

    // ドラッグ再有効化
    this.setDragEnabled(true);

    this.audioContext = null;
  }

  /**
   * BPM を設定する（リアルタイム変更可能）。
   */
  setBpm(bpm: number): void {
    this.bpm = bpm;
    this.expression.setBpm(bpm);
    this.phrase.setBpm(bpm);
  }

  /**
   * 現在 Auto Sing が動作中かどうか。
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * リソース解放。stop() が未呼び出しなら先に停止する。
   */
  destroy(): void {
    if (this.active) {
      this.stop();
    }
  }

  // ==========================================================================
  // 系統1: lookahead スケジューラ (setInterval 25ms)
  // ==========================================================================

  /**
   * 25ms ごとに呼ばれ、AudioContext.currentTime + LOOKAHEAD_SEC まで
   * ノートイベントをスケジュールする。
   */
  private schedulerTick = (): void => {
    if (!this.active || this.audioContext === null) return;

    const currentTime = this.audioContext.currentTime;
    const scheduleUntil = currentTime + LOOKAHEAD_SEC;

    // lookahead 窓内に収まるノートをすべてスケジュール
    while (this.nextNoteTime < scheduleUntil) {
      this.scheduleNextNote();
    }
  };

  /**
   * 1ノート分をスケジュールし、nextNoteTime を進める。
   */
  private scheduleNextNote(): void {
    // リズム: 次のノート長を取得
    const rhythmEvent = this.rhythm.nextNote(this.bpm);

    // フレーズ状態を取得（ノートの拍数を渡してフレーズ進行を更新）
    const phraseState = this.phrase.update(rhythmEvent.durationBeats);

    if (phraseState.isResting) {
      // 休符中: ジッター/シマーをゼロに（無音）
      this.sendJitter(0);
      this.sendShimmer(0);

      // 休符の長さ分だけ時間を進める
      const durationSec = rhythmEvent.durationMs / 1000;
      this.nextNoteTime += durationSec;
      return;
    }

    // --- ノート生成 ---

    // メロディ: 次の音高を取得
    const melodyEvent: MelodyEvent = this.melody.nextNote(phraseState.isApproachingPhraseEnd);

    // baseF0 を基準にメロディのピッチ比率を適用
    // ユーザーの F0 スライダー値を「移調量」として扱う:
    // baseF0 / DEFAULT_F0_REF で移調比率を算出し、メロディ周波数に掛ける
    const baseF0 = this.getBaseF0();
    const f0Ratio = baseF0 / DEFAULT_F0_REF;
    const noteFreq = melodyEvent.frequency * f0Ratio;

    // 母音: 次の母音を選択して遷移開始
    const vowelId = this.vowel.nextVowel();
    // 遷移時間はノート長の 40% 程度（音符が短いほど素早く遷移）
    const transitionMs = Math.min(rhythmEvent.durationMs * 0.4, 150);
    this.transitionManager.transitionTo(vowelId, transitionMs);

    // フォルマント再計算をトリガー
    this.formantController.schedule();

    // ポルタメント: 60-70% の確率で適用
    const usePortamento = Math.random() < PORTAMENTO_PROBABILITY;

    // ExpressionEngine にノート開始を通知
    this.expression.onNoteStart(noteFreq, this.prevNoteFreq, usePortamento);

    // ジッター/シマーを送信
    const expr = this.expression.update(0);
    this.sendJitter(expr.jitterAmount);
    this.sendShimmer(expr.shimmerAmount);

    // PhraseManager にノート開始を通知（ADSR アタック開始）
    this.phrase.onNoteStart(rhythmEvent.durationMs);

    // 現在のノート情報を保存（rAF ループから参照）
    this.prevNoteFreq = this.currentNoteFreq;
    this.currentNoteFreq = noteFreq;

    // F0 を engine に設定（ポルタメント/ビブラートは rAF で上書きされる）
    this.engine.setFrequency(noteFreq * expr.f0Modifier);

    // マイクロタイミング揺らぎを加味して次のノート時刻を算出
    const durationSec = rhythmEvent.durationMs / 1000;
    const microTimingSec = rhythmEvent.microTimingOffsetMs / 1000;
    this.nextNoteTime += durationSec + microTimingSec;
  }

  // ==========================================================================
  // 系統2: rAF 描画ループ
  // ==========================================================================

  /**
   * requestAnimationFrame コールバック。
   * 表現パラメータ（ビブラート/ポルタメント）とフレーズエンベロープを
   * 毎フレーム更新し、engine の F0 に反映する。
   */
  private renderLoop = (timestamp: number): void => {
    if (!this.active) return;

    // deltaTime (秒) — 最大 100ms でクランプ（タブ復帰時の暴走防止）
    const dt = Math.min((timestamp - this.lastRafTimestamp) / 1000, 0.1);
    this.lastRafTimestamp = timestamp;

    // 表現パラメータ更新（ビブラート / ポルタメント進行）
    const expr = this.expression.update(dt);

    // フレーズ ADSR / ブレス進行
    this.phrase.tick(dt);

    // F0 = 現在のノート周波数 * 表現係数（ビブラート + ポルタメント）
    const finalF0 = this.currentNoteFreq * expr.f0Modifier;
    this.engine.setFrequency(finalF0);

    // 次フレームを予約
    this.rafId = requestAnimationFrame(this.renderLoop);
  };

  // ==========================================================================
  // 内部: TractEditor ドラッグ制御
  // ==========================================================================

  /**
   * TractEditor のドラッグを有効/無効化する。
   * setDragEnabled メソッドが未追加の場合は何もしない（安全なフォールバック）。
   */
  private setDragEnabled(enabled: boolean): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = this.tractEditor as any;
    if (typeof editor.setDragEnabled === 'function') {
      (editor as TractEditorWithDragControl).setDragEnabled(enabled);
    }
  }

  // ==========================================================================
  // 内部: Worklet へのメッセージ送信
  // ==========================================================================

  /**
   * ジッター量を Worklet に送信する。
   * engine に setJitter メソッドが存在する場合はそちらを使い、
   * なければ何もしない（安全なフォールバック）。
   */
  private sendJitter(amount: number): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eng = this.engine as any;
    if (typeof eng.setJitter === 'function') {
      (eng as AudioEngineWithJitterShimmer).setJitter(amount);
    }
  }

  /**
   * シマー量を Worklet に送信する。
   */
  private sendShimmer(amount: number): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eng = this.engine as any;
    if (typeof eng.setShimmer === 'function') {
      (eng as AudioEngineWithJitterShimmer).setShimmer(amount);
    }
  }
}
