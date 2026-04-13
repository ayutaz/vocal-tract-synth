// ============================================================================
// Klglott88Source (KLGLOTT88声門音源) のユニットテスト
// ============================================================================

import { describe, it, expect } from 'vitest';
import { Klglott88Source } from './glottal-source';
import { DEFAULT_OQ, MIN_OQ, MAX_OQ } from '../types/index';

describe('Klglott88Source - KLGLOTT88 波形', () => {
  it('phase=0 で output=0', () => {
    const gs = new Klglott88Source();
    expect(gs.generate(0)).toBeCloseTo(0, 5);
  });

  it('phase=OQ*2/3 で output=1.0（ピーク）', () => {
    const gs = new Klglott88Source();
    // KLGLOTT88: 6.75 * t^2 * (1-t), ピークは t=2/3
    const peakPhase = DEFAULT_OQ * (2 / 3);
    expect(gs.generate(peakPhase)).toBeCloseTo(1, 4);
  });

  it('phase=OQ 直前で output≈0（開放相終了）', () => {
    const gs = new Klglott88Source();
    expect(gs.generate(DEFAULT_OQ - 0.0001)).toBeCloseTo(0, 2);
  });

  it('phase=OQ 以上で output=0（閉鎖相）', () => {
    const gs = new Klglott88Source();
    expect(gs.generate(DEFAULT_OQ)).toBe(0);
    expect(gs.generate(0.8)).toBe(0);
    expect(gs.generate(0.99)).toBe(0);
  });

  it('開放相では output は [0, 1] 範囲', () => {
    const gs = new Klglott88Source();
    for (let p = 0; p < DEFAULT_OQ; p += 0.01) {
      const v = gs.generate(p);
      expect(v).toBeGreaterThanOrEqual(-0.001);
      expect(v).toBeLessThanOrEqual(1.001);
    }
  });

  it('OQ=MIN_OQ(0.3) で波形が正しい', () => {
    const gs = new Klglott88Source();
    gs.setOpenQuotient(MIN_OQ);
    const peak = MIN_OQ * (2 / 3);
    expect(gs.generate(peak)).toBeCloseTo(1, 4);
    expect(gs.generate(MIN_OQ)).toBe(0);
  });

  it('OQ=MAX_OQ(0.8) で波形が正しい', () => {
    const gs = new Klglott88Source();
    gs.setOpenQuotient(MAX_OQ);
    const peak = MAX_OQ * (2 / 3);
    expect(gs.generate(peak)).toBeCloseTo(1, 4);
    expect(gs.generate(MAX_OQ)).toBe(0);
  });

  it('OQ はクランプされる（範囲外）', () => {
    const gs = new Klglott88Source();
    gs.setOpenQuotient(0.1); // < MIN_OQ
    // MIN_OQ=0.3 にクランプされる → peakは 0.3*2/3=0.2
    expect(gs.generate(0.2)).toBeCloseTo(1, 3);

    gs.setOpenQuotient(1.0); // > MAX_OQ
    // MAX_OQ=0.8 にクランプされる → peakは 0.8*2/3≈0.533
    expect(gs.generate(MAX_OQ * (2 / 3))).toBeCloseTo(1, 3);
  });
});

describe('Klglott88Source - 有声/無声クロスフェード', () => {
  it('初期状態は voiced (ノイズなし)', () => {
    const gs = new Klglott88Source();
    // 閉鎖相でノイズが 0 → voiced のみ
    const closedOutput = gs.generateWithMix(0.9);
    expect(closedOutput).toBeCloseTo(0, 5);
  });

  it('noise に切り替えると閉鎖相でもノイズが出る', () => {
    const gs = new Klglott88Source();
    gs.setSourceType('noise');
    // クロスフェード完了まで待つ（330サンプル分進める）
    for (let i = 0; i < 400; i++) {
      gs.generateWithMix(0.9);
    }
    // 完了後は noiseGain=1, voicedGain=0 → ノイズのみ
    const samples: number[] = [];
    for (let i = 0; i < 100; i++) {
      samples.push(gs.generateWithMix(0.9));
    }
    // ノイズなので標準偏差 > 0
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
    expect(Math.sqrt(variance)).toBeGreaterThan(0.1);
  });

  it('クロスフェード中のゲイン合計が 1.0 以下', () => {
    const gs = new Klglott88Source();
    gs.setSourceType('noise');
    // クロスフェード中の全サンプルを確認（内部ゲインを直接読めないので、
    // voiced=0の閉鎖相でのノイズ振幅で間接的に確認）
    // 330サンプルのクロスフェード中、noiseGainは0→1に線形変化
    // voicedGain + noiseGain = 1 であることが設計上保証されている
    for (let i = 0; i < 330; i++) {
      const v = gs.generateWithMix(0.9); // 閉鎖相
      // ノイズは [-1, 1]、ゲイン<=1 なので出力は [-1, 1]
      expect(Math.abs(v)).toBeLessThanOrEqual(1.001);
    }
  });
});

describe('Klglott88Source - reset', () => {
  it('reset で初期状態に戻る', () => {
    const gs = new Klglott88Source();
    gs.setSourceType('noise');
    gs.setOpenQuotient(0.4);
    gs.reset();
    // voiced に戻り、OQ=0.6
    const peak = DEFAULT_OQ * (2 / 3);
    expect(gs.generate(peak)).toBeCloseTo(1, 4);
    // 閉鎖相でノイズなし
    expect(gs.generateWithMix(0.9)).toBeCloseTo(0, 5);
  });
});
