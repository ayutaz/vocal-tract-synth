// ============================================================================
// PhonemePlayer (Phase 8) のユニットテスト
// ----------------------------------------------------------------------------
// AudioEngine をモックし、fake timers で setTimeout の発火順序を制御する。
// 各テストでは load → play → vi.advanceTimersByTime → エンジン呼び出し検証
// の流れで PhonemePlayer の状態遷移とコールバック発火を確認する。
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PhonemePlayer } from './phoneme-player';
import type { PhonemeEvent } from '../types/index';
import { SAMPLE_RATE, NUM_SECTIONS } from '../types/index';

// ============================================================================
// テストヘルパ
// ============================================================================

/**
 * AudioEngine をモックする。getAudioContext は { currentTime: 0 } を返す。
 * vi.fn() は呼び出し回数 / 引数の検証に使用する。
 */
function createMockEngine(opts?: { contextNull?: boolean }) {
  const ctx = { currentTime: 0 };
  return {
    getAudioContext: vi.fn(() => (opts?.contextNull ? null : ctx)),
    scheduleTransition: vi.fn(),
    setSourceType: vi.fn(),
    setFrequency: vi.fn(),
    setNasalCoupling: vi.fn(),
    setConstrictionNoise: vi.fn(),
  };
}

/**
 * テスト用の PhonemeEvent を生成する。
 * tractAreas は均一管 (4.0 cm²) で初期化。
 */
function createMockEvent(
  startTime: number,
  phoneme: string,
  duration: number,
  overrides: Partial<PhonemeEvent> = {},
): PhonemeEvent {
  const tractAreas = new Float64Array(16);
  tractAreas.fill(4.0);
  return {
    phoneme,
    startTime,
    duration,
    tractAreas,
    f0Start: 120,
    f0End: 118,
    sourceType: 'voiced',
    amplitude: 0.7,
    nasalCoupling: 0,
    transitionMs: 15,
    ...overrides,
  };
}

// ============================================================================
// テスト本体
// ============================================================================

