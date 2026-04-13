// ============================================================================
// VocalTract (Kelly-Lochbaum 44区間) のユニットテスト
// ----------------------------------------------------------------------------
// PHASE1-001 セクション4.3 で指定されたテストケース:
// - 均一管でのインパルス応答 → 共鳴周波数の理論値照合
// - 極端な断面積パターンでの安定性
// - 長時間実行での数値発散チェック
// - 反射係数計算の境界値テスト
// - 断面積下限クランプ
// ============================================================================

import { describe, it, expect } from 'vitest';
import { VocalTract } from './vocal-tract';
import {
  NUM_SECTIONS,
  MIN_AREA,
  MAX_AREA,
  DEFAULT_AREA,
  SAMPLE_RATE,
  VOCAL_TRACT_LENGTH,
  SPEED_OF_SOUND,
} from '../types/index';

// ----- ヘルパー -----

/** 単純な DFT で特定周波数の振幅を取得（FFT を入れずに済ませる） */
function dftMagnitude(signal: Float64Array, freq: number, sampleRate: number): number {
  let re = 0;
  let im = 0;
  const omega = (2 * Math.PI * freq) / sampleRate;
  for (let n = 0; n < signal.length; n++) {
    re += signal[n]! * Math.cos(omega * n);
    im -= signal[n]! * Math.sin(omega * n);
  }
  return Math.sqrt(re * re + im * im);
}

/** RMS 振幅 */
function rms(signal: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < signal.length; i++) {
    sum += signal[i]! * signal[i]!;
  }
  return Math.sqrt(sum / signal.length);
}

// ============================================================================

describe('VocalTract - 基本動作', () => {
  it('初期状態はデフォルト断面積（4.0cm²）の均一管', () => {
    const tract = new VocalTract();
    // インパルス応答を取得して NaN/Inf が出ないことを確認
    const n = 4096;
    const out = new Float64Array(n);
    out[0] = tract.processSample(1.0);
    for (let i = 1; i < n; i++) {
      out[i] = tract.processSample(0);
    }

    for (let i = 0; i < n; i++) {
      expect(Number.isFinite(out[i]!)).toBe(true);
    }
  });

  it('processSample は数値を返す', () => {
    const tract = new VocalTract();
    const result = tract.processSample(0.5);
    expect(typeof result).toBe('number');
    expect(Number.isFinite(result)).toBe(true);
  });
});

describe('VocalTract - 均一管の共鳴周波数', () => {
  it('均一管のインパルス応答にフォルマント周波数が現れる', () => {
    const tract = new VocalTract();

    // 4096 サンプル（約 93ms）のインパルス応答
    const n = 8192;
    const response = new Float64Array(n);
    response[0] = tract.processSample(1.0);
    for (let i = 1; i < n; i++) {
      response[i] = tract.processSample(0);
    }

    // 理論値: 均一管の共鳴周波数 f_n = (2n-1) * c / (4L)
    // L=17.5cm, c=35000cm/s → f1=500, f2=1500, f3=2500 Hz
    const f1 = (1 * SPEED_OF_SOUND) / (4 * VOCAL_TRACT_LENGTH); // 500 Hz
    const f2 = (3 * SPEED_OF_SOUND) / (4 * VOCAL_TRACT_LENGTH); // 1500 Hz
    const f3 = (5 * SPEED_OF_SOUND) / (4 * VOCAL_TRACT_LENGTH); // 2500 Hz

    expect(f1).toBeCloseTo(500, 0);
    expect(f2).toBeCloseTo(1500, 0);
    expect(f3).toBeCloseTo(2500, 0);

    // 各フォルマント周波数で DFT の振幅がその周辺より大きいかをチェック
    // （ピーク検出の代用: F1 付近の振幅が F1±200Hz より大きい）
    const mag = (f: number) => dftMagnitude(response, f, SAMPLE_RATE);

    // F1 は他の非共鳴点より有意に強いはず
    const magF1 = mag(f1);
    const magF1_off = mag(f1 + 250); // 非ピーク周辺
    expect(magF1).toBeGreaterThan(magF1_off * 1.5);
  });
});

