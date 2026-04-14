// ============================================================================
// TextReadControls の単体テスト
// ----------------------------------------------------------------------------
// バグ修正: text-read-btn が engine 未起動でも押せる問題を防ぐため、
// isPlayable コールバックでボタン状態を制御する仕様を検証する。
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextReadControls } from './controls';

interface MockTextarea {
  value: string;
  disabled: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

interface MockButton {
  disabled: boolean;
  textContent: string;
  classList: { toggle: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

interface MockSlider {
  value: string;
  disabled: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

interface MockSpan {
  textContent: string;
}

function createMockTextarea(): MockTextarea {
  return {
    value: '',
    disabled: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

function createMockButton(): MockButton {
  return {
    disabled: false,
    textContent: '読み上げ',
    classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

function createMockSlider(value = '1.0'): MockSlider {
  return {
    value,
    disabled: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

function setup(opts?: {
  isPlayable?: () => boolean;
  initialText?: string;
}): {
  ctrl: TextReadControls;
  textarea: MockTextarea;
  btn: MockButton;
  slider: MockSlider;
  rateValue: MockSpan;
  onPlay: ReturnType<typeof vi.fn>;
  onStop: ReturnType<typeof vi.fn>;
} {
  const textarea = createMockTextarea();
  textarea.value = opts?.initialText ?? '';
  const btn = createMockButton();
  const slider = createMockSlider();
  const rateValue: MockSpan = { textContent: '' };
  const onPlay = vi.fn();
  const onStop = vi.fn();
  const ctrl = new TextReadControls(
    textarea as unknown as HTMLTextAreaElement,
    btn as unknown as HTMLButtonElement,
    slider as unknown as HTMLInputElement,
    rateValue as unknown as HTMLElement,
    onPlay,
    onStop,
    opts?.isPlayable,
  );
  return { ctrl, textarea, btn, slider, rateValue, onPlay, onStop };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TextReadControls - 初期状態', () => {
  it('初期はテキスト空でボタン無効', () => {
    const { btn } = setup();
    expect(btn.disabled).toBe(true);
  });

  it('rate ラベルが初期化される', () => {
    const { rateValue } = setup();
    expect(rateValue.textContent).toContain('1.0x');
  });
});

describe('TextReadControls - isPlayable コールバック (バグ修正)', () => {
  it('isPlayable=false ならテキスト入力済みでもボタン無効', () => {
    const { ctrl, btn } = setup({
      isPlayable: () => false,
      initialText: 'こんにちは',
    });
    ctrl.refreshButtonState();
    expect(btn.disabled).toBe(true);
  });

  it('isPlayable=true かつテキスト入力済みでボタン有効', () => {
    const { ctrl, btn } = setup({
      isPlayable: () => true,
      initialText: 'こんにちは',
    });
    ctrl.refreshButtonState();
    expect(btn.disabled).toBe(false);
  });

  it('isPlayable 未指定 (undefined) なら従来通り常に true 扱い', () => {
    const { ctrl, btn } = setup({ initialText: 'あ' });
    ctrl.refreshButtonState();
    expect(btn.disabled).toBe(false);
  });

  it('isPlayable が動的に変化する (engine.isRunning パターン)', () => {
    let running = false;
    const { ctrl, btn } = setup({
      isPlayable: () => running,
      initialText: 'あ',
    });
    ctrl.refreshButtonState();
    expect(btn.disabled).toBe(true);

    // engine 起動
    running = true;
    ctrl.refreshButtonState();
    expect(btn.disabled).toBe(false);

    // engine 停止
    running = false;
    ctrl.refreshButtonState();
    expect(btn.disabled).toBe(true);
  });
});

describe('TextReadControls - 再生中の挙動', () => {
  it('setPlaying(true) でラベルが「停止」に', () => {
    const { ctrl, btn } = setup({ isPlayable: () => true });
    ctrl.setPlaying(true);
    expect(btn.textContent).toBe('停止');
    expect(btn.disabled).toBe(false);
  });

  it('再生中は isPlayable=false でもボタン有効 (停止できる必要があるため)', () => {
    let running = false;
    const { ctrl, btn } = setup({ isPlayable: () => running });
    ctrl.setPlaying(true);
    expect(btn.disabled).toBe(false);
  });

  it('setPlaying(false) でラベル「読み上げ」に戻る', () => {
    const { ctrl, btn } = setup({ isPlayable: () => true, initialText: 'あ' });
    ctrl.setPlaying(true);
    ctrl.setPlaying(false);
    expect(btn.textContent).toBe('読み上げ');
  });
});

describe('TextReadControls - setEnabled', () => {
  it('setEnabled(false) でボタンとtextarea/sliderが無効化', () => {
    const { ctrl, btn, textarea, slider } = setup({
      isPlayable: () => true,
      initialText: 'あ',
    });
    ctrl.setEnabled(false);
    expect(textarea.disabled).toBe(true);
    expect(slider.disabled).toBe(true);
    expect(btn.disabled).toBe(true);
  });

  it('setEnabled(true) で再計算 (engine起動済み + テキストありなら有効)', () => {
    const { ctrl, btn, textarea } = setup({
      isPlayable: () => true,
      initialText: 'あ',
    });
    ctrl.setEnabled(false);
    ctrl.setEnabled(true);
    expect(textarea.disabled).toBe(false);
    expect(btn.disabled).toBe(false);
  });
});

describe('TextReadControls - getText / getRate', () => {
  it('getText で現在のテキストを返す', () => {
    const { ctrl } = setup({ initialText: 'こんにちは' });
    expect(ctrl.getText()).toBe('こんにちは');
  });

  it('getRate でスライダー値を数値で返す', () => {
    const { ctrl } = setup();
    expect(ctrl.getRate()).toBe(1.0);
  });
});
