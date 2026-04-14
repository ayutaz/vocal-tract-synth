// ============================================================================
// OperationModeManager ユニットテスト (Phase 9)
// ----------------------------------------------------------------------------
// 3 値状態機械の全遷移パスをカバーする。
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { OperationModeManager } from './operation-mode';

describe('OperationModeManager', () => {
  it('初期モードは manual', () => {
    const m = new OperationModeManager();
    expect(m.getMode()).toBe('manual');
  });

  it('manual → autoSing 遷移可能', () => {
    const m = new OperationModeManager();
    m.setMode('autoSing');
    expect(m.getMode()).toBe('autoSing');
  });

  it('manual → textRead 遷移可能', () => {
    const m = new OperationModeManager();
    m.setMode('textRead');
    expect(m.getMode()).toBe('textRead');
  });

  it('autoSing → manual 遷移可能', () => {
    const m = new OperationModeManager();
    m.setMode('autoSing');
    m.setMode('manual');
    expect(m.getMode()).toBe('manual');
  });

  it('textRead → manual 遷移可能', () => {
    const m = new OperationModeManager();
    m.setMode('textRead');
    m.setMode('manual');
    expect(m.getMode()).toBe('manual');
  });

  it('autoSing → textRead 直接遷移は禁止', () => {
    const m = new OperationModeManager();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    m.setMode('autoSing');
    m.setMode('textRead');
    expect(m.getMode()).toBe('autoSing'); // 変更されない
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('textRead → autoSing 直接遷移は禁止', () => {
    const m = new OperationModeManager();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    m.setMode('textRead');
    m.setMode('autoSing');
    expect(m.getMode()).toBe('textRead');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('同一モードへの遷移は no-op', () => {
    const m = new OperationModeManager();
    const cb = vi.fn();
    m.onChange(cb);
    m.setMode('manual');
    expect(cb).not.toHaveBeenCalled();
  });

  it('onChange コールバックが呼ばれる', () => {
    const m = new OperationModeManager();
    const cb = vi.fn();
    m.onChange(cb);
    m.setMode('autoSing');
    expect(cb).toHaveBeenCalledWith('autoSing', 'manual');
    m.setMode('manual');
    expect(cb).toHaveBeenCalledWith('manual', 'autoSing');
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('複数コールバックが全て呼ばれる', () => {
    const m = new OperationModeManager();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    m.onChange(cb1);
    m.onChange(cb2);
    m.setMode('textRead');
    expect(cb1).toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
  });

  it('canTransitionTo の戻り値', () => {
    const m = new OperationModeManager();
    expect(m.canTransitionTo('manual')).toBe(true);
    expect(m.canTransitionTo('autoSing')).toBe(true);
    expect(m.canTransitionTo('textRead')).toBe(true);

    m.setMode('autoSing');
    expect(m.canTransitionTo('manual')).toBe(true);
    expect(m.canTransitionTo('textRead')).toBe(false);

    m.setMode('manual');
    m.setMode('textRead');
    expect(m.canTransitionTo('manual')).toBe(true);
    expect(m.canTransitionTo('autoSing')).toBe(false);
  });

  it('destroy で全コールバック解除', () => {
    const m = new OperationModeManager();
    const cb = vi.fn();
    m.onChange(cb);
    m.destroy();
    m.setMode('autoSing');
    expect(cb).not.toHaveBeenCalled();
  });
});
