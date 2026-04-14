// ============================================================================
// エントリポイント — 各モジュールの結線
// ----------------------------------------------------------------------------
// Phase 4: Auto Sing モード（自動歌唱）を追加。
// ============================================================================

import './style.css';
import { TractEditor } from './ui/tract-editor';
import { Controls, PresetControls, SliderControls } from './ui/controls';
import { AudioEngine } from './audio/engine';
import { TransitionManager } from './models/vowel-presets';
import { SpectrumDisplay } from './ui/spectrum-display';
import { FormantController } from './models/formant-controller';
import { AutoSinger } from './ui/auto-singer/index';
import { AutoSingControls } from './ui/auto-singer/ui-controls';

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
const f0Slider = requireElement('f0-slider', HTMLInputElement);
const f0Value = requireElement('f0-value', HTMLElement);
const volumeSlider = requireElement('volume-slider', HTMLInputElement);
const volumeValue = requireElement('volume-value', HTMLElement);
const spectrumCanvas = requireElement('spectrum-canvas', HTMLCanvasElement);
const overlayCanvas = requireElement('overlay-canvas', HTMLCanvasElement);
const autoSingBtn = requireElement('auto-sing-btn', HTMLButtonElement);
const bpmSlider = requireElement('bpm-slider', HTMLInputElement);
const bpmValueEl = requireElement('bpm-value', HTMLElement);

const formantF1 = document.querySelector<HTMLElement>('#formant-display .f1')!;
const formantF2 = document.querySelector<HTMLElement>('#formant-display .f2')!;
const formantF3 = document.querySelector<HTMLElement>('#formant-display .f3')!;

// --- コア・モジュール ---

const engine = new AudioEngine();

function sendAreasToEngine(areas: Float64Array): void {
  if (engine.isRunning()) {
    engine.sendAreas(areas);
  }
}

// --- presetControls / autoSinger は後方参照 ---
let presetControls: PresetControls;
let autoSinger: AutoSinger;
let autoSingControls: AutoSingControls;

// 現在のF0スライダー値を保持（Auto Singerの基準F0として使用）
let currentBaseF0 = 120;

// 断面積エディタ
const tractEditor = new TractEditor(canvas, (areas) => {
  sendAreasToEngine(areas);
  formantController.schedule();
}, () => {
  presetControls.setActivePreset(null);
});

// 遷移マネージャ
const transitionManager = new TransitionManager(
  () => tractEditor.getControlPoints(),
  (points) => {
    tractEditor.setControlPoints(points);
  },
);

// スペクトル��示
const spectrumDisplay = new SpectrumDisplay(
  spectrumCanvas,
  overlayCanvas,
  { f1: formantF1, f2: formantF2, f3: formantF3 },
);

// フォルマント計算コントローラ
const formantController = new FormantController(
  () => tractEditor.getSectionAreas(),
  spectrumDisplay,
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

      const analyser = engine.getAnalyser();
      if (analyser) {
        spectrumDisplay.setAnalyser(analyser);
        spectrumDisplay.start();
      }
      formantController.start();
    } catch (err) {
      engine.stop();
      throw err;
    }
  },
  () => {
    // Auto Sing停止
    if (autoSinger.isActive()) {
      autoSinger.stop();
      presetControls.setEnabled(true);
      autoSingControls.setActive(false);
    }
    formantController.stop();
    spectrumDisplay.stop();
    engine.stop();
    presetControls.setNoiseActive(false);
    controls.setState('idle');
  },
);

// プリセットボタン + Noise ボタン
presetControls = new PresetControls(
  presetsContainer,
  noiseBtn,
  (id) => {
    if (!autoSinger.isActive()) {
      transitionManager.transitionTo(id);
    }
  },
  (isNoise) => {
    engine.setSourceType(isNoise ? 'noise' : 'voiced');
  },
);

// F0 / 音量スライダー
const sliderControls = new SliderControls(
  f0Slider, f0Value,
  volumeSlider, volumeValue,
  (hz) => {
    currentBaseF0 = hz;
    if (!autoSinger.isActive()) {
      engine.setFrequency(hz);
    }
  },
  (value) => { engine.setVolume(value); },
);
void sliderControls;

// --- Auto Singer ---

autoSinger = new AutoSinger({
  engine,
  transitionManager,
  tractEditor,
  formantController,
  getBaseF0: () => currentBaseF0,
});

autoSingControls = new AutoSingControls(
  autoSingBtn,
  bpmSlider,
  bpmValueEl,
  (active) => {
    if (active && engine.isRunning()) {
      autoSinger.start();
      presetControls.setEnabled(false);
    } else {
      autoSinger.stop();
      presetControls.setEnabled(true);
      autoSingControls.setActive(false);
    }
  },
  (bpm) => {
    autoSinger.setBpm(bpm);
  },
);

// 初期フォルマント計算
formantController.schedule();
formantController.start();
