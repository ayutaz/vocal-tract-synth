// ============================================================================
// 子音プリセット (Phase 6) のユニットテスト
// ============================================================================

import { describe, it, expect } from 'vitest';
import { CONSONANT_PRESETS, getConsonantPreset, getAllConsonantIds } from './consonant-presets';
import { MIN_AREA_PROGRAM, MAX_AREA, NUM_SECTIONS } from '../types/index';
import type { ConsonantId } from '../types/index';

describe('consonant-presets - 全19音素の妥当性', () => {
  const allIds: ConsonantId[] = [
    's', 'sh', 'h', 'hi', 'fu', 'z',
    'k', 't', 'p', 'g', 'd', 'b',
    'tsh', 'ts', 'dzh', 'dz',
    'r', 'j', 'w',
  ];

  it('getAllConsonantIds() が19音素すべてを返す', () => {
    const ids = getAllConsonantIds();
    expect(ids.length).toBe(19);
    for (const id of allIds) {
      expect(ids).toContain(id);
    }
  });

  it('全プリセットが定義されている', () => {
    for (const id of allIds) {
      expect(CONSONANT_PRESETS[id]).toBeDefined();
      expect(CONSONANT_PRESETS[id]!.id).toBe(id);
    }
  });

  it('getConsonantPreset() が正しいプリセットを返す', () => {
    for (const id of allIds) {
      const preset = getConsonantPreset(id);
      expect(preset).toBeDefined();
      expect(preset!.id).toBe(id);
    }
  });
});

describe('consonant-presets - 境界値検証', () => {
  it('constrictionRange が 44区間の範囲内か -1 (無効)', () => {
    for (const id of getAllConsonantIds()) {
      const preset = getConsonantPreset(id)!;
      const { start, end } = preset.constrictionRange;
      if (start >= 0) {
        // 有効な範囲: 0 <= start <= end < NUM_SECTIONS
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThanOrEqual(start);
        expect(end).toBeLessThan(NUM_SECTIONS);
      } else {
        // 無効化 (声門 /h/ 等): start=end=-1
        expect(end).toBeLessThan(0);
      }
    }
  });

  it('constrictionArea が [MIN_AREA_PROGRAM, MAX_AREA] の範囲内', () => {
    for (const id of getAllConsonantIds()) {
      const preset = getConsonantPreset(id)!;
      expect(preset.constrictionArea).toBeGreaterThanOrEqual(MIN_AREA_PROGRAM);
      expect(preset.constrictionArea).toBeLessThanOrEqual(MAX_AREA);
    }
  });

  it('ノイズパラメータが妥当範囲内', () => {
    for (const id of getAllConsonantIds()) {
      const preset = getConsonantPreset(id)!;
      if (preset.noise) {
        expect(preset.noise.centerFreq).toBeGreaterThan(0);
        expect(preset.noise.centerFreq).toBeLessThan(22050); // Nyquist以下
        expect(preset.noise.bandwidth).toBeGreaterThan(0);
        expect(preset.noise.gain).toBeGreaterThan(0);
        expect(preset.noise.gain).toBeLessThanOrEqual(1.0);
      }
    }
  });
});

