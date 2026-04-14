# PHASE9-001 テキスト読み上げUI完成

## 1. 概要

| 項目 | 内容 |
|------|------|
| チケットID | PHASE9-001 |
| フェーズ名 | Phase 9 — テキスト読み上げUI完成 |
| マイルストーン | [docs/MILESTONES.md `Phase 9` セクション](../MILESTONES.md) |
| 要件定義 | [docs/REQUIREMENTS_CONSONANT_TTS.md 4.1 / 4.2 / 4.3 / 6 非機能要件](../REQUIREMENTS_CONSONANT_TTS.md) |
| 状態 | 計画中（未着手） |
| 前提条件 | Phase 6 完了（[PHASE6-001](./PHASE6-001_consonant-foundation.md)）, Phase 7 完了（[PHASE7-001](./PHASE7-001_nasal-tract-model.md)）, Phase 8 完了（[PHASE8-001](./PHASE8-001_text-to-speech.md)）。`play(text)` API、`PhonemePlayer` クラス、`onPhonemeChange` / `onComplete` コールバックが動作中。 |
| 推定工数 | 4 名構成 × 約 5 営業日 |
| 優先度 | 高（Phase 6-8 で構築したテキスト読み上げパイプラインの集大成。本フェーズ完了で「ユーザがブラウザ上でひらがなを入力して読み上げが聴ける」完成形 UX が成立する） |
| 成果物（新規） | `src/ui/timeline-canvas.ts`, `src/ui/timeline-canvas.test.ts`, `src/ui/operation-mode.ts`, `src/ui/operation-mode.test.ts` |
| 成果物（変更） | `index.html`, `src/style.css`, `src/ui/controls.ts`, `src/ui/tract-editor.ts`, `src/main.ts`, `src/types/index.ts`, `src/ui/auto-singer/ui-controls.ts` |

### 1.1 Phase 6-8 への依存と本フェーズの位置付け

Phase 6 で導入された `setConstrictionNoise` / `scheduleTransition`、Phase 7 で導入された 30 区間鼻腔管と velum 制御、Phase 8 で導入された `text-parser.ts` / `phoneme-timeline.ts` / `phoneme-player.ts` / `play(text)` API という 3 階層の前提が揃っていることが本フェーズ着手の必須条件である。Phase 9 自体はオーディオ DSP 層・テキスト処理層・再生エンジン層には一切手を入れず、純粋に UI 層と状態管理層のみを実装する。Phase 1 の声道エディタから Phase 8 の `play()` API までを 3 つの操作モード（`manual` / `autoSing` / `textRead`）の排他制御として統合する**最終フェーズ**であり、本フェーズ完了をもって REQUIREMENTS.md と REQUIREMENTS_CONSONANT_TTS.md の UI 要件は全て満たされる。

---

## 2. タスク目的とゴール

### 2.1 目的

Phase 6-8 で実装したテキスト読み上げパイプラインを、ブラウザ上で誰でも触れる「完成形 UI」として提供する。具体的には (a) ひらがなを入力する textarea (b) 再生/停止トグルボタン (c) 速度スライダー (d) 音素タイムラインの横帯表示 (e) 声道エディタの自動アニメーション (f) 子音発声時の狭窄位置マーカー、を実装する。さらに新規 UI と既存 UI（声道ドラッグ・母音プリセット・Auto Sing）が衝突しないよう `OperationMode` 状態機械で 3 モードを排他制御する。Phase 8 の `play()` は DevTools 経由で叩く前提だったが、Phase 9 では「ユーザはコードを書かない」という前提に立ち、マウス・キーボード操作だけで全機能にアクセスできる UX を設計する。

### 2.2 達成基準

- textarea にひらがな入力 → 再生ボタン押下で読み上げが開始される
- 再生中、音素タイムラインで現在音素がハイライトされる（IPA ラベル付き）
- 再生中、声道エディタが音素タイムラインに従って自動的に変形する
- 子音発声中、声道エディタ上に狭窄位置を示す赤色縦マーカーが表示される
- 速度スライダー (0.5x-2.0x) で再生速度が反映される
- 3 モード排他制御: `manual` / `autoSing` / `textRead` が UI レベルで矛盾なく動作する
- テキスト再生中に「停止」ボタンで即座に発声停止 → `manual` モードへ復帰
- 再生開始から初音発声までのレイテンシが 50 ms 以下
- メインスレッドの Canvas 描画 + タイムライン更新が 16 ms (60 fps) 以内
- 既存の母音プリセット・Auto Sing・スペクトル表示・フォルマント計算が退行なく動作する

### 2.3 完了条件

1. `index.html` に `#text-input`, `#text-read-btn`, `#speech-rate-slider`, `#phoneme-timeline-canvas` の 4 要素が追加されている
2. `src/ui/timeline-canvas.ts` が `PhonemeTimelineCanvas` クラスを公開し、`render(events)` / `highlightAt(timeSec)` / `clear()` の 3 API を提供する
3. `src/ui/operation-mode.ts` が `OperationMode` 型と `OperationModeManager` クラスを公開する
4. `controls.ts` の既存 4 クラスに `setEnabled(enabled)` 系メソッドが統一的に追加され、新規 `TextReadControls` クラスが追加される
5. `tract-editor.ts` に `drawConstrictionMarker(position: number | null)` API が追加されている
6. `main.ts` で `OperationModeManager.onChange` から全 UI 要素の enable/disable を一括制御している
7. `phonemePlayer.onPhonemeChange` から `tractEditor.setControlPoints` / `timelineCanvas.highlightAt` / `tractEditor.drawConstrictionMarker` の 3 つを協調呼び出ししている
8. 速度スライダーの値変更が `play(text, { rate })` に反映される
9. `operation-mode.test.ts` / `timeline-canvas.test.ts` の単体テストが全件通過する
10. レイテンシ計測 50 ms 以下、Chrome DevTools Performance で Canvas 描画 16 ms 以下を実測値で確認
11. Chrome / Firefox / Edge の最新版で動作確認済み

