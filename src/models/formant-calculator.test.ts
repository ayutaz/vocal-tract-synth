// ============================================================================
// フォルマント計算（伝達行列方式）のユニットテスト
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  calculateFormants,
  areasToReflectionCoeffs,
  reflectionToLpc,
} from './formant-calculator';
import { NUM_SECTIONS, MIN_AREA, MAX_AREA } from '../types/index';
import { TractEditor } from '../ui/tract-editor';
import { VOWEL_PRESETS } from './vowel-presets';
import { NUM_CONTROL_POINTS } from '../types/index';

// 16制御点 → 44区間 スプライン補間ヘルパ
function interpolatePreset(controlPoints: number[]): Float64Array {
  const xs = TractEditor.controlPointXs(NUM_CONTROL_POINTS, NUM_SECTIONS);
  const cp = new Float64Array(controlPoints);
  const m = TractEditor.computeNaturalSplineSecondDerivatives(xs, cp);
  const out = new Float64Array(NUM_SECTIONS);
  TractEditor.evaluateSplineAtSections(xs, cp, m, NUM_SECTIONS, out);
  for (let i = 0; i < NUM_SECTIONS; i++) {
    if (out[i]! < MIN_AREA) out[i] = MIN_AREA;
    if (out[i]! > MAX_AREA) out[i] = MAX_AREA;
  }
  return out;
}

describe('formant-calculator - 反射係数', () => {
  it('44区間から43個の反射係数を生成', () => {
    const areas = new Float64Array(NUM_SECTIONS).fill(4.0);
    const r = areasToReflectionCoeffs(areas);
    expect(r.length).toBe(NUM_SECTIONS - 1);
  });

  it('均一管では全反射係数が0', () => {
    const areas = new Float64Array(NUM_SECTIONS).fill(4.0);
    const r = areasToReflectionCoeffs(areas);
    for (let i = 0; i < r.length; i++) {
      expect(r[i]).toBeCloseTo(0, 10);
    }
  });

  it('全反射係数が |r| < 1', () => {
    for (const preset of VOWEL_PRESETS) {
      const areas = interpolatePreset(preset.controlPoints);
      const r = areasToReflectionCoeffs(areas);
      for (let i = 0; i < r.length; i++) {
        expect(Math.abs(r[i]!)).toBeLessThan(1);
        expect(Number.isFinite(r[i]!)).toBe(true);
      }
    }
  });
});

describe('formant-calculator - LPC変換', () => {
  it('step-up で正しい長さのLPC係数を生成', () => {
    const areas = new Float64Array(NUM_SECTIONS).fill(4.0);
    const r = areasToReflectionCoeffs(areas);
    const lpc = reflectionToLpc(r);
    // 43反射係数 → 44要素 LPC (a[0]=1, a[1]..a[43])
    expect(lpc.length).toBe(NUM_SECTIONS);
    expect(lpc[0]).toBeCloseTo(1, 10);
  });
});

describe('formant-calculator - フォルマント計算', () => {
  it('均一管のフォルマントが有限値', () => {
    const areas = new Float64Array(NUM_SECTIONS).fill(4.0);
    const result = calculateFormants(areas);
    expect(Number.isFinite(result.f1)).toBe(true);
    expect(Number.isFinite(result.f2)).toBe(true);
    expect(Number.isFinite(result.f3)).toBe(true);
    expect(result.f1).toBeGreaterThan(0);
    expect(result.f2).toBeGreaterThan(result.f1);
    expect(result.f3).toBeGreaterThan(result.f2);
  });

  it('全区間MIN_AREAでもNaN/Infinityにならない', () => {
    const areas = new Float64Array(NUM_SECTIONS).fill(MIN_AREA);
    const result = calculateFormants(areas);
    expect(Number.isFinite(result.f1)).toBe(true);
    expect(Number.isFinite(result.f2)).toBe(true);
  });

  it('全区間MAX_AREAでもNaN/Infinityにならない', () => {
    const areas = new Float64Array(NUM_SECTIONS).fill(MAX_AREA);
    const result = calculateFormants(areas);
    expect(Number.isFinite(result.f1)).toBe(true);
    expect(Number.isFinite(result.f2)).toBe(true);
  });
});

describe('formant-calculator - 5母音プリセットのフォルマント', () => {
  // 各母音プリセットのF1/F2が目標値±30%以内
  // 目標値は連結管伝達行列モデルの共鳴周波数に基づく
  const vowelTargets: [string, number, number][] = [
    ['a', 530, 1150],
    ['i', 220, 1900],
    ['u', 330, 750],
    ['e', 340, 1800],
    ['o', 390, 960],
  ];

  for (const [vowel, targetF1, targetF2] of vowelTargets) {
    it(`母音 /${vowel}/ のF1/F2が目標値±30%以内`, () => {
      const preset = VOWEL_PRESETS.find(p => p.id === vowel)!;
      const areas = interpolatePreset(preset.controlPoints);
      const result = calculateFormants(areas);

      expect(result.f1).toBeGreaterThan(targetF1 * 0.7);
      expect(result.f1).toBeLessThan(targetF1 * 1.3);
      expect(result.f2).toBeGreaterThan(targetF2 * 0.7);
      expect(result.f2).toBeLessThan(targetF2 * 1.3);
    });
  }
});

describe('formant-calculator - パフォーマンス', () => {
  it('フォルマント計算のp95が10ms以下', () => {
    const areas = new Float64Array(NUM_SECTIONS).fill(4.0);
    const times: number[] = [];
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      calculateFormants(areas);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    expect(p95).toBeLessThan(10);
  });
});
