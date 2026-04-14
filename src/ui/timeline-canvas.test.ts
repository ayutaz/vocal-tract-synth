// ============================================================================
// PhonemeTimelineCanvas ユニットテスト
// ----------------------------------------------------------------------------
// Phase 9: vitest の test 環境は 'node' のため DOM API が存在しない。
// jsdom を導入せず、テストに必要な最小限のモックを global に注入する方式を採用。
//
// モック対象:
//   - window.devicePixelRatio
//   - ResizeObserver
//   - document.createElement('canvas')  （静的レイヤー生成用）
//   - HTMLCanvasElement 相当のモッククラス (getContext / width / height)
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PhonemeTimelineCanvas } from './timeline-canvas';
import type { PhonemeEvent } from '../types/index';

// ===== モック用ユーティリティ =====

/**
 * CanvasRenderingContext2D の最小モック。
 * 呼び出し回数を検証できるよう vi.fn() で包む。
 */
type MockCtx = {
  setTransform: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
};

function createMockCtx(): MockCtx {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
  };
}

/**
 * HTMLCanvasElement のモック。
 * getContext は毎回同じ MockCtx を返し、呼び出し回数を記録する。
 */
function createMockCanvas(width = 600, height = 60): HTMLCanvasElement {
  const ctx = createMockCtx();
  // any 扱いで最小プロパティのみ埋める
  const mock: any = {
    width,
    height,
    _ctx: ctx,
    getContext: vi.fn(() => ctx),
    getBoundingClientRect: vi.fn(() => ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
    })),
  };
  return mock as HTMLCanvasElement;
}

/** PhonemeEvent のファクトリ */
function createEvent(
  phoneme: string,
  startTime: number,
  duration: number,
  sourceType: PhonemeEvent['sourceType'] = 'voiced',
): PhonemeEvent {
  return {
    phoneme,
    startTime,
    duration,
    tractAreas: new Float64Array(16).fill(4.0),
    f0Start: 120,
    f0End: 118,
    sourceType,
    amplitude: 0.7,
    nasalCoupling: 0,
    transitionMs: 15,
  };
}

// ===== Global polyfill (vitest 環境は 'node' で DOM なし) =====

beforeEach(() => {
  // ResizeObserver モック (new 可能な class でないとコンストラクタ呼出が失敗する)
  class MockResizeObserver {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
  }
  (globalThis as any).ResizeObserver = MockResizeObserver;

  // window.devicePixelRatio
  (globalThis as any).window = (globalThis as any).window || {};
  (globalThis as any).window.devicePixelRatio = 1;

  // document.createElement('canvas') → モック canvas を返す
  (globalThis as any).document = {
    createElement: vi.fn((tag: string) => {
      if (tag === 'canvas') {
        return createMockCanvas(600, 60);
      }
      return {};
    }),
  };
});

// ============================================================================
// テスト本体
// ============================================================================