---

## 3. 実装する内容の詳細

### 3.1 テキスト入力 UI

#### 3.1.1 HTML 構造

`index.html` の `#auto-sing-controls` の下、`#spectrum-container` の上に新セクション `#text-read-controls` を追加する。配置順は「既存 UI → テキスト読み上げ UI → スペクトル表示」とし、既存ユーザの操作慣性を壊さない。

```html
<div id="text-read-controls">
  <textarea id="text-input" rows="2"
    placeholder="ひらがなを入力... 例: こんにちは"
    aria-label="読み上げテキスト入力"></textarea>
  <div id="text-read-row">
    <button id="text-read-btn" type="button" disabled>読み上げ</button>
    <label class="slider-group">
      <span class="slider-label">速度</span>
      <input id="speech-rate-slider" type="range"
        min="0.5" max="2.0" step="0.1" value="1.0"
        aria-label="読み上げ速度" />
      <span id="speech-rate-value">1.0x</span>
    </label>
  </div>
  <canvas id="phoneme-timeline-canvas" aria-label="音素タイムライン"></canvas>
</div>
```

#### 3.1.2 各要素の仕様

| 要素 | 仕様 |
|------|-----|
| `#text-input` | 2 行 textarea、横幅 100%、placeholder「ひらがなを入力...」、最大 200 文字、IME (`compositionstart` / `compositionend`) 中は再生ボタン disabled |
| `#text-read-btn` | トグル式。停止中ラベル「読み上げ」、再生中ラベル「停止」。`engine.state !== 'running'` / `autoSinger.isActive()` / textarea 空 のいずれかで disabled |
| `#speech-rate-slider` | range 0.5-2.0、step 0.1、default 1.0、`1.0x` 表示。Phase 9 では再生開始時のみ反映（動的反映は Phase 10 申し送り） |

### 3.2 音素タイムライン Canvas

#### 3.2.1 PhonemeTimelineCanvas クラス設計

```typescript
// src/ui/timeline-canvas.ts
export class PhonemeTimelineCanvas {
  constructor(canvas: HTMLCanvasElement);
  render(events: PhonemeEvent[]): void;       // 全音素を 1 回描画（再生開始時）
  highlightAt(timeSec: number): void;          // 現在再生位置をハイライト
  clear(): void;                                // タイムラインをクリア
  destroy(): void;
}
```

内部状態: `events`, `totalDuration`, `pixelsPerSecond`, `currentTime`, `staticLayer` (OffscreenCanvas)。

#### 3.2.2 描画レイアウト

- 横幅: Canvas の clientWidth、CSS で `width: 100%`
- 縦幅: 60 px 固定
- 1 音素の幅: `canvas.width * (event.duration / totalDuration)`
- セル内 IPA ラベル: 中央配置、フォント 10-16 px 動的
- 配色: 母音=薄青 #9ECCE8 / 破裂=オレンジ #F0A050 / 摩擦=黄 #F0D050 / 鼻音=紫 #B090E0 / 弾音半母音=緑 #80D080 / ポーズ=グレー #B0B0B0
- ハイライト: 上記の色を 50% 明度補正 + 進行位置の縦線

#### 3.2.3 2 層 Canvas 構造（性能最適化）

毎フレーム再描画コストを抑えるため、静的部分（セル + ラベル + 区切り線）と動的部分（ハイライト）を分離する:

```
[Layer 1: 静的]   OffscreenCanvas（render 時に 1 回描画）
[Layer 2: 動的]   メイン Canvas（highlightAt ごとに drawImage(staticLayer) + ハイライト矩形）
```

OffscreenCanvas 未対応ブラウザは通常 `<canvas>` でフォールバック。Phase 9 の主ターゲットは Chrome / Firefox / Edge。

#### 3.2.4 phoneme-player との統合

`phonemePlayer.onPhonemeChange((event, index) => timelineCanvas.highlightAt(event.startTime))`、`onComplete(() => timelineCanvas.clear())` の 2 つで完結する。タイムラインの「進行位置」は厳密な再生時刻ではなく現在発火中の `event.startTime` を採用し、メインスレッドのジッタを吸収する。

### 3.3 声道エディタ上の狭窄位置マーカー

#### 3.3.1 描画 API の追加

`tract-editor.ts` に新規メソッド `drawConstrictionMarker(position: number | null)` を追加する。`position` は 44 区間 index（0=唇側、43=声門側）。`null` 渡しでマーカー消去。

```typescript
// src/ui/tract-editor.ts （追加部分）
private constrictionPosition: number | null = null;

drawConstrictionMarker(position: number | null): void {
  this.constrictionPosition = position;
  this.draw();
}

// 既存 draw() 末尾で内部メソッドを呼び、constrictionPosition !== null の時に
// 該当位置に赤色縦マーカー (#E04040, lineWidth 3, dash [4,2]) を描画
```

#### 3.3.2 phoneme-player との統合

`onPhonemeChange` 内で `event.constrictionNoise?.position` が定義されていればその位置にマーカーを描画、`undefined` なら `null` を渡してマーカー消去。母音区間ではマーカーは表示されず、子音区間のみで表示される。

### 3.4 操作モード排他制御 (OperationMode)

#### 3.4.1 OperationMode 型と状態機械

```typescript
// src/types/index.ts
export type OperationMode = 'manual' | 'autoSing' | 'textRead';
```

3 値の状態機械、初期値 `manual`。遷移可能な経路:

```
manual ──→ autoSing  (Auto Sing ボタン押下)
manual ──→ textRead  (テキスト再生ボタン押下)
autoSing ──→ manual  (Auto Sing 再押下 / Stop)
textRead ──→ manual  (テキスト停止 / onComplete)
```

