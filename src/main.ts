// ============================================================================
// エントリポイント — 各モジュールの結線
// ----------------------------------------------------------------------------
// - DOM 要素の取得
// - TractEditor / Controls / AudioEngine のインスタンス生成
// - 断面積変更 → Engine への送信、Start/Stop → Engine の起動・停止
//
// Phase 1 ではこのファイルが単一のエントリポイント。
// Phase 2 以降で母音プリセットボタン、Phase 3 でスライダー、Phase 4 で Auto Sing
// などが追加された際には、main.ts から各モジュールを初期化して結線する。
// ============================================================================

import './style.css';
import { TractEditor } from './ui/tract-editor';
import { Controls } from './ui/controls';
import { AudioEngine } from './audio/engine';

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

// --- コア・モジュール ---

const engine = new AudioEngine();

// 断面積エディタ（source of truth は 16制御点、44区間はスプライン補間の導出値）
// ドラッグのたびに engine.sendAreas() で Worklet に通知する。
const tractEditor = new TractEditor(canvas, (areas) => {
  if (engine.isRunning()) {
    engine.sendAreas(areas);
  }
});

// Start/Stop ボタン
// onStart は必ず click イベントの同期コールスタック内で engine.start() を呼ぶ
// （Autoplay Policy 対策）。engine.start() は内部で await するが、
// AudioContext の new は click の同期タスク内で完了する。
const controls: Controls = new Controls(
  startStopBtn,
  statusText,
  errorText,
  // onStart
  async () => {
    controls.setState('initializing');
    try {
      await engine.start(tractEditor.getSectionAreas());
      controls.setState('running');
    } catch (err) {
      // start() 内で失敗した場合、engine 側は部分的にリソースを確保している可能性があるため
      // 明示的に stop() してクリーンアップしてから再 throw（Controls 側で error 状態へ遷移）
      engine.stop();
      throw err;
    }
  },
  // onStop
  () => {
    engine.stop();
    controls.setState('idle');
  },
);

// 初期状態で空の Canvas が表示され、Start ボタンを押すと音が鳴る。
// tractEditor は constructor 内で初回描画を行うので、追加の初期化は不要。