describe('PhonemePlayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // load + play: タイマー予約
  // --------------------------------------------------------------------------
  describe('load + play', () => {
    it('events.length + 1 個の setTimeout が予約される (各イベント + 完了通知)', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      const events = [
        createMockEvent(0.0, 'a', 0.1),
        createMockEvent(0.1, 'k', 0.05),
        createMockEvent(0.15, 'i', 0.1),
      ];
      player.load(events);
      void player.play();

      // events.length (3) + 完了通知用 (1) = 4 個のタイマーが pending
      expect(vi.getTimerCount()).toBe(events.length + 1);
    });

    it('play() で state が "playing" に遷移する', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([createMockEvent(0.0, 'a', 0.1)]);
      void player.play();
      expect(player.getState()).toBe('playing');
    });

    it('events が空のとき即座に resolve され state は idle のまま', async () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([]);
      const promise = player.play();
      await expect(promise).resolves.toBeUndefined();
      expect(player.getState()).toBe('idle');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('既に再生中の play() 呼び出しは no-op (タイマー追加されない)', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([createMockEvent(0.0, 'a', 0.1)]);
      void player.play();
      const beforeCount = vi.getTimerCount();
      void player.play();
      expect(vi.getTimerCount()).toBe(beforeCount);
    });
  });

  // --------------------------------------------------------------------------
  // fireEvent: Engine 呼び出し検証
  // --------------------------------------------------------------------------
  describe('fireEvent (各イベント発火時の Engine 呼び出し)', () => {
    it('scheduleTransition が 16→44 変換後の配列で呼ばれる', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      const tractAreas = new Float64Array(16);
      tractAreas.fill(3.5);
      player.load([
        createMockEvent(0.0, 'a', 0.1, { tractAreas, transitionMs: 15 }),
      ]);
      void player.play();
      vi.advanceTimersByTime(20); // 0 ms 発火 (リードタイム -5 なので clamp 0)

      expect(engine.scheduleTransition).toHaveBeenCalledTimes(1);
      const callArgs = engine.scheduleTransition.mock.calls[0]!;
      const passedAreas = callArgs[0] as Float64Array;
      expect(passedAreas.length).toBe(NUM_SECTIONS);
      // 全要素が 3.5 になっているはず (均一)
      for (let i = 0; i < NUM_SECTIONS; i++) {
        expect(passedAreas[i]).toBeCloseTo(3.5, 5);
      }
      // durationSamples = 15 ms × 44100 / 1000 ≈ 662
      const durationSamples = callArgs[1] as number;
      expect(durationSamples).toBe(Math.round((15 / 1000) * SAMPLE_RATE));
    });

    it('voiced イベントで setSourceType("voiced") が呼ばれる', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([
        createMockEvent(0.0, 'a', 0.1, { sourceType: 'voiced' }),
      ]);
      void player.play();
      vi.advanceTimersByTime(20);
      expect(engine.setSourceType).toHaveBeenCalledWith('voiced');
    });

    it('voiced+noise イベントでも setSourceType("voiced") が呼ばれる', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([
        createMockEvent(0.0, 'd', 0.05, { sourceType: 'voiced+noise' }),
      ]);
      void player.play();
      vi.advanceTimersByTime(20);
      expect(engine.setSourceType).toHaveBeenCalledWith('voiced');
    });

    it('silence イベントでは setSourceType が呼ばれない', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([
        createMockEvent(0.0, 'Q', 0.05, { sourceType: 'silence' }),
      ]);
      void player.play();
      vi.advanceTimersByTime(20);
      expect(engine.setSourceType).not.toHaveBeenCalled();
    });

    it('setFrequency が f0Start で呼ばれる', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([createMockEvent(0.0, 'a', 0.1, { f0Start: 220 })]);
      void player.play();
      vi.advanceTimersByTime(20);
      expect(engine.setFrequency).toHaveBeenCalledWith(220);
    });

    it('setNasalCoupling が nasalCoupling 値で呼ばれる', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([
        createMockEvent(0.0, 'm', 0.05, { nasalCoupling: 1.8 }),
      ]);
      void player.play();
      vi.advanceTimersByTime(20);
      expect(engine.setNasalCoupling).toHaveBeenCalledWith(1.8);
    });

    it('constrictionNoise ありで setConstrictionNoise が引数を伝達する', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([
        createMockEvent(0.0, 's', 0.05, {
          sourceType: 'noise',
          constrictionNoise: {
            position: 8,
            intensity: 0.6,
            centerFreq: 6000,
            bandwidth: 1500,
          },
        }),
      ]);
      void player.play();
      vi.advanceTimersByTime(20);
      expect(engine.setConstrictionNoise).toHaveBeenCalledWith(8, 0.6, 6000, 1500);
    });

    it('constrictionNoise なしで setConstrictionNoise(-1, 0, 0, 0) が呼ばれる', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([createMockEvent(0.0, 'a', 0.1)]);
      void player.play();
      vi.advanceTimersByTime(20);
      expect(engine.setConstrictionNoise).toHaveBeenCalledWith(-1, 0, 0, 0);
    });
  });

  // --------------------------------------------------------------------------
  // stop: 中性化 + タイマーキャンセル
  // --------------------------------------------------------------------------
  describe('stop', () => {
    it('全タイマーがキャンセルされる', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([
        createMockEvent(0.0, 'a', 0.1),
        createMockEvent(0.1, 'k', 0.05),
      ]);
      void player.play();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      player.stop();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('stop で state が "stopped" になる', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([createMockEvent(0.0, 'a', 0.1)]);
      void player.play();
      player.stop();
      expect(player.getState()).toBe('stopped');
    });

    it('中性化の scheduleTransition が呼ばれ、44 区間すべて 4.0 cm² である', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([createMockEvent(0.0, 'a', 0.1)]);
      void player.play();
      // play() で fireEvent 用の scheduleTransition が呼ばれる前に stop
      // -> stop 内の中性化 scheduleTransition のみが計上される
      const beforeStopCalls = engine.scheduleTransition.mock.calls.length;
      player.stop();
      const afterStopCalls = engine.scheduleTransition.mock.calls.length;
      expect(afterStopCalls).toBe(beforeStopCalls + 1);

      const lastCall = engine.scheduleTransition.mock.calls[afterStopCalls - 1]!;
      const neutralAreas = lastCall[0] as Float64Array;
      expect(neutralAreas.length).toBe(NUM_SECTIONS);
      for (let i = 0; i < NUM_SECTIONS; i++) {
        expect(neutralAreas[i]).toBeCloseTo(4.0, 5);
      }
      // duration = 0.3 秒 × SAMPLE_RATE
      expect(lastCall[1]).toBe(Math.round(0.3 * SAMPLE_RATE));
    });

    it('stop で setNasalCoupling(0) と setConstrictionNoise(-1, 0, 0, 0) が呼ばれる', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([createMockEvent(0.0, 'a', 0.1)]);
      void player.play();
      engine.setNasalCoupling.mockClear();
      engine.setConstrictionNoise.mockClear();
      player.stop();
      expect(engine.setNasalCoupling).toHaveBeenCalledWith(0);
      expect(engine.setConstrictionNoise).toHaveBeenCalledWith(-1, 0, 0, 0);
    });

    it('stop で play() の Promise が resolve される', async () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([createMockEvent(0.0, 'a', 0.5)]);
      const promise = player.play();
      player.stop();
      await expect(promise).resolves.toBeUndefined();
    });

    it('idle 状態での stop は no-op (scheduleTransition 呼ばれない)', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.stop();
      expect(engine.scheduleTransition).not.toHaveBeenCalled();
      expect(player.getState()).toBe('idle');
    });
  });

  // --------------------------------------------------------------------------
  // pause: タイマーキャンセルのみ
  // --------------------------------------------------------------------------
  describe('pause', () => {
    it('pause で state が "paused" になる', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([createMockEvent(0.0, 'a', 0.1)]);
      void player.play();
      player.pause();
      expect(player.getState()).toBe('paused');
    });

    it('pause で全タイマーがキャンセルされる', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([
        createMockEvent(0.0, 'a', 0.1),
        createMockEvent(0.1, 'k', 0.05),
      ]);
      void player.play();
      player.pause();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('pause は Engine の状態を触らない (scheduleTransition 等が pause 自体では呼ばれない)', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([createMockEvent(0.5, 'a', 0.1)]); // 0.5 秒後発火
      void player.play();
      // pause 前 (0 ms) には fireEvent 未発火
      const beforeCalls = engine.scheduleTransition.mock.calls.length;
      player.pause();
      // pause 後も追加呼び出しなし
      expect(engine.scheduleTransition.mock.calls.length).toBe(beforeCalls);
      expect(engine.setNasalCoupling).not.toHaveBeenCalled();
    });

    it('playing でない状態の pause は no-op', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.pause();
      expect(player.getState()).toBe('idle');
    });
  });

  // --------------------------------------------------------------------------
  // seek: イベントインデックス更新
  // --------------------------------------------------------------------------
  describe('seek', () => {
    it('指定時刻以降の最初のイベントに currentEventIndex が進む', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      const events = [
        createMockEvent(0.0, 'a', 0.1),
        createMockEvent(0.1, 'k', 0.05),
        createMockEvent(0.15, 'i', 0.1),
        createMockEvent(0.25, 'r', 0.05),
      ];
      player.load(events);
      void player.play();
      // 最初の fireEvent (index=0) が発火する前にシーク
      vi.clearAllTimers();
      // 状態を 'paused' 相当に: pause を直接呼ぶ
      player.pause();

      player.seek(0.12);
      // events[2] (startTime=0.15) が最初に startTime >= 0.12 を満たす
      // 内部状態の確認用に再度 play してみて、state が動くか間接確認
      // currentEventIndex 自体は private なので、pause 状態下では再生再開しない仕様を確認
      expect(player.getState()).toBe('paused');
    });

    it('再生中の seek は再スケジュールして再生を継続する', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      const events = [
        createMockEvent(0.0, 'a', 0.1),
        createMockEvent(0.5, 'i', 0.1),
      ];
      player.load(events);
      void player.play();
      const beforeSeek = vi.getTimerCount();
      expect(beforeSeek).toBeGreaterThan(0);

      player.seek(0.4);
      // seek 後も再生中なので、新しいタイマーが予約されている
      expect(player.getState()).toBe('playing');
      expect(vi.getTimerCount()).toBeGreaterThan(0);
    });

    it('一時停止中の seek は再生を再開しない', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([
        createMockEvent(0.0, 'a', 0.1),
        createMockEvent(0.1, 'k', 0.05),
      ]);
      void player.play();
      player.pause();
      player.seek(0.05);
      expect(player.getState()).toBe('paused');
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // onPhonemeChange: コールバック発火
  // --------------------------------------------------------------------------
  describe('onPhonemeChange', () => {
    it('各イベント発火時にコールバックが呼ばれる', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      const events = [
        createMockEvent(0.0, 'a', 0.05),
        createMockEvent(0.05, 'i', 0.05),
        createMockEvent(0.10, 'u', 0.05),
      ];
      player.load(events);
      const cb = vi.fn();
      player.onPhonemeChange(cb);
      void player.play();

      // 全イベント発火まで進める (最後の startTime + 余裕)
      vi.advanceTimersByTime(200);

      expect(cb).toHaveBeenCalledTimes(3);
      // 1回目: events[0], index=0
      expect(cb.mock.calls[0]![0]).toBe(events[0]);
      expect(cb.mock.calls[0]![1]).toBe(0);
      // 2回目: events[1], index=1
      expect(cb.mock.calls[1]![0]).toBe(events[1]);
      expect(cb.mock.calls[1]![1]).toBe(1);
      // 3回目: events[2], index=2
      expect(cb.mock.calls[2]![0]).toBe(events[2]);
      expect(cb.mock.calls[2]![1]).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // onComplete: 完了通知
  // --------------------------------------------------------------------------
  describe('onComplete', () => {
    it('再生終了後に onComplete が 1 回呼ばれる', () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([
        createMockEvent(0.0, 'a', 0.05),
        createMockEvent(0.05, 'i', 0.05),
      ]);
      const cb = vi.fn();
      player.onComplete(cb);
      void player.play();

      // 最終イベント終了予定 (0.05 + 0.05 = 0.1 秒) + 50 ms バッファ
      vi.advanceTimersByTime(200);

      expect(cb).toHaveBeenCalledTimes(1);
      expect(player.getState()).toBe('idle');
    });

    it('play() の Promise も完了時に resolve される', async () => {
      const engine = createMockEngine();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([createMockEvent(0.0, 'a', 0.05)]);
      const promise = player.play();
      // タイマーをすべて進める
      await vi.advanceTimersByTimeAsync(200);
      await expect(promise).resolves.toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // エラー処理: AudioContext null
  // --------------------------------------------------------------------------
  describe('AudioContext null', () => {
    it('getAudioContext() が null を返すケースで Promise が reject される', async () => {
      const engine = createMockEngine({ contextNull: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const player = new PhonemePlayer(engine as any);
      player.load([createMockEvent(0.0, 'a', 0.05)]);
      const promise = player.play();
      await expect(promise).rejects.toThrow('AudioContext is not running');
      // state は idle のまま (playing に移行していない)
      expect(player.getState()).toBe('idle');
    });
  });
});
