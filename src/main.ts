// ============================================================================
// エントリポイント — 各モジュールの結線
// ----------------------------------------------------------------------------
// Phase 4: Auto Sing モード（自動歌唱）を追加。
// ============================================================================

import './style.css';
import { TractEditor } from './ui/tract-editor';
import { Controls, PresetControls, SliderControls, VoiceQualityControls } from './ui/controls';
import { AudioEngine } from './audio/engine';
import { TransitionManager } from './models/vowel-presets';
import { SpectrumDisplay } from './ui/spectrum-display';
import { FormantController } from './models/formant-controller';
import { AutoSinger } from './ui/auto-singer/index';
import { AutoSingControls } from './ui/auto-singer/ui-controls';
import { CONSONANT_PRESETS } from './audio/consonant-presets';
import { parseHiragana, resolveHatsuonAllophones } from './text/text-parser';
import { generateTimeline } from './text/phoneme-timeline';
import { PhonemePlayer } from './text/phoneme-player';
import { DEFAULT_PROSODY } from './types/index';
import type { ConsonantId, OperationMode } from './types/index';
// Phase 9: テキスト読み上げ UI 完成
import { PhonemeTimelineCanvas } from './ui/timeline-canvas';
import { OperationModeManager } from './ui/operation-mode';
import { TextReadControls } from './ui/controls';

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
const rdSlider = requireElement('rd-slider', HTMLInputElement);
const rdValue = requireElement('rd-value', HTMLElement);
const aspirationSlider = requireElement('aspiration-slider', HTMLInputElement);
const aspirationValue = requireElement('aspiration-value', HTMLElement);
const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
// Phase 9: テキスト読み上げ UI 要素
const textInput = requireElement('text-input', HTMLTextAreaElement);
const textReadBtn = requireElement('text-read-btn', HTMLButtonElement);
const speechRateSlider = requireElement('speech-rate-slider', HTMLInputElement);
const speechRateValue = requireElement('speech-rate-value', HTMLElement);
const phonemeTimelineCanvasEl = requireElement('phoneme-timeline-canvas', HTMLCanvasElement);

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
// Phase 9: OperationMode と TextReadControls も後方参照
let operationMode: OperationModeManager;
let textReadControls: TextReadControls;

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
      // Phase 9: OperationMode を autoSing に遷移（textRead中なら拒否）
      if (!operationMode.canTransitionTo('autoSing')) {
        autoSingControls.setActive(false);
        return;
      }
      operationMode.setMode('autoSing');
      autoSinger.start();
    } else {
      autoSinger.stop();
      autoSingControls.setActive(false);
      // Phase 9: manual モードに復帰
      operationMode.setMode('manual');
    }
  },
  (bpm) => {
    autoSinger.setBpm(bpm);
  },
);

// --- 声質制御 ---

const voiceQualityControls = new VoiceQualityControls(
  rdSlider, rdValue,
  aspirationSlider, aspirationValue,
  modelSelect,
  (rd) => { engine.setRd(rd); },
  (level) => { engine.setAspiration(level); },
  (model) => { engine.setGlottalModel(model); },
);
void voiceQualityControls;

// --- Phase 6: 子音デモボタンの結線 ---
// イベント委譲で /s/, /k/, /t/, /p/ の押下を捕捉し、現在の 44 区間断面積を
// engine.playConsonant() に渡して子音シーケンスを実行する。
// Phase 6 レビュー対応: Auto Sing 中はスキップ / ID のランタイム検証を追加。
const consonantDemoContainer = document.getElementById('consonant-demo');
if (consonantDemoContainer !== null) {
  consonantDemoContainer.addEventListener('click', (e: Event) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.classList.contains('consonant-demo-btn')) return;
    // Phase 6 レビュー対応: Auto Sing 中はデモボタンを無効化 (タイムライン競合回避)
    if (autoSinger.isActive()) return;
    if (!engine.isRunning()) return;
    const id = target.dataset['consonant'];
    if (id === undefined) return;
    // Phase 6 レビュー対応: ランタイム検証 (unsafe cast 回避)
    if (!(id in CONSONANT_PRESETS)) return;
    // 現在の母音形状を子音の先行/後続母音として使用するため、
    // tract-editor の sectionAreas をスナップショットコピーする。
    // (engine.playConsonant 側でも内部コピーを取るが、setTimeout で
    //  非同期に参照される currentAreas は呼び出し側で別バッファに保持しておく必要がある。)
    const areas = tractEditor.getSectionAreas();
    const areasCopy = new Float64Array(areas);
    engine.playConsonant(id as ConsonantId, areasCopy);
  });
}

