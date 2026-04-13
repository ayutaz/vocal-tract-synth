// ============================================================================
// エントリポイント — 各モジュールの結線
// ----------------------------------------------------------------------------
// Phase 2: 母音プリセット、TransitionManager、有声/無声切替を追加。
// ============================================================================

import './style.css';
import { TractEditor } from './ui/tract-editor';
import { Controls, PresetControls } from './ui/controls';
import { AudioEngine } from './audio/engine';
import { TransitionManager } from './models/vowel-presets';

// --- DOM 要素の取得 ---

function requireElement<T extends HTMLElement>(
  id: string,
  type: new (...args: never[]) => T,
): T {
  const el = document.getElementById(id);
  if (el === null) {
    throw new Error(`要素が見つかりません: #${id}`);
  }
  if (!(el instanceof type)) {
    throw new Error(`要素 #${id} が期待する型ではありません`);
  }
  return el;
}

const canvas = requireElement('tract-canvas', HTMLCanvasElement);
const startStopBtn = requireElement('start-stop-btn', HTMLButtonElement);
const statusText = requireElement('status-text', HTMLElement);
const errorText = requireElement('error-text', HTMLElement);
const presetsContainer = requireElement('presets', HTMLElement);
const noiseBtn = requireElement('noise-btn', HTMLButtonElement);

// --- コア・モジュール ---

const engine = new AudioEngine();

// 断面積をEngineに送信するヘルパ（エディタ変更 / 遷移更新の両方で使用）
function sendAreasToEngine(areas: Float64Array): void {
  if (engine.isRunning()) {
    engine.sendAreas(areas);
  }
}

// presetControls は tractEditor / controls のコールバックから参照されるため先に宣言
let presetControls: PresetControls;

// 断面積エディタ（source of truth は 16制御点、44区間はスプライン補間の導出値）
// 第3引数: ドラッグ開始時にプリセットハイライトを解除
const tractEditor = new TractEditor(canvas, sendAreasToEngine, () => {
  presetControls.setActivePreset(null);
});

// 遷移マネージャ（プリセット切替時のコサイン補間）
// getCurrentPoints で現在値をスナップショット取得、onUpdate で TractEditor に書き戻す
const transitionManager = new TransitionManager(
  () => tractEditor.getControlPoints(),
  (points) => {
    tractEditor.setControlPoints(points);
    // setControlPoints 内で onAreasChange → sendAreasToEngine が呼ばれるため
    // ここで重複送信しない
  },
);

// Start/Stop ボタン
const controls: Controls = new Controls(
  startStopBtn,
  statusText,
  errorText,
  async () => {
    controls.setState('initializing');
    try {
      await engine.start(tractEditor.getSectionAreas());
      controls.setState('running');
    } catch (err) {
      engine.stop();
      throw err;
    }
  },
  () => {
    engine.stop();
    presetControls.setNoiseActive(false);
    controls.setState('idle');
  },
);

// プリセットボタン + Noise ボタン
presetControls = new PresetControls(
  presetsContainer,
  noiseBtn,
  // onPresetSelect: プリセット選択 → TransitionManager で滑らかに遷移
  (id) => {
    transitionManager.transitionTo(id);
  },
  // onNoiseToggle: 有声/無声切替 → Engine に送信
  (isNoise) => {
    engine.setSourceType(isNoise ? 'noise' : 'voiced');
  },
);
