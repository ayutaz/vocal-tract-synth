// ============================================================================
// PhonemePlayer — Phase 8 テキスト読み上げ再生エンジン
// ----------------------------------------------------------------------------
// PhonemeEvent[] を AudioContext.currentTime 基準で再生するクラス。
//
// 設計方針:
// - 各イベントの fireEvent を setTimeout で予約し、サンプル精度の遷移は
//   Worklet 側の scheduleTransition (Phase 6 で追加済み) に委譲する。
// - メインスレッドの ±10 ms タイミング誤差は Worklet 側の補間で吸収される。
// - stop() / pause() / seek() の 4 状態 ('idle' | 'playing' | 'paused' | 'stopped')
//   を持ち、競合・ゴーストノイズを避けるため全タイマー追跡 + 一括キャンセルを徹底。
// - AudioEngine の API は import type で参照のみ (循環依存回避)。
// ============================================================================

import type { PhonemeEvent } from '../types/index';
import type { AudioEngine } from '../audio/engine';
import type { TractEditor } from '../ui/tract-editor';
import { SAMPLE_RATE, NUM_SECTIONS, NUM_CONTROL_POINTS } from '../types/index';

/** 再生中音素変更通知コールバック型 */
export type PhonemeChangeCallback = (event: PhonemeEvent, index: number) => void;
/** 再生完了通知コールバック型 */
export type CompleteCallback = () => void;

/** PhonemePlayer 内部状態 */
export type PhonemePlayerState = 'idle' | 'playing' | 'paused' | 'stopped';

/**
 * 16 制御点を 44 区間に補間する。
 * Phase 8 ではシンプルに線形補間で代替（既存 tract-editor のスプライン補間と
 * 完全一致ではないが、子音遷移時の音質差は小さい）。Phase 9 で本格スプラインに
 * 置き換え可能なよう、関数として独立させる。
 *
 * @param points16 16 制御点の断面積 (cm²)
 * @returns 44 区間の断面積 (cm²)
 */
function interpolateAreas16To44(points16: Float64Array): Float64Array {
  const out = new Float64Array(NUM_SECTIONS);
  for (let k = 0; k < NUM_SECTIONS; k++) {
    // [0..43] → [0..15] にスケーリング
    const t = (k * 15) / 43;
    const i = Math.floor(t);
    const frac = t - i;
    if (i >= 15) {
      // 末尾 (k = 43 のとき t = 15) は最終制御点をそのまま使用
      out[k] = points16[15]!;
    } else {
      out[k] = points16[i]! * (1 - frac) + points16[i + 1]! * frac;
    }
  }
  return out;
}

/**
 * Phase 8: PhonemeEvent[] を AudioContext.currentTime 基準で再生するエンジン。
 *
 * 使用例:
 * ```ts
 * const player = new PhonemePlayer(engine);
 * player.load(events);
 * player.onPhonemeChange((e, i) => highlightTimelineCell(i));
 * player.onComplete(() => console.log('done'));
 * await player.play();
 * ```
 */
export class PhonemePlayer {
  /** ロード済みのイベント列 */
  private events: PhonemeEvent[] = [];
  /** 再生状態 */
  private state: PhonemePlayerState = 'idle';
  /** play() を呼んだ時点の AudioContext.currentTime (秒) */
  private startContextTime: number = 0;
  /** 現在発火中のイベントインデックス (UI 通知 / seek 用) */
  private currentEventIndex: number = 0;
  /** 全 setTimeout ID を追跡 (cancelAllTimeouts で一括クリア) */
  private scheduledTimeouts: ReturnType<typeof setTimeout>[] = [];
  /** onPhonemeChange コールバック */
  private phonemeChangeCb: PhonemeChangeCallback | null = null;
  /** onComplete コールバック */
  private completeCb: CompleteCallback | null = null;
  /** play() の Promise を resolve するためのリゾルバ */
  private completeResolver: (() => void) | null = null;

  /**
   * @param engine      AudioEngine インスタンス
   * @param tractEditor (Phase 8 レビュー対応, optional) UI 状態を中性化するための TractEditor。
   *                    stop() 時に setControlPoints で 16 制御点を中性母音に戻す。
   *                    省略時は UI 同期をスキップ (テスト用)。
   */
  constructor(
    private readonly engine: AudioEngine,
    private readonly tractEditor?: TractEditor,
  ) {}

  /**
   * イベント配列をロードする。play() の前に呼び出すこと。
   * load 自体は副作用なし (再生は開始されない)。
   */
  load(events: PhonemeEvent[]): void {
    this.events = events;
    this.currentEventIndex = 0;
  }