// ============================================================================
// Phase 8: テキスト読み上げ API
// ============================================================================
//
// ひらがなテキストを音素列に分解し、声道制御パイプラインで連続発声する。
// プログラマブル API: `window.play("こんにちは")` で DevTools から呼び出し可能。
// UI 統合は Phase 9 で完成予定。
//
// 処理フロー: text → parseHiragana → resolveHatsuonAllophones
//            → generateTimeline → PhonemePlayer.load → play

// Phase 8 レビュー対応: tractEditor を渡して stop() 時の UI 同期を有効化する
const phonemePlayer = new PhonemePlayer(engine, tractEditor);

export async function play(
  text: string,
  opts?: { rate?: number; basePitch?: number },
): Promise<void> {
  if (!engine.isRunning()) {
    throw new Error('play(): AudioContext is not running. Press Start first.');
  }
  if (autoSinger.isActive()) {
    throw new Error('play(): Auto Sing is active. Stop it first.');
  }

  // Phase 8 レビュー対応: 引数バリデーション (異常値で無音 / 異常 F0 を防ぐ)
  const rate = Math.max(0.5, Math.min(2.0, opts?.rate ?? 1.0));
  const basePitch = Math.max(50, Math.min(400, opts?.basePitch ?? 110));
  const isQuestion = /[？?]\s*$/.test(text);

  const tokens = resolveHatsuonAllophones(parseHiragana(text));
  if (tokens.length === 0) return;

  const initialAreas = new Float64Array(tractEditor.getControlPoints());
  const events = generateTimeline(
    tokens,
    {
      rate,
      prosody: { ...DEFAULT_PROSODY, basePitch },
      isQuestion,
    },
    initialAreas,
  );

  phonemePlayer.load(events);
  await phonemePlayer.play();
}

// グローバル公開（DevTools / 後続 UI からの呼び出し用）
(window as unknown as { play: typeof play }).play = play;

// ============================================================================
// Phase 9: テキスト読み上げ UI 完成形
// ============================================================================
//
// OperationMode 状態機械で manual / autoSing / textRead の 3 モードを排他制御し、
// PhonemeTimelineCanvas で再生中の音素をハイライト、tract-editor 上に狭窄位置
// マーカーを描画する完成形 UI。
// ============================================================================

operationMode = new OperationModeManager();
const timelineCanvas = new PhonemeTimelineCanvas(phonemeTimelineCanvasEl);

// PhonemePlayer のコールバック設定
// Phase 9 レビュー対応: scheduleTransition の補間を破壊しないよう、
// 1) setControlPoints ではなく setControlPointsVisualOnly で描画のみ更新
// 2) 狭窄マーカーは状態のみ先に設定し、バッチで 1 回だけ draw() を呼ぶ
// 3) ハイライトは AudioContext 基準の実時刻で行い setTimeout ジッターを排除
phonemePlayer.onPhonemeChange((event, _index) => {
  // 1. 狭窄マーカー状態を先に設定 (draw() は呼ばない)
  tractEditor.setConstrictionMarker(event.constrictionNoise?.position ?? null);
  // 2. 声道形状のビジュアル更新 (内部で draw() を 1 回呼ぶ)
  //    scheduleTransition は PhonemePlayer.fireEvent 側で既に開始済みのため、
  //    ここでは UI の描画更新だけ行う (engine.sendAreas は発火しない)
  tractEditor.setControlPointsVisualOnly(event.tractAreas);
  // 3. タイムラインのハイライト (AudioContext 基準の実時刻でジッター排除)
  const t = phonemePlayer.getCurrentPlaybackTime();
  timelineCanvas.highlightAt(t > 0 ? t : event.startTime);
});

