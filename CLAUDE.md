# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

声道の物理モデル（source-filter model）をリアルタイムに操作し、人工音声を生成するブラウザベースのWebアプリ。声門音源 + 声道フィルタ（連結管モデル / Kelly-Lochbaum アルゴリズム）による音声合成を、ドラッグ操作で直感的に行える「声の楽器」。
Phase 6-9 で子音（狭窄ノイズ）、鼻腔管結合、そして任意のひらがなテキストを発声するテキスト読み上げパイプラインまで実装済み。

- 要求定義: `REQUIREMENTS.md`
- 技術調査: `TECHNICAL_RESEARCH.md`

## 技術スタック

- **言語**: TypeScript（Vanilla、フレームワークなし）
- **音声合成**: Web Audio API（AudioWorklet で低レイテンシ処理）
- **描画**: HTML5 Canvas（声道エディタ + 2層スペクトル表示 + タイムライン表示）
- **ビルド**: Vite（vanilla-ts テンプレート）
- **テスト**: Vitest
- **デプロイ**: GitHub Pages（静的ファイルのみ、サーバー不要）

## プロジェクト構造

```
src/
  main.ts                          # エントリポイント（全モジュール結線 + window.play 公開）
  style.css                        # 暗色テーマCSS
  audio/
    engine.ts                      # AudioContext管理、ノード接続、postMessage、rampFrequency
    parameters.ts                  # AudioParam定義 (frequency: k-rate)
    worklet-processor.ts           # AudioWorkletProcessor (声門音源 + 声道 + 鼻腔 + 狭窄ノイズ + サンプル精度補間)
    consonant-presets.ts           # 22音素 (破裂/摩擦/鼻音等) のプリセット
    consonant-presets.test.ts
  models/
    glottal-source.ts              # KLGLOTT88声門音源 (27/4 * t²(1-t), OQ制御)
    lf-source.ts                   # LF声門モデル (Rd制御, Newton-Raphson for α/ε)
    vocal-tract.ts                 # 44区間Kelly-Lochbaum + 3ポートSmith接合 + 狭窄ノイズ注入
    nasal-tract.ts                 # 30区間固定断面積の鼻腔管 (Phase 7)
    nasal-tract.test.ts
    vowel-presets.ts               # 5母音プリセット + TransitionManager (コサイン補間)
    formant-calculator.ts          # 伝達行列フォルマント計算 (512点, 50-5000Hz)
    formant-controller.ts          # dirty flag + rAF + 80ms throttle フォルマント更新
  text/                            # Phase 8: テキスト → 音素 → 発声
    text-parser.ts                 # ひらがな 110 エントリ最長一致 + 撥音 lookahead
    text-parser.test.ts
    phoneme-timeline.ts            # PhonemeEvent 生成 + 韻律 (F0/持続時間/強度)
    phoneme-timeline.test.ts
    phoneme-player.ts              # AudioContext.currentTime 基準の再生エンジン
    phoneme-player.test.ts
  ui/
    tract-editor.ts                # 16制御点Canvas + スプライン補間 + setControlPointsVisualOnly
    controls.ts                    # Controls, PresetControls, SliderControls, VoiceQualityControls, TextReadControls
    spectrum-display.ts            # 2層Canvas FFTスペクトル + フォルマントマーカー
    timeline-canvas.ts             # Phase 9: PhonemeTimelineCanvas (2層Canvas タイムライン)
    timeline-canvas.test.ts
    operation-mode.ts              # Phase 9: manual/autoSing/textRead 3値状態機械
    operation-mode.test.ts
    auto-singer/
      index.ts                     # 統合コーディネータ (lookahead scheduling)
      melody-generator.ts          # ペンタトニック・マルコフ連鎖
      rhythm-engine.ts              # BPM/音符長/マイクロタイミング
      expression-engine.ts          # ビブラート/ポルタメント/jitter/shimmer
      phrase-manager.ts             # フレーズ/ADSR/ブレス
      vowel-sequencer.ts            # 母音ランダム選択
      ui-controls.ts                # Auto Singボタン + BPMスライダー
  types/
    index.ts                       # 物理定数、WorkletMessage、OperationMode、PhonemeEvent、ConsonantId
```

## アーキテクチャ

### スレッド分離