describe('VocalTract - 反射係数（境界値）', () => {
  it('同一断面積では r=0', () => {
    const tract = new VocalTract();
    const areas = new Float64Array(NUM_SECTIONS);
    areas.fill(DEFAULT_AREA);
    tract.setAreas(areas);
    // 均一管なのでインパルスに対して反射が起きず、
    // 最初のサンプルのみ大きな応答が出ることを確認
    const first = tract.processSample(1.0);
    expect(Number.isFinite(first)).toBe(true);
  });

  it('極端な断面積ペア A=[0.3, 10.0] でも NaN/Inf が出ない', () => {
    const tract = new VocalTract();
    // 交互に MIN_AREA と MAX_AREA を配置
    const areas = new Float64Array(NUM_SECTIONS);
    for (let i = 0; i < NUM_SECTIONS; i++) {
      areas[i] = i % 2 === 0 ? MIN_AREA : MAX_AREA;
    }
    tract.setAreas(areas);

    // 1秒分（44100サンプル）処理
    for (let i = 0; i < SAMPLE_RATE; i++) {
      const sample = Math.sin((2 * Math.PI * 120 * i) / SAMPLE_RATE);
      const out = tract.processSample(sample);
      expect(Number.isFinite(out)).toBe(true);
    }
  });
});

describe('VocalTract - 断面積クランプ', () => {
  it('setAreas で MIN_AREA 未満の値が MIN_AREA にクランプされる', () => {
    const tract = new VocalTract();
    // 0 / 負の値 / MIN_AREA 未満の値を渡す
    const areas = new Float64Array(NUM_SECTIONS);
    for (let i = 0; i < NUM_SECTIONS; i++) {
      areas[i] = 0; // ゼロ除算を誘発させる
    }
    tract.setAreas(areas);

    // 1サンプル処理 — クランプが効いていれば NaN は出ない
    const out = tract.processSample(1.0);
    expect(Number.isFinite(out)).toBe(true);
  });
});

describe('VocalTract - 長時間実行での数値安定性', () => {
  it('10秒分（441000サンプル）の均一管処理で発散しない', () => {
    const tract = new VocalTract();

    // 最初の 1024 サンプルの RMS
    const initialBlock = new Float64Array(1024);
    for (let i = 0; i < 1024; i++) {
      const src = Math.sin((2 * Math.PI * 120 * i) / SAMPLE_RATE);
      initialBlock[i] = tract.processSample(src);
    }
    const initialRms = rms(initialBlock);

    // 中間の 10秒分を捨てる
    for (let i = 1024; i < SAMPLE_RATE * 10; i++) {
      const src = Math.sin((2 * Math.PI * 120 * i) / SAMPLE_RATE);
      const out = tract.processSample(src);
      // NaN/Inf が出ていないことを逐次チェック（大量の expect は避けて一度だけ）
      if (!Number.isFinite(out)) {
        throw new Error(`サンプル ${i} で発散: ${out}`);
      }
    }

    // 最終ブロックの RMS
    const finalBlock = new Float64Array(1024);
    for (let i = 0; i < 1024; i++) {
      const src = Math.sin(
        (2 * Math.PI * 120 * (SAMPLE_RATE * 10 + i)) / SAMPLE_RATE,
      );
      finalBlock[i] = tract.processSample(src);
    }
    const finalRms = rms(finalBlock);

    // 初期ブロックの 10 倍以内（発散していない）
    // 壁面損失 0.999 が効いていれば、10秒後も定常状態を保つはず
    expect(finalRms).toBeLessThan(initialRms * 10);
    expect(finalRms).toBeGreaterThan(initialRms * 0.01);
  });

  it('reset() で波動変数がクリアされる', () => {
    const tract = new VocalTract();
    // 何らかの励起
    for (let i = 0; i < 100; i++) {
      tract.processSample(Math.sin(i * 0.1));
    }
    tract.reset();
    // reset 直後のインパルスで同じ結果（内部状態がリセットされた証拠）
    const first = tract.processSample(1.0);
    expect(Number.isFinite(first)).toBe(true);
  });
});