  /**
   * 再生開始。返り値の Promise は再生完了時に resolve される。
   *
   * - すでに再生中の場合: Phase 8 レビュー対応で、既存タイマーをクリアして新しいイベント列で再開する。
   *   旧実装はサイレント破棄していたが、連続 play() 呼び出し (例: UI ボタンの2回押し) で
   *   2回目がイベントを失う問題があったため修正。
   * - イベントが空なら何もせず resolved Promise を返す。
   * - AudioContext が未起動なら reject する。
   */
  play(): Promise<void> {
    if (this.events.length === 0) return Promise.resolve();

    // Phase 8 レビュー対応: 既に再生中なら現在のタイマーをクリアして新規再生に切替える。
    // stop() を呼ばない (中性化遷移を走らせない) ことで、新しい音素列の遷移が
    // 中性形状からではなく現在の声道形状から始まり、自然な切替えが実現する。
    if (this.state === 'playing') {
      this.cancelAllTimeouts();
      // completeResolver はそのまま使い回す (旧 Promise は新規 Promise に切替える前に
      // 解放しないと旧 await 側がリークする)
      if (this.completeResolver) {
        this.completeResolver();
        this.completeResolver = null;
      }
    }

    const ctx = this.engine.getAudioContext();
    if (ctx === null) {
      return Promise.reject(new Error('AudioContext is not running'));
    }

    this.state = 'playing';
    this.startContextTime = ctx.currentTime;
    this.currentEventIndex = 0;
    this.scheduledTimeouts = [];

    return new Promise<void>((resolve) => {
      this.completeResolver = resolve;

      // 各イベントの fireEvent を setTimeout で予約。
      // fireAtMs は startTime - 5 ms (補間開始のリードタイム余裕)。
      for (let i = 0; i < this.events.length; i++) {
        const e = this.events[i]!;
        const fireAtMs = Math.max(0, e.startTime * 1000 - 5);
        const id = setTimeout(() => this.fireEvent(i), fireAtMs);
        this.scheduledTimeouts.push(id);
      }

      // 完了通知用の setTimeout を末尾に追加。
      // 最終イベント終了から 50 ms バッファを取って onComplete を発火。
      const lastEvent = this.events[this.events.length - 1]!;
      const endMs = (lastEvent.startTime + lastEvent.duration) * 1000 + 50;
      const completeId = setTimeout(() => this.handleComplete(), endMs);
      this.scheduledTimeouts.push(completeId);
    });
  }

  /**
   * 停止。全タイマーをキャンセルし、声道形状を中性母音にソフトリセットする。
   *
   * - 中性母音は均一管 (4.0 cm²) を 300 ms で線形補間。
   * - velum を閉鎖 (0)、狭窄ノイズを停止 (-1, 0, 0, 0)。
   * - 音素ゲインを 1.0 に戻す (Phase 8 レビュー対応: ユーザー音量を即時復元)。
   * - tractEditor (あれば) も中性化して UI とエンジン状態の不整合を防ぐ。
   * - play() の Promise が pending なら resolve する (await 側を解放)。
   * - すでに 'stopped' / 'idle' なら no-op。
   */
  stop(): void {
    if (this.state === 'stopped' || this.state === 'idle') return;

    this.cancelAllTimeouts();
    this.state = 'stopped';

    // 声道を中性母音 (均一管 4.0 cm²) にソフトリセット
    const neutralAreas = new Float64Array(NUM_CONTROL_POINTS);
    neutralAreas.fill(4.0);
    const neutral44 = interpolateAreas16To44(neutralAreas);
    this.engine.scheduleTransition(neutral44, Math.round(0.3 * SAMPLE_RATE));
    this.engine.setNasalCoupling(0);
    this.engine.setConstrictionNoise(-1, 0, 0, 0);
    // Phase 8 レビュー対応: 音素ゲインを 1.0 に戻し、ユーザー音量を即時復元する
    this.engine.setPhonemeAmplitude(1.0);

    // Phase 8 レビュー対応: tractEditor の 16 制御点も中性化して UI を同期する
    if (this.tractEditor) {
      this.tractEditor.setControlPoints(neutralAreas);
    }

    // play() の Promise を解放
    if (this.completeResolver) {
      this.completeResolver();
      this.completeResolver = null;
    }
  }

  /**
   * 一時停止。全タイマーをキャンセルするのみで Engine の状態は触らない。
   *
   * Engine の suspend は Auto Sing と共有しているため、PhonemePlayer の pause は
   * setTimeout のキャンセル + state 切り替えのみとする (PHASE8-001 3.3.3 参照)。
   * 'playing' 以外の状態では no-op。
   */
  pause(): void {
    if (this.state !== 'playing') return;
    this.cancelAllTimeouts();
    this.state = 'paused';
  }