`autoSing → textRead` および `textRead → autoSing` の直接遷移は禁止（必ず `manual` を経由）。

#### 3.4.2 OperationModeManager クラス

```typescript
// src/ui/operation-mode.ts
export class OperationModeManager {
  getMode(): OperationMode;
  setMode(mode: OperationMode): void;
  onChange(cb: (mode: OperationMode, prev: OperationMode) => void): void;
  canTransitionTo(target: OperationMode): boolean;
}
```

`setMode()` の責務: 遷移可能性チェック → 不可ならエラーログ → 可能なら更新と全コールバック発火。

#### 3.4.3 UI 要素 enable/disable テーブル

要件定義 4.3 を実装に落とし込む。

| UI 要素 | manual | autoSing | textRead | 制御メソッド |
|---------|--------|----------|----------|-----------|
| 声道ドラッグ | ✓ | ✗ | ✗ | `TractEditor.setDragEnabled` |
| 母音プリセット | ✓ | ✗ | ✗ | `PresetControls.setEnabled` |
| Noise ボタン | ✓ | ✗ | ✗ | `PresetControls.setNoiseEnabled` |
| F0 スライダー | ✓ | ✓ (基準値合算) | ✗ | `SliderControls.setF0Enabled` |
| Vol スライダー | ✓ | ✓ | ✗ | `SliderControls.setVolumeEnabled` |
| Rd / Asp / Model | ✓ | ✓ | ✗ | `VoiceQualityControls.setEnabled` |
| Auto Sing ボタン | ✓ | ✓ (停止用) | ✗ | `AutoSingControls.setEnabled` |
| BPM スライダー | ✓ | ✓ | ✗ | `AutoSingControls.setBpmEnabled` |
| テキスト再生ボタン | ✓ | ✗ | ✓ (停止用) | `TextReadControls.setEnabled` |
| 速度スライダー | ✓ | ✓ | ✓ | `TextReadControls.setRateEnabled` |
| Start/Stop ボタン | 常時 ✓ | 常時 ✓ | 常時 ✓ | `Controls.setEnabled` (no-op) |

#### 3.4.4 モード遷移時のクリーンアップ

| 遷移 | クリーンアップ |
|------|--------------|
| `manual → autoSing` | 声道ドラッグ無効化、母音プリセット無効化、テキスト再生ボタン無効化 |
| `autoSing → manual` | `autoSinger.stop()`、全 UI 復帰 |
| `manual → textRead` | 声道ドラッグ無効化、プリセット無効化、F0/Vol/Rd/Auto Sing 無効化、`phonemePlayer.play()` 呼び出し |
| `textRead → manual` | `phonemePlayer.stop()`、声道形状の中性母音ソフトリセット (300 ms)、全 UI 復帰、`timelineCanvas.clear()`、`drawConstrictionMarker(null)` |

`onComplete` 経由の `textRead → manual` ではソフトリセットを行わず、最終音素の形状を維持する（次の Stop 押下まで）。

#### 3.4.5 既存 controls.ts への影響

既存 5 クラス（`Controls` / `PresetControls` / `SliderControls` / `VoiceQualityControls` / `AutoSingControls`）は責務を変えず、API 追加のみ:

```typescript
// PresetControls: setEnabled (既存) + setNoiseEnabled (新規)
// SliderControls: setF0Enabled / setVolumeEnabled / setEnabled (新規)
// VoiceQualityControls: setEnabled (新規)
// AutoSingControls: setEnabled / setBpmEnabled (新規)
// Controls: setEnabled (no-op、API 統一のみ)
```

これらは `disabled = !enabled` の薄いラッパで、複雑なロジックは `OperationModeManager` 側に集約する。

#### 3.4.6 TextReadControls クラス（新規）

```typescript
// controls.ts に追加
export class TextReadControls {
  constructor(
    textInput: HTMLTextAreaElement,
    textReadBtn: HTMLButtonElement,
    rateSlider: HTMLInputElement,
    rateValueEl: HTMLElement,
    onPlayRequested: (text: string, rate: number) => void,
    onStopRequested: () => void,
  );
  setPlaying(playing: boolean): void;     // 「読み上げ」⇔「停止」切替
  setEnabled(enabled: boolean): void;      // textarea + ボタン + スライダー一括
  getText(): string;
  getRate(): number;
  destroy(): void;
}
```

### 3.5 声道エディタの自動アニメーション連携

#### 3.5.1 main.ts での結線

```typescript
const operationMode = new OperationModeManager();
const timelineCanvas = new PhonemeTimelineCanvas(phonemeTimelineCanvasEl);
const phonemePlayer = new PhonemePlayer({ engine, tractEditor });

phonemePlayer.onPhonemeChange((event, index) => {
  tractEditor.setControlPoints(event.tractAreas);          // 1. 声道形状自動アニメ
  timelineCanvas.highlightAt(event.startTime);              // 2. タイムラインハイライト
  tractEditor.drawConstrictionMarker(                       // 3. 狭窄位置マーカー
    event.constrictionNoise?.position ?? null
  );
});

phonemePlayer.onComplete(() => {
  operationMode.setMode('manual');
  textReadControls.setPlaying(false);
});

operationMode.onChange((mode) => applyModeToUI(mode));

function applyModeToUI(mode: OperationMode): void {
  switch (mode) {
    case 'manual':    /* 全 UI enabled */    break;
    case 'autoSing':  /* tract/preset 無効、F0/Vol/Rd 残す */ break;
    case 'textRead':  /* tract/preset/F0/Vol/Rd/AutoSing 無効、textRead のみ残す */ break;
  }
}
```

#### 3.5.2 Auto Sing の TransitionManager との対比

