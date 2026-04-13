// ============================================================================
// エントリポイント — 各モジュールの結線
// ----------------------------------------------------------------------------
// Phase 3: スペクトル表示、フォルマント計算、F0/音量スライダーを追加。
// ============================================================================

import './style.css';
import { TractEditor } from './ui/tract-editor';
import { Controls, PresetControls, SliderControls } from './ui/controls';
import { AudioEngine } from './audio/engine';
import { TransitionManager } from './models/vowel-presets';
import { SpectrumDisplay } from './ui/spectrum-display';
import { calculateFormants } from './models/formant-calculator';

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

// フォルマント表示要素
const formantF1 = document.querySelector<HTMLElement>('#formant-display .f1')!;
const formantF2 = document.querySelector<HTMLElement>('#formant-display .f2')!;
const formantF3 = document.querySelector<HTMLElement>('#formant-display .f3')!;

// --- コア・モジュール ---

const engine = new AudioEngine();

// 断面積をEngineに送信するヘルパ
function sendAreasToEngine(areas: Float64Array): void {
  if (engine.isRunning()) {
    engine.sendAreas(areas);
  }
}

// --- フォルマント計算（dirtyフラグ + throttle） ---

let formantDirty = false;
let lastFormantUpdate = 0;
const FORMANT_INTERVAL = 80; // ~12fps

function scheduleFormantUpdate(): void {
  formantDirty = true;
}

function tickFormants(): void {
  if (!formantDirty) return;
  const now = performance.now();
  if (now - lastFormantUpdate < FORMANT_INTERVAL) return;

  formantDirty = false;
  lastFormantUpdate = now;

  const areas = tractEditor.getSectionAreas();
  const result = calculateFormants(areas);
  spectrumDisplay.updateFormants(result.f1, result.f2, result.f3);
}

// rAF ループでフォルマント計算を定期実行
let formantRafId = 0;
function formantLoop(): void {
  tickFormants();
  formantRafId = requestAnimationFrame(formantLoop);
}

// --- presetControls は tractEditor / controls のコールバックから参照されるため先に宣言 ---
let presetControls: PresetControls;

// 断面積エディタ
const tractEditor = new TractEditor(canvas, (areas) => {
  sendAreasToEngine(areas);
  scheduleFormantUpdate();
}, () => {
  presetControls.setActivePreset(null);
});

// 遷移マネージャ
const transitionManager = new TransitionManager(
  () => tractEditor.getControlPoints(),
  (points) => {
    tractEditor.setControlPoints(points);
    // setControlPoints → onAreasChange → sendAreasToEngine + scheduleFormantUpdate
  },
);

// スペクトル表示
const spectrumDisplay = new SpectrumDisplay(
  spectrumCanvas,
  overlayCanvas,
  { f1: formantF1, f2: formantF2, f3: formantF3 },
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

      // スペクトル表示を開始
      const analyser = engine.getAnalyser();
      if (analyser) {
        spectrumDisplay.setAnalyser(analyser);
        spectrumDisplay.start();
      }

      // フォルマント計算ループ開始
      scheduleFormantUpdate();
      formantRafId = requestAnimationFrame(formantLoop);
    } catch (err) {
      engine.stop();
      throw err;
    }
  },
  () => {
    // フォルマント計算ループ停止
    if (formantRafId !== 0) {
      cancelAnimationFrame(formantRafId);
      formantRafId = 0;
    }
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
    transitionManager.transitionTo(id);
  },
  (isNoise) => {
    engine.setSourceType(isNoise ? 'noise' : 'voiced');
  },
);

// F0 / 音量スライダー
const sliderControls = new SliderControls(
  f0Slider, f0Value,
  volumeSlider, volumeValue,
  (hz) => { engine.setFrequency(hz); },
  (value) => { engine.setVolume(value); },
);

void sliderControls;

// 初期フォルマント計算（Canvas表示用）
scheduleFormantUpdate();
tickFormants();