  /**
   * シーク。指定時刻以降の最初のイベントへ currentEventIndex を進める。
   *
   * 再生中だった場合は currentEventIndex 以降のイベントだけを再スケジュールして
   * 再生を継続する (play() を再呼出すると currentEventIndex が 0 にリセットされる
   * ため、seek 専用の再スケジュール経路を持つ)。
   * 一時停止中の場合はインデックスのみ更新。
   *
   * @param timeSeconds シーク先の絶対時刻 (秒)
   */
  seek(timeSeconds: number): void {
    const wasPlaying = this.state === 'playing';
    this.cancelAllTimeouts();

    // t 以降の最初のイベントインデックスを線形検索 (イベント数は通常 < 100)
    // どのイベントも条件を満たさなければ events.length (範囲外) とし、
    // 再生再開時に即 onComplete に進む。
    let newIdx = this.events.length;
    for (let i = 0; i < this.events.length; i++) {
      if (this.events[i]!.startTime >= timeSeconds) {
        newIdx = i;
        break;
      }
    }
    this.currentEventIndex = newIdx;

    if (wasPlaying) {
      // 再生中なら newIdx 以降のイベントを再スケジュール。
      // play() を呼ぶと currentEventIndex がリセットされるため、
      // ここでは直接 setTimeout を登録する。
      this.rescheduleFromIndex(newIdx, timeSeconds);
    }
  }

  /**
   * 現在再生中のイベントが切り替わったときに呼ばれるコールバックを登録する。
   * UI のタイムラインハイライトや tract-editor の自動アニメーションに使用。
   */
  onPhonemeChange(cb: PhonemeChangeCallback): void {
    this.phonemeChangeCb = cb;
  }

  /**
   * 再生完了時に呼ばれるコールバックを登録する。
   * UI の再生ボタンを「停止」→「再生」に戻すフックとして使用。
   */
  onComplete(cb: CompleteCallback): void {
    this.completeCb = cb;
  }

  /** 現在の状態を返す (テスト用 / UI ボタン制御用) */
  getState(): PhonemePlayerState {
    return this.state;
  }

  /**
   * 現在発火中のイベントインデックスを返す。
   * UI のタイムラインハイライト維持や、外部からの状態問い合わせに使用する。
   */
  getCurrentEventIndex(): number {
    return this.currentEventIndex;
  }

  /**
   * play() を呼んだ時点の AudioContext.currentTime を返す。
   * シーク後の経過時間計算や、外部スケジューラとの同期に使用する。
   */
  getStartContextTime(): number {
    return this.startContextTime;
  }

  /**
   * Phase 9 レビュー対応: AudioContext.currentTime ベースの現在再生時刻を返す（秒）。
   *
   * setTimeout のジッター（~10ms 程度の誤差）を排した正確な時刻。
   * タイムラインハイライトや外部スケジューラとの同期に使用する。
   * 再生中 ('playing') 以外では 0 を返す。
   */
  getCurrentPlaybackTime(): number {
    if (this.state !== 'playing') return 0;
    const ctx = this.engine.getAudioContext();
    if (ctx === null) return 0;
    return ctx.currentTime - this.startContextTime;
  }

  // ==========================================================================
  // 内部メソッド
  // ==========================================================================