Phase 4 の Auto Sing は `TransitionManager` を介して 16 ms 周期の rAF ループで `tractEditor.setControlPoints()` を呼ぶ。Phase 9 のテキスト読み上げは `phonemePlayer.onPhonemeChange` イベント駆動で、音素切替時のみ `setControlPoints` を呼ぶ離散更新方式とする。両者は AudioWorklet 側の `scheduleTransition` でサンプル精度補間されるため、UI 側の補間は不要。`TransitionManager` を再利用しない理由は (a) Phase 8 `phoneme-player` が既に音素単位イベントで動作している (b) 二重補間を避けて状態管理を単純化する (c) Phase 10 以降で UI 補間が必要になった時の再利用余地を残す、の 3 点。

### 3.6 style.css 拡張

`src/style.css` に以下を追加。新規 ID/クラスは `#text-read-controls` 配下に閉じ込める。

```css
#text-read-controls {
  display: flex; flex-direction: column; gap: 8px;
  margin-top: 12px; padding: 12px;
  background: #f8f8f8; border-radius: 6px;
}

#text-input {
  width: 100%; min-height: 3.5em; padding: 8px;
  font: 16px 'Hiragino Sans', 'Yu Gothic', sans-serif;
  border: 1px solid #ccc; border-radius: 4px; resize: vertical;
}
#text-input:disabled { background: #eee; color: #999; cursor: not-allowed; }

#text-read-btn {
  padding: 8px 16px; background: #4080c0; color: white;
  border: none; border-radius: 4px; cursor: pointer;
}
#text-read-btn:disabled { background: #aaa; cursor: not-allowed; }
#text-read-btn.playing { background: #c04040; }

#phoneme-timeline-canvas {
  width: 100%; height: 60px;
  background: #fff; border: 1px solid #ddd; border-radius: 4px;
}

#tract-canvas[data-mode='autoSing'],
#tract-canvas[data-mode='textRead'] {
  cursor: not-allowed; opacity: 0.85;
}
.preset-btn:disabled, input[type='range']:disabled {
  opacity: 0.4; cursor: not-allowed;
}
```

`#tract-canvas[data-mode='...']` は `OperationModeManager.onChange` から `tractCanvas.dataset.mode = mode` で設定し、CSS 側でカーソル・透明度を切替えることで「現在は声道ドラッグ無効」を視覚的に伝える。

---

## 4. 実装に必要なエージェントチーム

### 4.1 構成

4 名構成。前フェーズの「テキスト処理 / 韻律 / 再生 / 統合」という縦割り分担と異なり、Phase 9 では「UI 描画 / 状態管理 / 結線 / テスト」の横割り分担とする。

### 4.2 ui エージェント

| 項目 | 内容 |
|------|------|
| 担当ファイル | `index.html`, `src/style.css`, `src/ui/timeline-canvas.ts`, `src/ui/timeline-canvas.test.ts`, `src/ui/tract-editor.ts`（`drawConstrictionMarker` 追加のみ） |
| 入力 | Phase 8 の `PhonemeEvent[]` 型定義 |
| 出力 | DOM 構造 + CSS スタイル + 音素タイムライン Canvas 描画ロジック + 狭窄マーカー描画 |
| 完了条件 | (a) `index.html` に 4 要素追加 (b) `style.css` 新セクション追加 (c) `PhonemeTimelineCanvas` クラス動作とユニットテストパス (d) `tract-editor.ts` に `drawConstrictionMarker` 追加 |

### 4.3 state-management エージェント

| 項目 | 内容 |
|------|------|
| 担当ファイル | `src/ui/operation-mode.ts`, `src/ui/operation-mode.test.ts`, `src/ui/controls.ts`（既存 4 クラス API 追加 + `TextReadControls` 新規）, `src/ui/auto-singer/ui-controls.ts`, `src/types/index.ts` |
| 入力 | 要件定義 4.3 の enable/disable テーブル |
| 出力 | `OperationModeManager` クラス + 既存コントロール群への横断的 API 追加 |
| 完了条件 | (a) `OperationMode` 型定義 (b) `OperationModeManager` のユニットテストで全遷移パスをカバー (c) 既存 5 クラスに `setEnabled` 系 API 統一追加 (d) `TextReadControls` 新規追加 |

### 4.4 integration エージェント

| 項目 | 内容 |
|------|------|
| 担当ファイル | `src/main.ts`（Phase 8 の `play()` API と Phase 9 の各クラスを結線） |
| 入力 | ui / state-management エージェントの成果物 |
| 出力 | `phonemePlayer.onPhonemeChange` から `tractEditor` / `timelineCanvas` の協調呼び出し、`OperationModeManager.onChange` から全 UI 一括制御 |
| 完了条件 | (a) `main.ts` の Phase 9 統合コードが完成 (b) UI から textarea 入力 → 再生ボタン → 発声 が動作 (c) 3 モード遷移が UI レベルで動作 (d) 声道アニメ・ハイライト・狭窄マーカーの 3 つが同期 |

### 4.5 test エージェント

| 項目 | 内容 |
|------|------|
| 担当ファイル | `src/ui/operation-mode.test.ts`, `src/ui/timeline-canvas.test.ts`, E2E 検証スクリプト, performance.now() ベースのレイテンシ計測 |
| 入力 | 全エージェントの成果物 |
| 出力 | 単体テスト + E2E テスト + 性能計測結果 |
| 完了条件 | (a) `operation-mode.test.ts` で全遷移パスカバー (b) `timeline-canvas.test.ts` で座標計算・描画 API カバー (c) 5.4 の E2E 全件パス (d) レイテンシ 50 ms 以下、60 fps 維持を実測 |

### 4.6 エージェント間の依存関係

```
ui ─────────────┐
                 ├──→ integration ──→ test
state-management ─┘
```

