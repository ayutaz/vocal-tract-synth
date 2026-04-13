// ============================================================================
// GlottalSource (三角波パルス音源) のユニットテスト
// ----------------------------------------------------------------------------
// PHASE1-001 セクション4.3 で指定されたテストケース:
// - 位相各点での出力値
// - 閉鎖期での出力ゼロ
// ============================================================================

import { describe, it, expect } from 'vitest';
import { GlottalSource } from './glottal-source';
import { DEFAULT_OQ } from '../types/index';

describe('GlottalSource - 三角波パルス波形', () => {
  it('phase=0 で output=0', () => {
    const gs = new GlottalSource();
    expect(gs.generate(0)).toBeCloseTo(0, 5);
  });

  it('phase=OQ/2 で output=1（ピーク）', () => {
    const gs = new GlottalSource();
    expect(gs.generate(DEFAULT_OQ / 2)).toBeCloseTo(1, 5);
  });

  it('phase=OQ で output=0（開放相終了）', () => {
    const gs = new GlottalSource();
    // phase < OQ の境界なので分岐が変わる瞬間。OQ - 0.0001 で 0 付近
    expect(gs.generate(DEFAULT_OQ - 0.0001)).toBeCloseTo(0, 2);
  });

  it('phase=OQ 以上で output=0（閉鎖期）', () => {
    const gs = new GlottalSource();
    expect(gs.generate(DEFAULT_OQ)).toBe(0);
    expect(gs.generate(0.8)).toBe(0);
    expect(gs.generate(0.99)).toBe(0);
  });

  it('開放相では output >= 0', () => {
    const gs = new GlottalSource();
    for (let p = 0; p < DEFAULT_OQ; p += 0.01) {
      const v = gs.generate(p);
      expect(v).toBeGreaterThanOrEqual(-0.001);
      expect(v).toBeLessThanOrEqual(1.001);
    }
  });

  it('OQ 設定が反映される', () => {
    const gs = new GlottalSource();
    gs.setOpenQuotient(0.4);
    // phase=0.2 (= OQ/2) でピーク
    expect(gs.generate(0.2)).toBeCloseTo(1, 5);
    // phase=0.4 以上で閉鎖期
    expect(gs.generate(0.4)).toBe(0);
  });

  it('OQ は [0.01, 0.99] にクランプされる', () => {
    const gs = new GlottalSource();
    gs.setOpenQuotient(-1);
    // クランプされた OQ=0.01 で phase=0.005 (= OQ/2) がピーク
    expect(gs.generate(0.005)).toBeCloseTo(1, 3);

    gs.setOpenQuotient(2);
    // クランプされた OQ=0.99 で phase=0.495 (= OQ/2) がピーク
    expect(gs.generate(0.495)).toBeCloseTo(1, 3);
  });
});

describe('GlottalSource - reset', () => {
  it('reset してもエラーにならない', () => {
    const gs = new GlottalSource();
    gs.generate(0.1);
    expect(() => gs.reset()).not.toThrow();
  });
});