  /**
   * イベントを発火する。setTimeout のコールバックから呼ばれる。
   *
   * - 'playing' でなければ no-op (stop / pause 後の遅延発火を無視)。
   * - 16→44 変換後 scheduleTransition で声道形状遷移を開始。
   * - 声門音源タイプ・F0・鼻腔結合・狭窄ノイズ・音素振幅を Engine に伝達。
   * - phonemeChangeCb で UI 通知。
   */
  private fireEvent(index: number): void {
    if (this.state !== 'playing') return;
    const e = this.events[index];
    if (!e) return;

    this.currentEventIndex = index;

    // 1. 声道形状遷移 (16 制御点 → 44 区間)
    const areas44 = interpolateAreas16To44(e.tractAreas);
    const durationSamples = Math.max(
      1,
      Math.round((e.transitionMs / 1000) * SAMPLE_RATE),
    );
    this.engine.scheduleTransition(areas44, durationSamples);

    // 2. 音素振幅 (Phase 8 レビュー対応)
    //    silence 区間は 0 に、それ以外は e.amplitude を反映する。
    //    setVolume (ユーザースライダー) とは独立に動作するため、
    //    再生終了後にユーザー音量を復元する必要はない。
    if (e.sourceType === 'silence') {
      this.engine.setPhonemeAmplitude(0);
    } else {
      this.engine.setPhonemeAmplitude(e.amplitude);
    }

    // 3. 声門音源タイプ (Phase 8 レビュー対応で 'noise' / 'silence' も対応)
    //    Engine.setSourceType の型は 'voiced' | 'noise' のみのため、
    //    PhonemeEvent.sourceType を以下のようにマッピングする:
    //    - 'voiced'        → 'voiced'
    //    - 'voiced+noise'  → 'voiced' (狭窄ノイズで擦過音成分を加算)
    //    - 'noise'         → 'noise' (純粋無声摩擦音)
    //    - 'silence'       → setSourceType を呼ばない (現状維持、振幅 0 で無音化)
    if (e.sourceType === 'noise') {
      this.engine.setSourceType('noise');
    } else if (e.sourceType === 'voiced' || e.sourceType === 'voiced+noise') {
      this.engine.setSourceType('voiced');
    }

    // 4. F0 (基本周波数) — Phase 8 レビュー対応: f0Start → f0End の線形ランプ
    //    silence では f0Start=0 となり setFrequency をスキップする (前回値維持)。
    if (e.f0Start > 0) {
      this.engine.setFrequency(e.f0Start);
      if (e.f0End > 0 && e.f0End !== e.f0Start) {
        this.engine.rampFrequency(e.f0End, e.duration);
      }
    }

    // 5. 鼻腔結合 (velum 開放面積)
    this.engine.setNasalCoupling(e.nasalCoupling);

    // 6. 狭窄ノイズ (摩擦音 / 破裂音バースト)
    if (e.constrictionNoise) {
      this.engine.setConstrictionNoise(
        e.constrictionNoise.position,
        e.constrictionNoise.intensity,
        e.constrictionNoise.centerFreq,
        e.constrictionNoise.bandwidth,
      );
    } else {
      this.engine.setConstrictionNoise(-1, 0, 0, 0);
    }

    // 7. UI 通知 (タイムラインハイライト等)
    this.phonemeChangeCb?.(e, index);
  }

  /**
   * 再生完了処理。最終イベント終了 + 50 ms 後に呼ばれる。
   *
   * - 'playing' でなければ no-op (stop 後の遅延発火を無視)。
   * - 狭窄ノイズと鼻腔結合を停止して安全な状態に戻す。
   * - 音素ゲインを 1.0 に戻し、ユーザー音量を即時復元する (Phase 8 レビュー対応)。
   * - state を 'idle' に戻し、completeCb と play() の Promise を resolve。
   */
  private handleComplete(): void {
    if (this.state !== 'playing') return;

    // 終了処理: ノイズ停止 + velum 閉鎖
    this.engine.setConstrictionNoise(-1, 0, 0, 0);
    this.engine.setNasalCoupling(0);
    // Phase 8 レビュー対応: 音素ゲインを 1.0 に戻して再生終了後の音量をユーザー設定に復元
    this.engine.setPhonemeAmplitude(1.0);
    this.state = 'idle';

    this.completeCb?.();
    if (this.completeResolver) {
      this.completeResolver();
      this.completeResolver = null;
    }
  }

  /** 全 setTimeout をキャンセルし、追跡配列をクリアする */
  private cancelAllTimeouts(): void {
    for (const id of this.scheduledTimeouts) clearTimeout(id);
    this.scheduledTimeouts = [];
  }

  /**
   * seek 用: 指定インデックス以降のイベントを再スケジュールする。
   *
   * - ベースタイム (シーク先) を 0 として相対時刻で setTimeout を登録する。
   * - 範囲外インデックスが渡された場合は即座に handleComplete を発火する。
   * - play() と違い currentEventIndex をリセットしない。
   *
   * @param fromIndex 再スケジュールを開始するイベントインデックス
   * @param baseTimeSec 新しい基準時刻 (秒)。fromIndex のイベント開始時刻を
   *                    この値からの相対にマップする。
   */
  private rescheduleFromIndex(fromIndex: number, baseTimeSec: number): void {
    // 範囲外: 即完了通知だけ予約
    if (fromIndex >= this.events.length) {
      const completeId = setTimeout(() => this.handleComplete(), 50);
      this.scheduledTimeouts.push(completeId);
      return;
    }

    // 各イベントを baseTimeSec 基準で再予約
    for (let i = fromIndex; i < this.events.length; i++) {
      const e = this.events[i]!;
      // 負の値になりうるので 0 にクランプ
      const fireAtMs = Math.max(0, (e.startTime - baseTimeSec) * 1000 - 5);
      const id = setTimeout(() => this.fireEvent(i), fireAtMs);
      this.scheduledTimeouts.push(id);
    }

    // 完了通知
    const lastEvent = this.events[this.events.length - 1]!;
    const endMs = (lastEvent.startTime + lastEvent.duration - baseTimeSec) * 1000 + 50;
    const completeId = setTimeout(() => this.handleComplete(), Math.max(0, endMs));
    this.scheduledTimeouts.push(completeId);
  }
}