`ui` と `state-management` は契約面（型定義 + クラス API）が確定すれば並行作業可能。型定義（`OperationMode`, `PhonemeTimelineCanvas` シグネチャ）は本チケットの 3.4.1 / 3.2.1 で先行確定済み。

---

## 5. 提供範囲とテスト項目

### 5.1 スコープ内

- ひらがな入力 textarea（IME 対応、最大 200 文字、placeholder）
- 再生/停止トグルボタン（disabled 制御込み）
- 速度スライダー（0.5x-2.0x、再生開始時の `rate` パラメータ反映）
- 音素タイムライン Canvas（横帯 + IPA ラベル + ハイライト + 2 層構造最適化）
- 声道エディタ上の狭窄位置マーカー（赤色縦マーカー）
- 声道エディタの自動アニメーション（音素切替時の瞬時反映）
- `OperationMode` 状態機械（manual / autoSing / textRead 排他制御）
- 既存 5 コントロールクラスへの `setEnabled` 系 API 統一追加
- `TextReadControls` クラス新規追加
- CSS による disabled 状態の視覚フィードバック
- キーボードフォーカス対応（Tab / Enter / aria-label）

### 5.2 スコープ外

- カタカナ・漢字入力 UI（Phase 10 申し送り）
- アクセント型選択 UI（頭高型・中高型等）
- 韻律パラメータの UI 編集（F0 曲線エディタ等）
- 録音 / wav エクスポート機能
- 音素タイムラインの手動編集（クリック挿入・ドラッグ持続時間変更）
- 再生中の速度スライダーによる動的速度変更
- ARIA Live Region による再生中音素の読み上げ
- 多言語 UI / レスポンシブデザイン / ダークモード

### 5.3 ユニットテスト

#### 5.3.1 operation-mode.test.ts

- 初期状態が `manual`
- `manual ⇄ autoSing` / `manual ⇄ textRead` の往復遷移成功
- `autoSing ↔ textRead` の直接遷移拒否（`canTransitionTo` が false）
- `onChange` コールバックが `(newMode, prevMode)` 引数で発火、複数登録対応
- 同モードへの再設定は no-op（`onChange` 非発火）

#### 5.3.2 timeline-canvas.test.ts

- インスタンス化、`render(events)` で OffscreenCanvas 描画（モック）
- 音素 index → x 座標変換: `events[i].startTime / totalDuration * canvas.width`
- セル幅: `events[i].duration / totalDuration * canvas.width`
- `highlightAt` の境界条件: `timeSec === 0`, `timeSec === totalDuration`, 範囲外
- `clear()` で Canvas 空に
- 空配列 `render([])` でエラーにならない
- 配色テーブル: 7 種それぞれの色適用確認

#### 5.3.3 controls.test.ts（既存に追加）

- `Controls.setEnabled` は no-op
- `PresetControls.setNoiseEnabled(false)` で Noise ボタン disabled
- `SliderControls.setF0Enabled` / `setVolumeEnabled` / `setEnabled` 動作確認
- `VoiceQualityControls.setEnabled` で Rd/Asp/Model 一括 disabled
- `AutoSingControls.setEnabled` / `setBpmEnabled` 動作確認
- `TextReadControls.setPlaying(true)` でラベル「停止」、`setEnabled(false)` で全要素 disabled、`getText()` / `getRate()` の値取得

#### 5.3.4 タイムライン Canvas 座標計算

- 時刻 → 音素 index 変換: 二分探索による現在音素特定
- ハイライト境界: `timeSec === 0`, `timeSec === totalDuration`, 範囲外

#### 5.3.5 狭窄位置マーカー座標算出

- 44 区間 index → Canvas x 座標変換（`tract-editor.ts` の `sectionIndexToCanvasX` 流用）
- 16 制御点 index と 44 区間 index の比例関係
- `null` 渡しで消去

### 5.4 E2E テスト

実 AudioContext + 実 Worklet + 実 DOM 使用。

| ID | 入力 | 期待動作 |
|----|------|---------|
| E1 | 「こんにちは」入力 → 再生ボタン | 5 音素以上が連続発声、タイムラインがハイライト移動、声道エディタ自動変形 |
| E2 | 再生中に停止ボタン | 即座に発声停止、声道形状中性ソフトリセット、`manual` 復帰 |
| E3 | Auto Sing 中にテキスト再生ボタン | 再生ボタンが disabled |
| E4 | テキスト再生中に Auto Sing ボタン | Auto Sing ボタンが disabled |
| E5 | テキスト再生中に声道エディタドラッグ | 反応せず、カーソル `not-allowed` |
| E6 | テキスト再生中に母音プリセット押下 | プリセットボタン disabled |
| E7 | 速度 2.0x で「こんにちは」 | 通常速度の 0.5 倍時間で再生完了 |
| E8 | 速度 0.5x で「こんにちは」 | 通常速度の 2 倍時間 |
| E9 | 「さくら」再生時のタイムライン | 6 音素のセル + 各 IPA ラベル + 持続時間比例 |
| E10 | 「し」発声時の狭窄位置マーカー | 歯茎硬口蓋位置 (idx 6-9 相当) に赤色縦マーカー |
| E11 | 再生ボタン → 初音発声レイテンシ | 50 ms 以下（performance.now() 計測） |
| E12 | 再生中の Canvas 描画フレームレート | 60 fps 維持（DevTools Performance タブ） |
| E13 | textarea 空時の再生ボタン | disabled |
| E14 | engine 停止中（Start 前）の再生ボタン | disabled |
| E15 | IME 入力中の再生ボタン | disabled (compositionstart 期間) |
| E16 | Tab キーで全 UI 巡回 | フォーカス順序が論理的 |

### 5.5 既存非退行テスト

- 母音プリセット 5 種が `manual` で正常動作
- Auto Sing が正常動作（`autoSing` 中の再生・停止・BPM 変更）
- スペクトル表示・フォルマント計算が全モードで正常動作
- F0 / Vol / Rd / Aspiration / Model 切替が `manual` で正常動作
- Phase 8 の `play()` API（DevTools 経由）が引き続き動作

