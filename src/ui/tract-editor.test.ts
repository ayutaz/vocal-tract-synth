// ============================================================================
// TractEditor スプライン補間ロジックのユニットテスト
// ----------------------------------------------------------------------------
// Canvas 描画やイベント処理は DOM 依存で単体テスト困難なため、
// static な補間ロジックのみをテスト対象とする。
//
// PHASE1-001 セクション4.3 で指定されたテストケース:
// - 全制御点が同一値 → 全44区間が同値
// - 線形勾配 → 補間結果が単調増加
// - MIN_AREA/MAX_AREA の境界値
// - 制御点の位置では補間値が制御点値と一致
// ============================================================================

import { describe, it, expect } from 'vitest';
import { TractEditor } from './tract-editor';
import {
  NUM_SECTIONS,
  NUM_CONTROL_POINTS,
  MIN_AREA,
  MAX_AREA,
} from '../types/index';

/** 補間の一連処理を static メソッドから実行するヘルパ */
function interpolate(controlPoints: Float64Array): Float64Array {
  const xs = TractEditor.controlPointXs(NUM_CONTROL_POINTS, NUM_SECTIONS);
  const m = TractEditor.computeNaturalSplineSecondDerivatives(
    xs,
    controlPoints,
  );
  const out = new Float64Array(NUM_SECTIONS);
  TractEditor.evaluateSplineAtSections(
    xs,
    controlPoints,
    m,
    NUM_SECTIONS,
    out,
  );
  return out;
}

describe('TractEditor - スプライン補間', () => {
  it('制御点の x座標は等間隔', () => {
    const xs = TractEditor.controlPointXs(NUM_CONTROL_POINTS, NUM_SECTIONS);
    expect(xs.length).toBe(NUM_CONTROL_POINTS);
    expect(xs[0]).toBeCloseTo(0, 6);
    expect(xs[NUM_CONTROL_POINTS - 1]).toBeCloseTo(NUM_SECTIONS - 1, 6);
    // 隣接差が全て等しい
    const step = xs[1]! - xs[0]!;
    for (let i = 1; i < NUM_CONTROL_POINTS - 1; i++) {
      expect(xs[i + 1]! - xs[i]!).toBeCloseTo(step, 6);
    }
  });

  it('全制御点が 4.0 → 全44区間が 4.0', () => {
    const cp = new Float64Array(NUM_CONTROL_POINTS);
    cp.fill(4.0);
    const result = interpolate(cp);
    for (let i = 0; i < NUM_SECTIONS; i++) {
      expect(result[i]).toBeCloseTo(4.0, 6);
    }
  });

  it('全制御点が MIN_AREA → 全44区間が MIN_AREA', () => {
    const cp = new Float64Array(NUM_CONTROL_POINTS);
    cp.fill(MIN_AREA);
    const result = interpolate(cp);
    for (let i = 0; i < NUM_SECTIONS; i++) {
      expect(result[i]).toBeCloseTo(MIN_AREA, 6);
    }
  });

  it('全制御点が MAX_AREA → 全44区間が MAX_AREA', () => {
    const cp = new Float64Array(NUM_CONTROL_POINTS);
    cp.fill(MAX_AREA);
    const result = interpolate(cp);
    for (let i = 0; i < NUM_SECTIONS; i++) {
      expect(result[i]).toBeCloseTo(MAX_AREA, 6);
    }
  });

  it('線形勾配 (1.0 → 10.0) → 補間結果が単調増加', () => {
    const cp = new Float64Array(NUM_CONTROL_POINTS);
    for (let i = 0; i < NUM_CONTROL_POINTS; i++) {
      cp[i] = 1.0 + (9.0 * i) / (NUM_CONTROL_POINTS - 1);
    }
    const result = interpolate(cp);

    // 単調増加（等値もok、数値誤差を考慮）
    for (let i = 1; i < NUM_SECTIONS; i++) {
      expect(result[i]! + 1e-9).toBeGreaterThanOrEqual(result[i - 1]!);
    }

    // 両端が制御点値と一致
    expect(result[0]).toBeCloseTo(1.0, 6);
    expect(result[NUM_SECTIONS - 1]).toBeCloseTo(10.0, 6);
  });

  it('制御点の位置では補間値が制御点値と一致', () => {
    const cp = new Float64Array(NUM_CONTROL_POINTS);
    // ランダムっぽいパターン（固定シード）
    for (let i = 0; i < NUM_CONTROL_POINTS; i++) {
      cp[i] = 1.0 + (i * 7) % 9;
    }
    const xs = TractEditor.controlPointXs(NUM_CONTROL_POINTS, NUM_SECTIONS);
    const result = interpolate(cp);

    // x座標が整数（かつ 0..NUM_SECTIONS-1 範囲内）の制御点についてのみ一致確認
    // 16 制御点 → 44 区間では (NUM_SECTIONS-1)/(NUM_CONTROL_POINTS-1) = 43/15 ≈ 2.867
    // 整数にはならないので、端点 (i=0 と i=NUM_CONTROL_POINTS-1) のみ厳密一致する。
    expect(result[0]).toBeCloseTo(cp[0]!, 6);
    expect(result[NUM_SECTIONS - 1]).toBeCloseTo(
      cp[NUM_CONTROL_POINTS - 1]!,
      6,
    );
    expect(xs[0]).toBe(0);
    expect(xs[NUM_CONTROL_POINTS - 1]).toBeCloseTo(NUM_SECTIONS - 1, 6);
  });

  it('スプラインが全制御点を通過する（内部点含む）', () => {
    // スプラインの最も重要な不変条件: S(xs[i]) = ys[i] for all i
    // evaluateSplineAtSections は整数格子上でしか評価しないため、
    // 制御点位置 xs[i] が非整数になる場合は直接スプライン式で評価する。
    const cp = new Float64Array(NUM_CONTROL_POINTS);
    for (let i = 0; i < NUM_CONTROL_POINTS; i++) {
      cp[i] = 1.5 + (i * 7) % 8; // 1.5〜9.5 の範囲
    }
    const xs = TractEditor.controlPointXs(NUM_CONTROL_POINTS, NUM_SECTIONS);
    const m = TractEditor.computeNaturalSplineSecondDerivatives(xs, cp);

    // 各制御点 xs[i] でスプライン値を直接評価し、cp[i] と一致するか確認
    for (let i = 0; i < NUM_CONTROL_POINTS; i++) {
      const x = xs[i]!;
      const expected = cp[i]!;

      // xs[i] が属する区間 seg を見つける
      let seg = 0;
      for (let s = 0; s < NUM_CONTROL_POINTS - 2; s++) {
        if (x > xs[s + 1]!) seg = s + 1;
      }

      const x0 = xs[seg]!;
      const x1 = xs[seg + 1]!;
      const y0 = cp[seg]!;
      const y1 = cp[seg + 1]!;
      const m0 = m[seg]!;
      const m1 = m[seg + 1]!;
      const h = x1 - x0;

      const a = x1 - x;
      const b = x - x0;
      const value =
        (m0 * a * a * a) / (6 * h) +
        (m1 * b * b * b) / (6 * h) +
        (y0 / h - (m0 * h) / 6) * a +
        (y1 / h - (m1 * h) / 6) * b;

      expect(value).toBeCloseTo(expected, 4);
    }
  });
});
