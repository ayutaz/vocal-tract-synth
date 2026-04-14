// ============================================================================
// NasalTract (Kelly-Lochbaum 30 区間、固定断面積) のユニットテスト
// ----------------------------------------------------------------------------
// PHASE7-001 セクション 3.1 で指定されたテストケース:
// - 基本動作: processSample が有限値を返す
// - インパルス応答: 鼻咽腔端入力に対する鼻孔出力の伝搬
// - 長時間安定性: 数値発散なし
// - reset: 状態クリア
// - getPharyngealBackwardWave / getPharyngealArea: アクセサの正当性
// - 反射係数: |r[k]| < 1
// ============================================================================

import { describe, it, expect } from 'vitest';
import { NasalTract } from './nasal-tract';
import { NASAL_NUM_SECTIONS, SAMPLE_RATE } from '../types/index';

describe('NasalTract - 基本動作', () => {
  it('processSample は有限な数値を返す', () => {
    const nasal = new NasalTract();
    const result = nasal.processSample(0.5);
    expect(typeof result).toBe('number');
    expect(Number.isFinite(result)).toBe(true);
  });

  it('ゼロ入力で出力がゼロ', () => {
    const nasal = new NasalTract();
    // 初期状態（波動変数も prevNostrilInput もゼロ）でゼロ入力
    const out = nasal.processSample(0);
    expect(out).toBe(0);
  });

  it('初期状態でのインパルス応答が有限値の連続', () => {
    const nasal = new NasalTract();
    const n = 4096;
    const out = new Float64Array(n);
    out[0] = nasal.processSample(1.0);
    for (let i = 1; i < n; i++) {
      out[i] = nasal.processSample(0);
    }
    for (let i = 0; i < n; i++) {
      expect(Number.isFinite(out[i]!)).toBe(true);
    }
  });
});

describe('NasalTract - インパルス応答', () => {
  it('鼻咽腔端に 1.0 を入力すると、一定時間後に鼻孔出力が非ゼロになる', () => {
    const nasal = new NasalTract();

    // 初期状態で 1 サンプルだけ非ゼロ入力
    // 1 サンプル = 2 半ステップで波は 2 区間進むため、
    // N=30 区間の鼻咽腔端 → 鼻孔端への片道伝搬は 15 サンプル程度で到達する。
    // 十分長い観測時間 (512 サンプル ≒ 12ms) で非ゼロ出力を確認する。
    const observationLength = 512;
    const out = new Float64Array(observationLength);
    out[0] = nasal.processSample(1.0);
    for (let i = 1; i < observationLength; i++) {
      out[i] = nasal.processSample(0);
    }

    // 観測区間のうち少なくとも 1 サンプルは明らかに非ゼロ
    let maxAbs = 0;
    for (let i = 0; i < observationLength; i++) {
      const a = Math.abs(out[i]!);
      if (a > maxAbs) maxAbs = a;
    }
    expect(maxAbs).toBeGreaterThan(1e-6);
    // 発散もしていない
    expect(maxAbs).toBeLessThan(100);
  });

  it('インパルス応答の全サンプルが有限値', () => {
    const nasal = new NasalTract();
    const n = 2048;
    for (let i = 0; i < n; i++) {
      const input = i === 0 ? 1.0 : 0;
      const out = nasal.processSample(input);
      expect(Number.isFinite(out)).toBe(true);
    }
  });
});

describe('NasalTract - 長時間安定性', () => {
  it('1 秒相当 (44100 サンプル) のシミュレートで発散しない', () => {
    const nasal = new NasalTract();
    let maxAbs = 0;
    for (let i = 0; i < SAMPLE_RATE; i++) {
      // 正弦波入力（120 Hz）を鼻咽腔端に与える
      const input = Math.sin((2 * Math.PI * 120 * i) / SAMPLE_RATE);
      const out = nasal.processSample(input);
      if (!Number.isFinite(out)) {
        throw new Error(`サンプル ${i} で発散: ${out}`);
      }
      const a = Math.abs(out);
      if (a > maxAbs) maxAbs = a;
    }
    // 壁面損失 mu=0.999 が効いていれば定常状態でも発散しない
    expect(maxAbs).toBeLessThan(100);
  });

  it('ゼロ入力を継続すると出力が減衰する', () => {
    const nasal = new NasalTract();
    // 最初に 1.0 を打ち込んで波動を励起
    nasal.processSample(1.0);
    // その後ゼロ入力で十分長く回して、壁面損失による減衰を確認
    const longRun = SAMPLE_RATE; // 1 秒
    let finalMagnitude = 0;
    for (let i = 0; i < longRun; i++) {
      const out = nasal.processSample(0);
      expect(Number.isFinite(out)).toBe(true);
      finalMagnitude = Math.abs(out);
    }
    // 1 秒後には mu^44100 ≈ exp(-44) ≒ ~0 にまで減衰するはず
    expect(finalMagnitude).toBeLessThan(1e-3);
  });
});