### 5.6 性能計測

- レイテンシ: 再生ボタン押下 → engine 出力の最初の非ゼロサンプルまで 50 回計測、平均と最大記録
- 描画フレームレート: Performance タブで 30 秒間記録、95 パーセンタイル < 16 ms
- メモリリーク: 100 回連続再生後の Heap Snapshot で `PhonemeEvent` / `OffscreenCanvas` 残存数確認
- バンドルサイズ: 追加分が gzip 後 8 KB 以下

---

## 6. 実装に関する懸念事項とレビュー項目

### 6.1 3 モード排他制御の複雑性

**懸念**: 既存 5 クラス + 新規 `TextReadControls` の計 6 クラスに対し、3 モード × 6 クラス = 18 セルの enable/disable パターンが必要。各セルの enable 条件は単純な真偽値ではない（例: `autoSing` 中の F0 スライダーは「disabled に見えるが内部は基準値合算で残す」）。実装ミスで「`textRead` 中なのに F0 が誤って変更される」「`autoSing` 中なのに textarea が編集できる」等のバグが発生しやすい。既存 `PresetControls.setEnabled` は Phase 4 で既に追加済みのため、新規 `setNoiseEnabled` 追加時に既存 API との重複や責務分割で混乱しやすい問題も併発する。

**対策**: `applyModeToUI(mode)` を `main.ts` 内の単一関数として実装し、3 モード × 6 クラスを `switch` 文でハードコードする。テーブル駆動にせず、各モードの 6 行 API 呼び出しを明示的に書くことでレビュー時に全件目視確認できる。既存 `setEnabled` は「プリセットボタンのみ」と明確化し、新規 `setNoiseEnabled` は「Noise ボタンのみ」と責務分離する。`operation-mode.test.ts` で全遷移パターンを assert し、既存テストの非退行を確認する。

### 6.2 タイムライン Canvas のパフォーマンス

**懸念**: `onPhonemeChange` が数十 ms 周期で発火するため、毎回フル再描画すると 60 fps を割る。音素数が多い文（30 音素以上）では描画コストが線形増加する。1 文 20 音素を 1 秒で再生すると `onPhonemeChange` は 50 ms 間隔で発火し、Canvas 再描画 + `tractEditor.setControlPoints` を毎回呼ぶとメインスレッドが 16 ms 予算を超える可能性がある。

**対策**: 3.2.3 の 2 層 Canvas 構造を採用。静的レイヤを OffscreenCanvas で 1 回だけ描画し、動的レイヤは `drawImage(staticLayer)` + ハイライト矩形のみで O(1) 更新する。コールバック内では `setControlPoints` / `highlightAt` / `drawConstrictionMarker` の 3 操作のみ実行し、合計時間を Chrome DevTools で 95 パーセンタイル < 16 ms 確認。超過時は `requestAnimationFrame` でバッチ化を検討する。dirty rect 最適化は Phase 9 では実装複雑度を抑え、毎フレーム drawImage 全体再描画で十分な性能が出ることを確認後の改善として位置付ける。

### 6.3 テキスト再生中の声道ドラッグ禁止 UX

**懸念**: ドラッグを単純に `disabled` にすると、ユーザは「壊れたのか」「フォーカスが外れたのか」を判断できない。視覚的に「現在は操作できない」ことを伝える必要がある。

**対策**: 3 段階のフィードバック: (1) `cursor: not-allowed` (2) `opacity: 0.85` (3) `#status-text` に「読み上げ中」表示。CSS の `[data-mode='textRead']` セレクタで一括制御し、JS 側は `tractCanvas.dataset.mode = mode` を 1 行書くだけで済む実装にする。

### 6.4 AudioParam (F0) の競合

**懸念**: `phoneme-player` が F0 を制御中、F0 スライダーは UI 上 disabled だが内部的には Worklet が直接書き換えており、UI 表示と実 F0 値が乖離する。

**対策**: Phase 9 では「`textRead` 中の F0 スライダーは disabled 固定（表示も初期値のまま）」とする。リアルタイム表示連動は Phase 10 申し送り（`phonemePlayer.getCurrentF0()` API 追加 + rAF ポーリング）。

### 6.5 再生開始 → 発声レイテンシ < 50 ms

**懸念**: 要件定義 6 で「テキスト再生開始 → 発声 < 50 ms」が必須。Phase 8 で `play()` API 単体のレイテンシは確認済みだが、Phase 9 では UI 経由（再生ボタン押下 → click イベント → `onPlayRequested` → `play()` 呼び出し）の追加遅延が発生する可能性がある。

**対策**: 計測ポイントを (1) click イベント発火時刻 (2) `play()` 関数呼び出し時刻 (3) engine の最初の非ゼロサンプル出力時刻 の 3 つに分けて測定。3 - 1 の差を「ユーザ体感レイテンシ」とし 50 ms 以下を確認。click → `play()` の経路は単純な関数呼び出しなので 1 ms 以下に収まる想定。

### 6.6 アクセシビリティ

**懸念**: スクリーンリーダー対応・キーボード操作対応は要件定義に明記されていないが、Web アプリ品質確保のため最低限必要。

**対策**: Phase 9 のスコープに含める: (a) 全 input 要素に `aria-label` 付与 (b) ボタンに `type="button"` 明示 (c) Tab 順序は DOM 自然順 (d) `:focus-visible` フォーカスリング維持。ARIA Live Region による再生中音素読み上げは Phase 10 申し送り。

### 6.7 IME 入力 / OffscreenCanvas 互換性

**懸念**: 日本語 IME 入力中、未確定文字列がある状態で再生ボタンを押されると `play()` がパース失敗する可能性。OffscreenCanvas は Safari の古いバージョンで未対応。

