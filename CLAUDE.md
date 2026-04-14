# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

声道の物理モデル（source-filter model）をリアルタイムに操作し、人工音声を生成するブラウザベースのWebアプリ。声門音源 + 声道フィルタ（連結管モデル / Kelly-Lochbaum アルゴリズム）による音声合成を、ドラッグ操作で直感的に行える「声の楽器」。Auto Sing モードではペンタトニック旋律を自動生成し、母音を歌い分ける。

- 要求定義: `REQUIREMENTS.md`
- 技術調査: `TECHNICAL_RESEARCH.md`

## 技術スタック

- **言語**: TypeScript（Vanilla、フレームワークなし）
- **音声合成**: Web Audio API（AudioWorklet で低レイテンシ処理）
- **描画**: HTML5 Canvas（声道エディタ + 2層スペクトル表示）
- **ビルド**: Vite（vanilla-ts テンプレート）
- **デプロイ**: GitHub Pages（静的ファイルのみ、サーバー不要）

## プロジェクト構造

```
src/
  main.ts                          # エントリポイント（全モジュール結線）
  style.css                        # 暗色テーマCSS
  vite-env.d.ts
  audio/
    engine.ts                      # AudioContext管理、ノード接続、postMessage
    parameters.ts                  # AudioParam定義 (frequency: k-rate)
    worklet-processor.ts           # AudioWorkletProcessor (KLGLOTT88/LF切替)
  models/
    glottal-source.ts              # KLGLOTT88声門音源 (27/4 * t²(1-t), OQ制御)
    lf-source.ts                   # LF声門モデル (Rd制御, Newton-Raphson for α/ε)
    vocal-tract.ts                 # 44区間Kelly-Lochbaum (2半ステップ/サンプル)
    vowel-presets.ts               # 5母音プリセット + TransitionManager (コサイン補間)
    formant-calculator.ts          # 伝達行列フォルマント計算 (512点, 50-5000Hz)
    formant-controller.ts          # dirty flag + rAF + 80ms throttle フォルマント更新
  ui/
    tract-editor.ts                # 16制御点Canvas + 自然3次スプライン補間
    controls.ts                    # Controls, PresetControls, SliderControls, VoiceQualityControls
    spectrum-display.ts            # 2層Canvas FFTスペクトル + フォルマントマーカー
    auto-singer/
      index.ts                     # 統合コーディネータ (lookahead scheduling)
      melody-generator.ts          # ペンタトニック・マルコフ連鎖
      rhythm-engine.ts             # BPM/音符長/マイクロタイミング
      expression-engine.ts         # ビブラート/ポルタメント/jitter/shimmer
      phrase-manager.ts            # フレーズ/ADSR/ブレス
      vowel-sequencer.ts           # 母音ランダム選択
      ui-controls.ts               # Auto Singボタン + BPMスライダー
  types/
    index.ts                       # 物理定数、WorkletMessage判別共用体、GlottalModel
```

## アーキテクチャ

### スレッド分離