phonemePlayer.onComplete(() => {
  // 再生完了 → manual モードへ復帰
  operationMode.setMode('manual');
  textReadControls.setPlaying(false);
  tractEditor.drawConstrictionMarker(null);
  // タイムラインは最終音素ハイライトのまま残す（次の Stop / 再生で clear される）
});

// テキスト読み上げ UI コントロール
textReadControls = new TextReadControls(
  textInput,
  textReadBtn,
  speechRateSlider,
  speechRateValue,
  // onPlayRequested
  (text, rate) => {
    // textRead モードへ遷移
    if (!operationMode.canTransitionTo('textRead')) {
      console.warn('テキスト読み上げに切り替えられません（Auto Sing 中の可能性）');
      return;
    }
    operationMode.setMode('textRead');
    textReadControls.setPlaying(true);

    // タイムライン描画
    const isQuestion = /[？?]\s*$/.test(text);
    const tokens = resolveHatsuonAllophones(parseHiragana(text));
    if (tokens.length === 0) {
      operationMode.setMode('manual');
      textReadControls.setPlaying(false);
      return;
    }
    const initialAreas = new Float64Array(tractEditor.getControlPoints());
    const events = generateTimeline(
      tokens,
      { rate, prosody: { ...DEFAULT_PROSODY }, isQuestion },
      initialAreas,
    );
    timelineCanvas.render(events);

    // 再生開始
    play(text, { rate }).catch((err) => {
      console.error('play() error:', err);
      // Phase 9 レビュー対応: エラーを UI の #error-text に流す
      const message = err instanceof Error ? err.message : String(err);
      controls.showError(`読み上げエラー: ${message}`);
      operationMode.setMode('manual');
      textReadControls.setPlaying(false);
      timelineCanvas.clear();
    });
  },
  // onStopRequested
  () => {
    phonemePlayer.stop();
    timelineCanvas.clear();
    tractEditor.drawConstrictionMarker(null);
    operationMode.setMode('manual');
    textReadControls.setPlaying(false);
  },
);

// OperationMode 変更時の UI 一括制御
operationMode.onChange((mode: OperationMode) => {
  // tract-canvas のデータ属性を更新（CSS 視覚フィードバック用）
  canvas.dataset['mode'] = mode;

  switch (mode) {
    case 'manual':
      // 全 UI 有効化
      tractEditor.setDragEnabled(true);
      presetControls.setEnabled(true);
      presetControls.setNoiseEnabled(true);
      sliderControls.setEnabled(true);
      voiceQualityControls.setEnabled(true);
      autoSingControls.setEnabled(true);
      autoSingControls.setBpmEnabled(true);
      textReadControls.setEnabled(true);
      break;

    case 'autoSing':
      // 声道ドラッグ・プリセット・テキスト読み上げを無効化
      tractEditor.setDragEnabled(false);
      presetControls.setEnabled(false);
      presetControls.setNoiseEnabled(false);
      // F0/Vol/Rd は Auto Sing 中も有効（基準値合算）
      sliderControls.setEnabled(true);
      voiceQualityControls.setEnabled(true);
      // Auto Sing ボタンは停止用に有効
      autoSingControls.setEnabled(true);
      autoSingControls.setBpmEnabled(true);
      textReadControls.setEnabled(false);
      break;

    case 'textRead':
      // テキスト再生中は他をすべて無効化
      tractEditor.setDragEnabled(false);
      presetControls.setEnabled(false);
      presetControls.setNoiseEnabled(false);
      sliderControls.setEnabled(false);
      voiceQualityControls.setEnabled(false);
      autoSingControls.setEnabled(false);
      autoSingControls.setBpmEnabled(false);
      // テキスト読み上げ自身のコントロール (停止ボタンと速度) のみ有効
      textReadControls.setEnabled(true);
      break;
  }
});

// Auto Sing ボタンと OperationMode の結線
// 既存 AutoSingControls の onToggle コールバックは維持し、追加で OperationMode を更新
// (既存の AutoSingControls 結線ロジックは上で行われているため、ここでは onChange 経由のみ)

// 初期 UI 状態
canvas.dataset['mode'] = 'manual';

// 初期フォルマント計算
formantController.schedule();
formantController.start();