```
[メインスレッド]                             [AudioWorklet スレッド]
TractEditor (16制御点Canvas)                  VocalTractProcessor
  → スプライン補間 → 44区間断面積               声門音源 (KLGLOTT88 / LF 切替 + ジッター/シマー)
  → postMessage で送信 ──────────→             → 44区間Kelly-Lochbaum (Smith式1乗算)
                                                → 3ポートSmith接合 → NasalTract (30区間, velum制御)
TextReadControls / window.play                  → 狭窄ノイズ注入 (LCG + Biquad BPF)
  → parseHiragana → generateTimeline            → 放射フィルタ → 出力
  → PhonemePlayer → engine/worklet              サンプル精度補間:
                                                  scheduleTransition で 5-20ms 区間を線形補間
SpectrumDisplay (2層Canvas)
  ← AnalyserNode (fftSize:2048)
FormantController (伝達行列方式, 80ms throttle)
Auto Singer (setInterval 25ms + rAF 2系統)
PhonemeTimelineCanvas (Phase 9, タイムライン描画)
OperationModeManager (manual/autoSing/textRead 排他制御)
```

### ノード接続グラフ

```
AudioWorkletNode (VocalTractProcessor)
  → GainNode (音量制御)
    → AnalyserNode (fftSize:2048, smoothing:0.6)
      → AudioContext.destination
```

### 通信プロトコル (WorkletMessage 判別共用体)

メインスレッド → Worklet への postMessage で以下の型を送信:

| type | パラメータ | 用途 |
|------|-----------|------|
| `setAreas` | `areas: ArrayLike<number>` (44要素) | 断面積更新 (MIN_AREA_PROGRAM=0.01 までクランプ) |
| `setSourceType` | `sourceType: 'voiced' \| 'noise'` | 有声/無声切替 |
| `setOQ` | `oq: number` (0.3-0.8) | Open Quotient |
| `setGlottalModel` | `model: 'klglott88' \| 'lf'` | 声門モデル切替 |
| `setRd` | `rd: number` (0.3-2.7) | LFモデル声質 |
| `setAspiration` | `level: number` (0.0-1.0) | 気息成分 |
| `setJitter` | `amount: number` (0.0-0.015) | F0微小変動 |
| `setShimmer` | `amount: number` (0.0-0.020) | 振幅微小変動 |
| `setConstrictionNoise` | `position, intensity, centerFreq, bandwidth` | 狭窄ノイズ注入 (Phase 6) |
| `scheduleTransition` | `targetAreas, targetVelumArea?, durationSamples` | サンプル精度遷移 (Phase 6) |
| `cancelTransition` | — | 進行中の遷移キャンセル (Phase 6) |
| `setNasalCoupling` | `velopharyngealArea: number` | velum 開度 (Phase 7) |

- **F0**: AudioParam (k-rate)。`engine.setFrequency()` / `engine.rampFrequency()` で制御
- **スペクトルデータ**: AnalyserNode のブラウザネイティブ FFT を SpectrumDisplay が rAF で読み取り

### 声門音源モデル

- **KLGLOTT88**: `6.75 * t_n² * (1 - t_n)`、OQ 0.3-0.8、閉鎖相で 0
- **LF**: `E(t) = E0 * exp(α*t) * sin(ω_g*t)` (開放相) + 指数回復相。Rd 0.3-2.7 で Pressed/Modal/Breathy を連続制御。Newton-Raphson (max 10反復) で α/ε を求解
- **切替**: ゼロクロスタイミング (phase >= 1.0 の周期開始時) で安全に実行
- **気息ノイズ**: LCG 乱数 + 2次 IIR BPF (中心 2000Hz, Q=0.7)。aspiration レベルで混合量制御
- **有声/無声クロスフェード**: CROSSFADE_SAMPLES=330 (約7.5ms) で線形遷移

### 子音生成 (Phase 6)

- **狭窄ノイズ**: VocalTract 内で LCG 乱数 + 2次 Biquad BPF (位置/中心周波数/帯域幅指定、約 8 ops/sample)。破裂音 /p,t,k/ や摩擦音 /s,ɕ,h/ に対応
- **MIN_AREA_PROGRAM = 0.01 cm²**: UI ドラッグ下限 (MIN_AREA=0.3) とは別経路。`setAreas` メッセージ経由で子音の完全閉鎖を許可
- **プリセット**: `src/audio/consonant-presets.ts` に 22音素。Phase 6 で 19 音素、Phase 7 で鼻音 /m/, /n/, /ɲ/ を追加
- **サンプル精度補間**: `scheduleTransition` で 5-20ms の子音→母音遷移を quantum (128サンプル) 境界より細かく実行
- **デモ API**: `engine.playConsonant()` (Phase 6 追加、開発用)

