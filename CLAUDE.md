# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

声道の物理モデル（source-filter model）をリアルタイムに操作し、人工音声を生成するブラウザベースのWebアプリ。声門音源 + 声道フィルタ（連結管モデル / Kelly-Lochbaum アルゴリズム）による音声合成を、ドラッグ操作で直感的に行える「声の楽器」。

- 要求定義: `REQUIREMENTS.md`
- 技術調査: `TECHNICAL_RESEARCH.md`

## 技術スタック

- **言語**: TypeScript（Vanilla、フレームワークなし）
- **音声合成**: Web Audio API（AudioWorklet で低レイテンシ処理）
- **描画**: HTML5 Canvas
- **ビルド**: Vite（vanilla-ts テンプレート）
- **デプロイ**: GitHub Pages（静的ファイルのみ、サーバー不要）

## アーキテクチャ

### スレッド分離

```
[メインスレッド]                       [AudioWorklet スレッド]
Canvas UI (16制御点)                    AudioWorkletProcessor
  → スプライン補間 → 44区間断面積         Kelly-Lochbaum (44区間, Smith式1乗算)
  → postMessage で送信 ────────→        声門音源 (KLGLOTT88 → LF)
                                        放射フィルタ → 出力
AnalyserNode (スペクトル表示)
フォルマント直接計算 (断面積→反射係数→LPC多項式→QR法)
```

### 通信方式

- F0: AudioParam (k-rate)
- 断面積配列 (44要素): postMessage (dirty フラグで不要送信を抑制)
- 声門パラメータ (Rd, OQ, Aspiration等): postMessage (判別共用体型)
- ジッター/シマー量: postMessage
- スペクトルデータ: AnalyserNode (ブラウザネイティブFFT)

<!-- REVIEW: アーキテクチャレビューにて修正 — 通信方式に Phase 2-5 で追加される全パラメータを列挙。 -->

## 重要な設計判断

- **区間数 N=44** (fs=44100Hzでの物理的に正しい離散化: c/(2×fs) ≈ 0.4cm/区間)
- UI上は16制御点を表示し、44区間へスプライン補間
- 断面積配列は唇側 index=0、声門側 index=N-1
- 壁面損失 mu≈0.999 を各区間に適用（音質に必須、初期実装から組み込む）
- 断面積下限: 0.3 cm² (ゼロ除算防止)
- process() は常に true を返す (Chrome互換性)
- process() 内でメモリアロケーション禁止 (GC回避)
- AudioContext 生成は Start ボタンの click イベント内 (Autoplay Policy)
- SharedArrayBuffer は不使用 (GitHub Pages 互換性)

<!-- REVIEW: アーキテクチャレビューにて修正 — 状態管理とアプリ状態遷移の設計判断を追記。 -->
### 状態管理

- **断面積の正状態**: メインスレッド側の16制御点 (`TractEditor`) が source of truth。44区間はスプライン補間の導出値。Worklet側は postMessage で受信したレプリカ。
- **アプリ状態**: Idle → Initializing → Running → Error の4状態。engine.ts で管理。
- **Auto Sing中の競合**: 声道ドラッグと母音プリセットボタンは無効化。ピッチスライダーは基準F0として合算方式で共存。

## AudioWorklet のビルド

```typescript
const workletUrl = new URL('./audio/worklet-processor.ts', import.meta.url);
await audioContext.audioWorklet.addModule(workletUrl.href);
```

## 言語

コード中のコメント・UI テキストは日本語。変数名・関数名は英語。