describe('consonant-presets - カテゴリと VOT', () => {
  it('破裂音は closureMs/burstMs/vot を持つ', () => {
    const plosives: ConsonantId[] = ['k', 't', 'p', 'g', 'd', 'b'];
    for (const id of plosives) {
      const preset = getConsonantPreset(id)!;
      expect(preset.category).toBe('plosive');
      expect(preset.closureMs).toBeGreaterThan(0);
      expect(preset.burstMs).toBeGreaterThan(0);
      expect(preset.vot).toBeDefined();
    }
  });

  it('有声破裂音 (g/d/b) は VOT < 0', () => {
    expect(getConsonantPreset('g')!.vot).toBeLessThan(0);
    expect(getConsonantPreset('d')!.vot).toBeLessThan(0);
    expect(getConsonantPreset('b')!.vot).toBeLessThan(0);
  });

  it('無声破裂音 (k/t/p) は VOT > 0', () => {
    expect(getConsonantPreset('k')!.vot).toBeGreaterThan(0);
    expect(getConsonantPreset('t')!.vot).toBeGreaterThan(0);
    expect(getConsonantPreset('p')!.vot).toBeGreaterThan(0);
  });

  it('摩擦音は frictionMs を持つ', () => {
    const fricatives: ConsonantId[] = ['s', 'sh', 'hi', 'fu', 'z'];
    for (const id of fricatives) {
      const preset = getConsonantPreset(id)!;
      expect(preset.category).toBe('fricative');
      expect(preset.frictionMs).toBeGreaterThan(0);
    }
  });

  it('破擦音は closureMs + frictionMs を持つ', () => {
    const affricates: ConsonantId[] = ['tsh', 'ts', 'dzh', 'dz'];
    for (const id of affricates) {
      const preset = getConsonantPreset(id)!;
      expect(preset.category).toBe('affricate');
      expect(preset.closureMs).toBeGreaterThan(0);
      expect(preset.frictionMs).toBeGreaterThan(0);
    }
  });

  it('有声/無声 voiced フラグが正しい', () => {
    expect(getConsonantPreset('k')!.voiced).toBe(false);
    expect(getConsonantPreset('g')!.voiced).toBe(true);
    expect(getConsonantPreset('s')!.voiced).toBe(false);
    expect(getConsonantPreset('z')!.voiced).toBe(true);
    expect(getConsonantPreset('r')!.voiced).toBe(true); // 弾音は有声
    expect(getConsonantPreset('j')!.voiced).toBe(true); // 半母音は有声
  });
});

describe('consonant-presets - 調音位置の区別', () => {
  // Phase 6 レビュー対応: index=0 が唇側、index=43 が声門側。
  // 解剖学的に、唇→軟口蓋 で index が増加する。
  it('両唇音は範囲が唇側 (idx <= 3)', () => {
    // /p/, /b/, /fu/, /w/
    const bilabialIds: ConsonantId[] = ['p', 'b', 'fu'];
    for (const id of bilabialIds) {
      const preset = getConsonantPreset(id)!;
      expect(preset.constrictionRange.start).toBeLessThanOrEqual(3);
    }
  });

  it('歯茎音は範囲が唇寄り中央 (idx 3-7)', () => {
    // /t/, /d/, /s/, /z/, /ts/, /dz/
    const alveolarIds: ConsonantId[] = ['t', 'd', 's', 'z', 'ts', 'dz'];
    for (const id of alveolarIds) {
      const preset = getConsonantPreset(id)!;
      expect(preset.constrictionRange.start).toBeGreaterThanOrEqual(3);
      expect(preset.constrictionRange.start).toBeLessThanOrEqual(7);
    }
  });

  it('軟口蓋音は範囲が声門寄り (idx >= 20)', () => {
    // /k/, /g/
    expect(getConsonantPreset('k')!.constrictionRange.start).toBeGreaterThanOrEqual(20);
    expect(getConsonantPreset('g')!.constrictionRange.start).toBeGreaterThanOrEqual(20);
  });

  it('破裂音の閉鎖面積は MIN_AREA_PROGRAM (0.01) 近傍', () => {
    const plosives: ConsonantId[] = ['k', 't', 'p', 'g', 'd', 'b'];
    for (const id of plosives) {
      const preset = getConsonantPreset(id)!;
      expect(preset.constrictionArea).toBeLessThanOrEqual(0.05);
    }
  });

  it('摩擦音の狭窄面積は閉鎖より広い (0.1-0.3 cm²)', () => {
    const fricatives: ConsonantId[] = ['s', 'sh', 'hi', 'fu', 'z'];
    for (const id of fricatives) {
      const preset = getConsonantPreset(id)!;
      expect(preset.constrictionArea).toBeGreaterThan(0.05);
      expect(preset.constrictionArea).toBeLessThan(0.5);
    }
  });
});