### 鼻腔管 (Phase 7)

- **NasalTract クラス**: 30 区間、固定断面積 (成人男性モデル)、`NASAL_SECTION_LENGTH ≈ 0.38 cm`
- **3 ポート Smith 接合**: 口腔44区間の `NASAL_JUNCTION_INDEX=24` (軟口蓋位置) で分岐。velum 開度 (velopharyngealArea) に応じた反射/透過係数を計算
- **velum 閉鎖最適化**: `velopharyngealArea === 0` のとき鼻腔管の更新をスキップし、Phase 6 までの非退行を保証
- **鼻音プリセット**: /m/ (両唇閉鎖 + velum 開放)、/n/ (歯茎閉鎖)、/ɲ/ (硬口蓋閉鎖) を consonant-presets.ts に追加

### テキスト読み上げパイプライン (Phase 8)

```
text
  → parseHiragana         (text-parser.ts: 110 エントリ最長一致 + 撥音 lookahead)
  → generateTimeline      (phoneme-timeline.ts: PhonemeEvent[] + F0/持続時間/強度)
  → PhonemePlayer.load    (phoneme-player.ts: AudioContext.currentTime 基準スケジュール)
  → engine / worklet      (rampFrequency / setPhonemeAmplitude / scheduleTransition 等)
```

- **パーサ**: `src/text/text-parser.ts` — 「っ/ん/ー」などの特殊処理、撥音の後続子音同化 ([m]/[n]/[ŋ]/[ɴ])
- **タイムライン**: `src/text/phoneme-timeline.ts` — 母音/子音の持続時間、F0 軌跡、アクセント強調を PhonemeEvent として列挙
- **プレイヤー**: `src/text/phoneme-player.ts` — `currentTime` 基準で各イベントを scheduleTransition / rampFrequency / setPhonemeAmplitude に分配
- **公開 API**: `main.ts` で `export async function play(text, opts?)` + `window.play` を公開。DevTools からも `window.play("こんにちは")` で呼び出し可能
- **エンジン対応**: `engine.ts` で `rampFrequency` 追加、`currentUserVolume` と `currentPhonemeAmp` を分離し積として最終ゲインに反映

### テキスト読み上げ UI (Phase 9)

- **PhonemeTimelineCanvas** (`timeline-canvas.ts`): 2層 Canvas (背景 + 進行線)。音素区間と狭窄マーカー (`drawConstrictionMarker`) を描画
- **OperationModeManager** (`operation-mode.ts`): `manual | autoSing | textRead` の 3 値状態機械。autoSing↔textRead の直接遷移を禁止し、必ず manual を経由
- **TextReadControls** (`controls.ts`): テキスト入力欄、再生/停止ボタン、プリセット文を提供
- **setEnabled API 群**: 各 UI クラスに一括有効/無効化 API を追加し、OperationModeManager から排他制御
- **setControlPointsVisualOnly** (`tract-editor.ts`, Phase 9 レビュー対応): UI 上の制御点描画のみ更新し Worklet への postMessage を抑制。scheduleTransition 実行中の UI 追従と副作用回避を両立

### フォルマント計算

- **方式**: 伝達行列 — 各区間を円筒管としてモデル化、2x2複素行列を周波数ごとに積算
- **評価点**: 512点 (50-5000Hz)、パラボリックピーク検出でサブサンプル精度
- **境界条件**: 唇端=完全開放 (圧力=0)、声門端=完全閉鎖 (体積速度=0)
- **更新制御**: FormantController が dirty flag + rAF + 80ms throttle (~12fps) で間引き
- 旧方式の LPC 根探索 (areasToReflectionCoeffs / reflectionToLpc) はエクスポート維持

### Auto Singer