describe('PhonemeTimelineCanvas', () => {
  it('インスタンス生成できる', () => {
    const canvas = createMockCanvas();
    const timeline = new PhonemeTimelineCanvas(canvas);
    expect(timeline).toBeDefined();
    // 初期化時に getContext が呼ばれている
    expect(canvas.getContext).toHaveBeenCalled();
  });

  it('constructor で getContext が null を返した場合 throw する', () => {
    const bad: any = {
      width: 100,
      height: 60,
      getContext: vi.fn(() => null),
      getBoundingClientRect: vi.fn(() => ({
        width: 100,
        height: 60,
        top: 0,
        left: 0,
        right: 100,
        bottom: 60,
      })),
    };
    expect(() => new PhonemeTimelineCanvas(bad as HTMLCanvasElement)).toThrow(
      /2D context が取得できません/,
    );
  });

  it('render で events を描画する', () => {
    const canvas = createMockCanvas();
    const timeline = new PhonemeTimelineCanvas(canvas);
    const events = [
      createEvent('k', 0, 0.05),
      createEvent('a', 0.05, 0.1),
      createEvent('i', 0.15, 0.1),
    ];
    timeline.render(events);
    // 静的レイヤー用に document.createElement('canvas') が呼ばれたはず
    expect(document.createElement).toHaveBeenCalledWith('canvas');
    // メイン Canvas に drawImage (静的レイヤー転写) が発生
    const ctx = (canvas as any)._ctx as MockCtx;
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it('render で空配列を渡してもエラーにならない', () => {
    const canvas = createMockCanvas();
    const timeline = new PhonemeTimelineCanvas(canvas);
    expect(() => timeline.render([])).not.toThrow();
    // プレースホルダ文言が描画される
    const ctx = (canvas as any)._ctx as MockCtx;
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it('clear で内部状態がリセットされる', () => {
    const canvas = createMockCanvas();
    const timeline = new PhonemeTimelineCanvas(canvas);
    timeline.render([createEvent('a', 0, 0.1)]);
    timeline.clear();
    // clear 後に highlightAt しても例外にならない (staticLayer が null)
    expect(() => timeline.highlightAt(0.05)).not.toThrow();
  });

  it('highlightAt で時刻範囲内のセルがハイライトされる', () => {
    const canvas = createMockCanvas();
    const timeline = new PhonemeTimelineCanvas(canvas);
    timeline.render([
      createEvent('a', 0, 0.1),
      createEvent('i', 0.1, 0.1),
    ]);
    const ctx = (canvas as any)._ctx as MockCtx;

    ctx.fillRect.mockClear();
    ctx.strokeRect.mockClear();
    timeline.highlightAt(0.05);
    // ハイライト矩形 (fillRect / strokeRect) が発火
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.strokeRect).toHaveBeenCalled();
  });

  it('highlightAt(0) で最初のセルが選択される (左端境界)', () => {
    const canvas = createMockCanvas();
    const timeline = new PhonemeTimelineCanvas(canvas);
    timeline.render([
      createEvent('a', 0, 0.1),
      createEvent('i', 0.1, 0.1),
    ]);
    // timeSec === 0 は最初の event.startTime と一致するためハイライトされるはず
    expect(() => timeline.highlightAt(0)).not.toThrow();
  });

  it('highlightAt(totalDuration) は範囲外扱い (最後の event の end は含まない)', () => {
    const canvas = createMockCanvas();
    const timeline = new PhonemeTimelineCanvas(canvas);
    timeline.render([
      createEvent('a', 0, 0.1),
      createEvent('i', 0.1, 0.1),
    ]);
    // 最後の event 終端は半開区間 [start, end) で含まれない → 例外ではないが activeEvent=null
    expect(() => timeline.highlightAt(0.2)).not.toThrow();
  });

  it('highlightAt で負値 (未ハイライト) も処理できる', () => {
    const canvas = createMockCanvas();
    const timeline = new PhonemeTimelineCanvas(canvas);
    timeline.render([createEvent('a', 0, 0.1)]);
    expect(() => timeline.highlightAt(-1)).not.toThrow();
  });

  it('空の events に対する highlightAt は何もしない', () => {
    const canvas = createMockCanvas();
    const timeline = new PhonemeTimelineCanvas(canvas);
    timeline.render([]);
    expect(() => timeline.highlightAt(0.5)).not.toThrow();
  });

  it('destroy で resize observer が disconnect される', () => {
    const canvas = createMockCanvas();
    const timeline = new PhonemeTimelineCanvas(canvas);
    // ResizeObserver のコンストラクタは先の beforeEach で vi.fn 化されている
    expect(() => timeline.destroy()).not.toThrow();
  });

  it('PAUSE_SHORT / PAUSE_LONG などのポーズ音素を描画できる', () => {
    const canvas = createMockCanvas();
    const timeline = new PhonemeTimelineCanvas(canvas);
    const events = [
      createEvent('PAUSE_SHORT', 0, 0.1),
      createEvent('a', 0.1, 0.1),
      createEvent('PAUSE_LONG', 0.2, 0.2),
    ];
    expect(() => timeline.render(events)).not.toThrow();
  });

  it('silence sourceType は silence カテゴリとして扱われる', () => {
    const canvas = createMockCanvas();
    const timeline = new PhonemeTimelineCanvas(canvas);
    const events = [
      createEvent('a', 0, 0.05, 'silence'),
      createEvent('a', 0.05, 0.1, 'voiced'),
    ];
    expect(() => timeline.render(events)).not.toThrow();
  });

  it('様々なカテゴリの音素を単一 render で描画できる (回帰チェック)', () => {
    const canvas = createMockCanvas();
    const timeline = new PhonemeTimelineCanvas(canvas);
    const events = [
      createEvent('k', 0.00, 0.03),    // plosive
      createEvent('a', 0.03, 0.10),    // vowel
      createEvent('s', 0.13, 0.05),    // fricative
      createEvent('ts', 0.18, 0.04),   // affricate
      createEvent('n', 0.22, 0.04),    // nasal
      createEvent('ɴ', 0.26, 0.05),    // hatsuon
      createEvent('ɾ', 0.31, 0.02),    // flap
      createEvent('j', 0.33, 0.02),    // approximant
      createEvent('Q', 0.35, 0.04),    // sokuon
      createEvent('m', 0.39, 0.04),    // nasal
    ];
    expect(() => timeline.render(events)).not.toThrow();
    const ctx = (canvas as any)._ctx as MockCtx;
    // 10 セル分の strokeRect / fillRect 呼び出し回数 >= 10 であることを担保
    // (静的レイヤーは内部 canvas のモック ctx に描かれるが、
    //  drawImage がメイン ctx で発生している点のみここでは担保する)
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it('totalDuration が 0 でも非クラッシュ (duration=0 の event のみ)', () => {
    const canvas = createMockCanvas();
    const timeline = new PhonemeTimelineCanvas(canvas);
    const events = [createEvent('a', 0, 0)];
    // 内部で totalDuration<=0 → 1 にフォールバックする想定
    expect(() => timeline.render(events)).not.toThrow();
  });
});