**対策**: textarea の `compositionstart` / `compositionend` イベントを監視し、IME 入力中は再生ボタンを disabled にする。OffscreenCanvas は `typeof OffscreenCanvas !== 'undefined'` でランタイム検出し、未対応ブラウザでは通常 `<canvas>` を内部生成してフォールバック。性能は劣化するが機能は動作する。

---

## 7. 一から作り直すとしたらどうするか

Phase 9 を実装する段階で痛感する設計上の課題は、Phase 1 で `controls.ts` を「Start/Stop ボタンだけのシンプルな薄いコントローラ」として設計したことが、Phase 9 で「3 モード × 6 クラスの排他制御」という複雑な責務を抱える羽目になっていることである。Phase 1 時点では Auto Sing もテキスト読み上げも存在せず、UI コンポーネントは 1 種類のモード（手動操作）のみで動作するという暗黙の前提があった。Phase 4 で Auto Sing 追加時には「2 モード排他制御」が必要になったが、その時は Auto Sing と Manual の 2 モードしかなかったため ad hoc な `setEnabled` 追加で凌げた。Phase 9 で 3 モードに増えた結果、ad hoc な分岐が破綻寸前に膨れる。

一から作り直すなら、まず Phase 1 の段階で `OperationMode` を**有限状態機械（FSM）**として設計し、`Mode` という抽象クラスを定義する。各モードは `Mode.enter()` / `Mode.exit()` / `Mode.handleEvent(event)` の 3 メソッドを持ち、UI 要素の enable/disable は `Mode.enter()` 内で完結させる。Phase 1 の段階では `ManualMode` クラスのみ存在し、Phase 4 で `AutoSingMode` を追加、Phase 9 で `TextReadMode` を追加、という設計にする。`Mode` クラスは `ModeManager` から呼び出され、`ModeManager` が遷移可能性とコールバック発火を担当する。これにより各モードの責務が明確化され、新モード追加が「新クラスを 1 つ書くだけ」で済む構造になる。

UI コンポーネント側も、Phase 1 から Observer パターンで `OperationMode` 変更を購読する設計にする。`Controls` / `PresetControls` / `SliderControls` / `VoiceQualityControls` の各クラスがコンストラクタで `ModeManager` を受け取り、`modeManager.subscribe((mode) => this.applyMode(mode))` を呼ぶ。`applyMode(mode)` は各クラスが個別に実装し、自分が反応すべきモード変更だけを処理する。これにより `main.ts` の `applyModeToUI(mode)` のような神関数は不要になり、責務が各クラスに分散する。Phase 9 の現設計では `main.ts` の `switch` 文に全モードの処理を集中させているが、Observer パターンであれば「`PresetControls` は `manual` 以外で disabled」というロジックが `PresetControls` クラス内に閉じ、レビューしやすくなる。6 クラスを統合する別案として `AppController` という単一 facade クラスを作る選択肢もあるが、内部結合度が高く god class 化しやすいため、Observer パターンの方が拡張性で勝る。

Canvas 描画層についても、Phase 1 で `CanvasLayer` 基底クラスを設計しておくべきだった。現在は `tract-editor.ts` / `spectrum-display.ts` / `phoneme-timeline-canvas.ts`（Phase 9 新規）の 3 つの Canvas 描画クラスがそれぞれ独自に「Canvas サイズ追従 (ResizeObserver)」「devicePixelRatio 対応」「OffscreenCanvas 利用判定」「アニメーション更新ループ」を実装している。これらは全て同じパターンで、`CanvasLayer.setupCanvas(canvas)` で初期化、`CanvasLayer.requestRedraw()` で再描画予約、`CanvasLayer.draw(ctx)` を派生クラスが実装、という構造の基底クラスとして抽出できる。さらにタイムライン Canvas の汎用化も視野に入れるべきで、Phase 9 の `PhonemeTimelineCanvas` は本質的に「時刻 - イベント列を横帯で表示する汎用部品」であり、汎用 `TimelineCanvas<T>` クラス（`render(events: T[], colorOf, labelOf)`）にすれば「F0 タイムライン」「振幅エンベロープ」「スペクトログラム」も同じ基盤で描画できる。Phase 9 では `PhonemeTimelineCanvas` 専用実装で進めるが、内部設計を将来汎用化しやすい構造（描画ロジックと色決定ロジックの分離）にしておく。

Flux/Redux 的な単一ストア設計についても言及しておく。現在のプロジェクトは状態管理ライブラリを使わず、`tractEditor` / `engine` / `autoSinger` / `phonemePlayer` などが各自の内部状態を持ち、メッセージパッシングで連携する分散型である。Phase 9 で 3 モード × 6 クラスの状態が絡むと「どこに真の状態があるのか」が分かりづらくなる。一から作り直すなら、Zustand のような軽量ストアライブラリ（バンドルサイズ 1 KB 以下）を導入し、`{ mode, isPlaying, currentPhonemeIndex, f0, volume, ... }` のような単一ストアで管理する設計を検討する。但し YAGNI 観点では Phase 9 までの規模では分散型で十分動作する。Web Component 化（`<text-read-controls>` 等のカスタム要素）も理論的選択肢だが、Shadow DOM の CSS 共有困難性が `style.css` 単一管理と相性が悪く、本フェーズでは採用しない。

3 モードの抽象化レベルについて。`manual` モードは「停止中の `textRead` モード」「停止中の `autoSing` モード」とも捉えられる。つまり厳密には 3 モードではなく「`autoSing.state ∈ { stopped, playing }` × `textRead.state ∈ { stopped, playing }` × 排他制約」という 2 軸の状態である。但しこの設計は状態空間が複雑化（4 状態のうち 1 つは禁止）し UI 側のロジックが分かりづらくなるため、Phase 9 では「3 値の単純な enum」を採用する。レイアウトシステムについても、現在の `display: flex` 素朴配置を CSS Grid + `grid-template-areas` の 4 領域定義に置き換える案があり、レスポンシブ対応や将来的なパネル位置変更が容易になるが、Phase 9 では既存 flex レイアウトを尊重し `#text-read-controls` を `#auto-sing-controls` 直下に追加するだけで進める。