- **スケジューリング**: 2系統 — setInterval(25ms) lookahead 100ms + rAF で描画同期更新
- **旋律**: ペンタトニック・マルコフ連鎖 + 音楽理論制約 (音域制限、跳躍後の反転)
- **表現**: ビブラート 5.5Hz / ±30cent、ポルタメント 50-200ms (対数空間コサイン、65%確率)
- **微小変動**: ジッター 0.5-1.5%、シマー 0.5-2.0% (LCG 独立シード)
- **母音**: VowelSequencer がランダム選択、TransitionManager でコサイン補間遷移

## 重要な設計判断

- **区間数 N=44** (fs=44100Hz での物理的に正しい離散化: c/(2*fs) ≈ 0.4cm/区間)
- **2半ステップ/サンプル**: 1サンプル内で半ステップを2回実行。片道 N/2 サンプルの伝搬遅延で均一管 F1=500Hz が得られる
- UI 上は 16 制御点を表示し、自然3次スプライン補間で 44 区間へ展開
- 断面積配列は唇側 index=0、声門側 index=N-1
- 壁面損失 mu=0.999 を各区間に適用
- **MIN_AREA 二段化**: UI ドラッグは 0.3 cm²、プログラム制御 (setAreas/子音) は 0.01 cm² までクランプ
- **3 ポート Smith 接合**: velum=0 で鼻腔管計算を完全スキップし Phase 6 と非退行
- **Worklet サンプル精度補間**: `scheduleTransition` で quantum 内補間、子音の 5-20ms 遷移を実現
- **setControlPointsVisualOnly**: UI 描画のみ更新し Worklet への副作用を回避 (Phase 9 レビュー対応)
- **OperationMode 排他制御**: manual/autoSing/textRead の 3 値状態機械、autoSing↔textRead 直接遷移禁止
- process() は常に true を返す (Chrome 互換性: false を返すとプロセッサが破棄される)
- process() 内でメモリアロケーション禁止 (new / [] / {} 厳禁、GC 回避)
- AudioContext 生成は Start ボタンの click イベント内 (Autoplay Policy)
- SharedArrayBuffer は不使用 (GitHub Pages 互換性)
- OQ 変更は閉鎖相まで遅延、LF パラメータ更新は声門周期開始時のみ

### 状態管理

- **断面積の正状態**: メインスレッド側の 16 制御点 (`TractEditor`) が source of truth。44 区間はスプライン補間の導出値。Worklet 側は postMessage で受信したレプリカ
- **音量の分離**: `engine.currentUserVolume` (UI スライダー) と `currentPhonemeAmp` (PhonemePlayer) を分離し、積として GainNode に反映
- **アプリ状態**: Idle → Initializing → Running → Error の 4 状態。`Controls` クラスが UI 反映を担当
- **操作モード**: OperationModeManager が manual/autoSing/textRead を排他管理。モード遷移時に各 UI の setEnabled を呼び出し

## AudioWorklet のビルド

Vite の `?worker&url` サフィックスでワーカーファイルを JS にトランスパイル・バンドルし、URL を取得:

```typescript
import workletUrl from './worklet-processor.ts?worker&url';
await ctx.audioWorklet.addModule(workletUrl);
```

## 物理定数 (types/index.ts)

| 定数 | 値 | 用途 |
|------|-----|------|
| `VOCAL_TRACT_LENGTH` | 17.5 cm | 成人男性の声道長 |
| `SPEED_OF_SOUND` | 35000 cm/s | 体温下の音速 |
| `SAMPLE_RATE` | 44100 Hz | サンプリングレート |
| `NUM_SECTIONS` | 44 | 口腔離散化区間数 |
| `NUM_CONTROL_POINTS` | 16 | UI 制御点数 |
| `MIN_AREA` | 0.3 cm² | UI ドラッグ下限 |
| `MIN_AREA_PROGRAM` | 0.01 cm² | プログラム制御下限 (子音閉鎖用) |
| `NASAL_NUM_SECTIONS` | 30 | 鼻腔管区間数 |
| `NASAL_JUNCTION_INDEX` | 24 | 鼻腔接合点 (軟口蓋位置) |
| `WALL_LOSS_FACTOR` | 0.999 | 壁面損失係数 |
| `GLOTTAL_REFLECTION` | 0.95 | 声門端反射係数 |
| `LIP_REFLECTION` | -0.85 | 唇端反射係数 |
| `RADIATION_ALPHA` | 0.97 | 放射フィルタ係数 |

## 言語

コード中のコメント・UI テキストは日本語。変数名・関数名は英語。