describe('NasalTract - reset', () => {
  it('reset() 後にゼロ入力で出力がゼロになる', () => {
    const nasal = new NasalTract();
    // 何らかの励起
    for (let i = 0; i < 100; i++) {
      nasal.processSample(Math.sin(i * 0.1));
    }
    // reset 前の状態ではゼロ入力でもゼロ以外が返りうる
    nasal.reset();
    // reset 直後のゼロ入力は 0 を返すはず
    // (波動変数・prevNostrilInput すべてクリアされているため)
    const out = nasal.processSample(0);
    expect(out).toBe(0);
  });

  it('reset() 後のインパルス応答が初期状態と同じ', () => {
    const nasal = new NasalTract();

    // 1 回目のインパルス応答
    const n = 512;
    const first = new Float64Array(n);
    first[0] = nasal.processSample(1.0);
    for (let i = 1; i < n; i++) {
      first[i] = nasal.processSample(0);
    }

    // 適当に状態を汚す
    for (let i = 0; i < 500; i++) {
      nasal.processSample(Math.sin(i * 0.05));
    }

    nasal.reset();

    // 2 回目のインパルス応答
    const second = new Float64Array(n);
    second[0] = nasal.processSample(1.0);
    for (let i = 1; i < n; i++) {
      second[i] = nasal.processSample(0);
    }

    // 1 回目と 2 回目が一致する
    for (let i = 0; i < n; i++) {
      expect(second[i]!).toBeCloseTo(first[i]!, 12);
    }
  });
});

describe('NasalTract - アクセサ', () => {
  it('getPharyngealBackwardWave() が初期状態でゼロを返す', () => {
    const nasal = new NasalTract();
    expect(nasal.getPharyngealBackwardWave()).toBe(0);
  });

  it('getPharyngealArea() が断面積プロファイルの最終要素 (3.2 cm²) を返す', () => {
    const nasal = new NasalTract();
    // NASAL_AREA_PROFILE の最後の要素 = 鼻咽腔端の断面積
    expect(nasal.getPharyngealArea()).toBeCloseTo(3.2, 10);
  });

  it('getPharyngealBackwardWave() がサンプル処理後も有限値', () => {
    const nasal = new NasalTract();
    // インパルス注入後、後退波が励起されて有限値が返る
    nasal.processSample(1.0);
    for (let i = 0; i < 50; i++) {
      nasal.processSample(0);
    }
    const b = nasal.getPharyngealBackwardWave();
    expect(Number.isFinite(b)).toBe(true);
  });

  it('reset() 後は getPharyngealBackwardWave() がゼロに戻る', () => {
    const nasal = new NasalTract();
    for (let i = 0; i < 100; i++) {
      nasal.processSample(1.0);
    }
    nasal.reset();
    expect(nasal.getPharyngealBackwardWave()).toBe(0);
  });
});

describe('NasalTract - 反射係数', () => {
  it('全境界で |r[k]| < 1 (安定性条件)', () => {
    // NasalTract はコンストラクタで反射係数を確定するため、
    // 内部の反射係数を検証するには断面積プロファイルから直接計算するしかない。
    // ここでは NASAL_AREA_PROFILE と同じロジックを再計算して全て |r| < 1 を確認する。
    const profile: readonly number[] = [
      0.5, 0.7, 1.0, 1.4, 1.8, 2.2,
      2.5, 2.8, 3.0, 3.0, 2.9, 2.7, 2.5, 2.4, 2.3,
      2.1, 1.9, 1.7, 1.5, 1.4, 1.3, 1.3, 1.4, 1.5,
      1.8, 2.2, 2.5, 2.8, 3.0, 3.2,
    ];
    expect(profile.length).toBe(NASAL_NUM_SECTIONS);
    for (let k = 0; k < profile.length - 1; k++) {
      const a0 = profile[k]!;
      const a1 = profile[k + 1]!;
      const r = (a1 - a0) / (a1 + a0);
      expect(Math.abs(r)).toBeLessThan(1);
    }
  });

  it('NasalTract インスタンスが正しく構築される (暗黙的に反射係数計算が成功)', () => {
    // コンストラクタで updateReflectionCoefficients() を実行している。
    // 例外が出なければ全係数が有限値として計算できた証拠。
    expect(() => new NasalTract()).not.toThrow();
  });
});