最後に、Phase 9 を一から作り直す観点で最も価値があるのは「**Phase 1 から OperationMode を State Machine として設計しておく**」という 1 点に尽きる。それ以外（`CanvasLayer` 基底クラス、`AppContext`、Web Component 化、Redux 的ストア）は YAGNI 違反になりがちで、Phase 1 時点では正解が分からない。OperationMode の State Machine 化だけは「いずれ複数モードになる」ことが Phase 1 の段階でも予測可能（Auto Sing は要件定義時点で計画されていた）であり、Phase 1 から導入する正当性がある。本セクションの教訓は、過去フェーズへの遡及修正提案ではなく、**次の声道シンセサイザー風プロジェクトの Phase 1 設計指針**として記録すべきものである。

---

## 8. 後続タスクへの連絡事項

### 8.1 Phase 10 以降の拡張可能性

Phase 9 完了をもって REQUIREMENTS.md と REQUIREMENTS_CONSONANT_TTS.md の全 UI 要件は満たされる。以降は機能拡張フェーズへ移行する。

| # | 候補機能 | 概要 |
|---|---------|------|
| 8.1.1 | カタカナ・漢字対応 | `text-parser.ts` 前段にカタカナ→ひらがな変換テーブル追加で容易。漢字は kuromoji.js (~5 MB) または WASM 形態素解析の組み込み検討 |
| 8.1.2 | アクセント型選択 UI | 頭高型/中高型/尾高型/平板型のラジオボタンを追加し、`phoneme-timeline.ts` の F0 計算ルールを動的切替。NHK アクセント辞典連携も視野 |
| 8.1.3 | 音素タイムライン手動編集 | クリックで音素挿入、ドラッグで持続時間変更、ダブルクリックで音素種類変更等。`EditablePhonemeTimelineCanvas` 派生クラス案 |
| 8.1.4 | 録音 / WAV エクスポート | `OfflineAudioContext` + wav エンコーダで非リアルタイム合成。Phase 8 の `phoneme-player.ts` を `AbstractClock` インタフェース化してから着手 |
| 8.1.5 | 複数話者対応 | 男声/女声/子供のセレクト追加。`TUBE_LENGTH_CM` (17.5/14.5 cm)、`basePitch` (110/220 Hz)、`Rd` (1.0/1.4) 等のプリセット差分 |
| 8.1.6 | MIDI / OSC 入力 | Web MIDI API で F0 制御、Web Socket OSC で外部アプリから声道形状制御 |
| 8.1.7 | リアルタイム音声→音素変換（逆方向） | マイク入力から音素推定し声道形状表示。Web Speech API または Whisper.cpp WASM 版 |
| 8.1.8 | タブ非アクティブ時の自動 pause | `document.visibilitychange` で `phonemePlayer.pause()` 自動発火。Phase 8 懸念 6.4 記録済み |
| 8.1.9 | 動的速度変更 | 再生中にスライダーで速度を変更 → `phonemePlayer.setRate(newRate)` API 追加が必要 |
| 8.1.10 | F0 リアルタイム表示連動 | Phase 9 懸念 6.5 記録済み。`phonemePlayer.getCurrentF0()` + rAF ポーリングで実装 |

### 8.2 Phase 6/7/8 への遡及修正の有無

Phase 9 着手時に以下の前準備が必要になる:

- `tract-editor.ts` の `drawConstrictionMarker` 追加は Phase 9 の責務だが、API 形状によっては Phase 6 段階で先行追加することも検討可能（Phase 6 の子音手動トリガー UI で狭窄位置の視覚化が欲しい場合）
- `PhonemeEvent.constrictionNoise.position` が 16 制御点ではなく 44 区間 index で持たれていることを確認（PHASE8-001 6.9 参照）
- `phonemePlayer.onPhonemeChange` のシグネチャが `(event, index) => void` であることを確認（Phase 8 仕様で確定済み）
- `play(text, opts)` の `opts.rate` が Phase 8 で受理可能になっていることを確認（PHASE8-001 8.1 申し送り）

これらは全て小規模変更であり、Phase 9 の前準備として扱う。

### 8.3 リファクタリング候補

Phase 9 完了時点で以下を Phase 10 以降に申し送る（本フェーズスコープ外）:

- `main.ts` を 350 行以内に収めるための `src/app/index.ts` 統合層の新設
- `controls.ts` の責務肥大化への対応（クラスごとのファイル分割）
- `CanvasLayer` 基底クラスの抽出（`tract-editor` / `spectrum-display` / `phoneme-timeline-canvas` の共通化）
- `OperationMode` の Observer パターン化（現在は `main.ts` の `applyModeToUI` 関数集中型）
- 状態管理ライブラリ（Zustand 等）の導入検討

Phase 9 では「動作する完成形 UI」を優先し、リファクタリングは Phase 10 で「機能追加の前段」として 1 フェーズ挟むことを推奨する。

### 8.4 ユーザビリティテスト

Phase 9 完了後、5 名以上の被験者によるユーザビリティテストを推奨。テスト項目: (1) textarea にひらがな入力できるか（IME 含む） (2) 再生ボタンを見つけて押下できるか (3) 速度スライダーの存在に気付くか (4) タイムライン表示の意味を理解できるか (5) Auto Sing と テキスト読み上げの違いを認識できるか (6) disabled UI の理由を理解できるか。これらの結果を Phase 10 の改善優先度に反映する。