```
[メインスレッド]                         [AudioWorklet スレッド]
Canvas UI (16制御点)                      VocalTractProcessor
  → スプライン補間 → 44区間断面積           声門音源 (KLGLOTT88 / LF 切替)
  → postMessage で送信 ──────────→         ジッター/シマー適用
                                           → Kelly-Lochbaum (44区間, Smith式1乗算)
SpectrumDisplay (2層Canvas)                  → 放射フィルタ → 出力
  ← AnalyserNode (fftSize:2048)
FormantController (伝達行列方式)
  断面積 → 512点スペクトル評価
  → パラボリックピーク検出 → F1/F2/F3
Auto Singer (setInterval 25ms + rAF 2系統)
  → engine.setFrequency / sendAreas / setJitter / setShimmer
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
| `setAreas` | `areas: ArrayLike<number>` (44要素) | 断面積更新 |
| `setSourceType` | `sourceType: 'voiced' \| 'noise'` | 有声/無声切替 |
| `setOQ` | `oq: number` (0.3-0.8) | Open Quotient |
| `setGlottalModel` | `model: 'klglott88' \| 'lf'` | 声門モデル切替 |
| `setRd` | `rd: number` (0.3-2.7) | LFモデル声質 |
| `setAspiration` | `level: number` (0.0-1.0) | 気息成分 |
| `setJitter` | `amount: number` (0.0-0.015) | F0微小変動 |
| `setShimmer` | `amount: number` (0.0-0.020) | 振幅微小変動 |

- **F0**: AudioParam (k-rate) で送信。`engine.setFrequency()` → `frequencyParam.setValueAtTime()`
- **スペクトルデータ**: AnalyserNode のブラウザネイティブ FFT を SpectrumDisplay が rAF で読み取り

### 声門音源モデル

- **KLGLOTT88**: `6.75 * t_n² * (1 - t_n)`、OQ 0.3-0.8、閉鎖相で 0
- **LF**: `E(t) = E0 * exp(α*t) * sin(ω_g*t)` (開放相) + 指数回復相。Rd 0.3-2.7 で Pressed/Modal/Breathy を連続制御。Newton-Raphson (max 10反復) で α/ε を求解
- **切替**: ゼロクロスタイミング (phase >= 1.0 の周期開始時) で安全に実行
- **気息ノイズ**: LCG 乱数 + 2次 IIR BPF (中心 2000Hz, Q=0.7)。aspiration レベルで混合量制御
- **有声/無声クロスフェード**: CROSSFADE_SAMPLES=330 (約7.5ms) で線形遷移

### フォルマント計算

- **方式**: 伝達行列 (transmission matrix) 方式 — 各区間を円筒管としてモデル化し、2x2複素行列を周波数ごとに積算
- **評価点**: 512点 (50-5000Hz)、パラボリックピーク検出でサブサンプル精度
- **境界条件**: 唇端=完全開放 (圧力=0)、声門端=完全閉鎖 (体積速度=0)
- **更新制御**: FormantController が dirty flag + rAF + 80ms throttle (~12fps) で間引き
- 旧方式の LPC 根探索 (areasToReflectionCoeffs / reflectionToLpc) はエクスポート維持

### Auto Singer

- **スケジューリング**: 2系統 — setInterval(25ms) + rAF
  - 系統1 (setInterval): Chris Wilson "A Tale of Two Clocks" パターン。lookahead 100ms でノートイベントを先読みスケジュール
  - 系統2 (rAF): ビブラート/ポルタメント/ADSR エンベロープの描画同期更新、engine への F0 反映
- **旋律**: ペンタトニック・マルコフ連鎖 + 音楽理論制約 (音域制限、跳躍後の反転)
- **表現**: ビブラート 5.5Hz / +-30cent (200ms ディレイ後 100ms フェードイン)、ポルタメント 50-200ms (跳躍幅比例、対数空間コサイン補間、65%確率)
- **微小変動**: ジッター 0.5-1.5%、シマー 0.5-2.0% (LCG 独立シードで相関回避)
- **母音**: VowelSequencer がランダム選択、TransitionManager でコサイン補間遷移
- **競合制御**: Auto Sing 中は声道ドラッグと母音プリセットボタンを無効化。F0 スライダーは基準値として合算

## 重要な設計判断

- **区間数 N=44** (fs=44100Hz での物理的に正しい離散化: c/(2*fs) ≈ 0.4cm/区間)
- **2半ステップ/サンプル**: 1サンプル内で半ステップを2回実行。片道 N 区間 = N/2 サンプルの伝搬遅延で正しい共鳴周波数 (均一管 F1=500Hz) が得られる
- UI 上は 16 制御点を表示し、自然3次スプライン補間で 44 区間へ展開
- 断面積配列は唇側 index=0、声門側 index=N-1
- 壁面損失 mu=0.999 を各区間に適用
- 断面積下限: 0.3 cm² (ゼロ除算防止)
- process() は常に true を返す (Chrome 互換性: false を返すとプロセッサが破棄される)
- process() 内でメモリアロケーション禁止 (new / [] / {} 厳禁、GC 回避)
- AudioContext 生成は Start ボタンの click イベント内 (Autoplay Policy)
- SharedArrayBuffer は不使用 (GitHub Pages 互換性)
- OQ 変更は閉鎖相まで遅延 (開放相途中の波形不連続を防止)
- LF モデルのパラメータ更新は声門周期開始時 (phase >= 1.0) のみ

### 状態管理

- **断面積の正状態**: メインスレッド側の 16 制御点 (`TractEditor`) が source of truth。44 区間はスプライン補間の導出値。Worklet 側は postMessage で受信したレプリカ
- **アプリ状態**: Idle → Initializing → Running → Error の 4 状態。`Controls` クラスが UI 反映を担当
- **Auto Sing 中の競合**: 声道ドラッグと母音プリセットボタンは無効化。ピッチスライダーは基準 F0 として合算方式で共存

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
| `NUM_SECTIONS` | 44 | 離散化区間数 |
| `NUM_CONTROL_POINTS` | 16 | UI 制御点数 |
| `WALL_LOSS_FACTOR` | 0.999 | 壁面損失係数 |
| `GLOTTAL_REFLECTION` | 0.95 | 声門端反射係数 |
| `LIP_REFLECTION` | -0.85 | 唇端反射係数 |
| `RADIATION_ALPHA` | 0.97 | 放射フィルタ係数 |

## 言語

コード中のコメント・UI テキストは日本語。変数名・関数名は英語。
