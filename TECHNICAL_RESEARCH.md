# 技術調査報告書 — 声道シミュレーション音声合成アプリ

10領域の並列調査結果を統合したドキュメント。

---

## 1. 設計上の最重要決定事項

### 1.1 区間数とサンプリングレートの関係

調査で判明した最も重要な設計制約:

```
セクション長 = c / (2 × fs)
区間数 N = 声道長 / セクション長 = 2 × L × fs / c
```

| fs (Hz) | セクション長 (cm) | 必要区間数 N |
|---------|------------------|-------------|
| 8,000   | 2.19             | 8           |
| 16,000  | 1.09             | **16**      |
| 22,050  | 0.79             | 22          |
| **44,100** | **0.40**      | **44**      |
| 48,000  | 0.37             | 48          |

**結論**: Web Audio API の標準 fs=44100Hz では **N≈44区間** が物理的に正しい。N=16 で fs=44100Hz を使うと声道長が約6.3cmになり、子供の声道より短くなる。

**推奨アプローチ**: 内部処理は N=44 区間で行い、UI上は16個の制御点を表示（44区間へスプライン補間）。Pink Trombone も同様に44区間を使用。

### 1.2 アーキテクチャ概要

```
[メインスレッド]                          [AudioWorklet スレッド]
                                          
Canvas UI (声道エディタ)                   AudioWorkletProcessor
  ↓ 16制御点                                 ↓
スプライン補間 → 44区間断面積              Kelly-Lochbaum (44区間)
  ↓ postMessage                              ↓
  → → → → → → → → → → → → → →          声門音源(KLGLOTT88/LF)
                                             ↓
AnalyserNode ← AudioWorkletNode ← →      出力 (128 samples/block)
  ↓
Canvas (スペクトル表示)
  ↓
フォルマント直接計算 (断面積→反射係数→LPC多項式→根)
```

---

## 2. 声道フィルタ — Kelly-Lochbaum アルゴリズム

### 2.1 コアアルゴリズム (Smith 式 1乗算接合)

各接合部 k (k = 0, ..., N-2) での散乱計算:

```
delta = r_k × (f_k[n] - b_{k+1}[n])
f_{k+1}[n] = f_k[n] - delta
b_k[n]     = b_{k+1}[n] + delta
```

反射係数: `r_k = (A_{k+1} - A_k) / (A_{k+1} + A_k)`

### 2.2 境界条件

| 境界 | モデル | 値 |
|------|--------|-----|
| 声門端 | 体積速度源 + 可変反射 | r_glottis ≈ 0.9〜0.99 |
| 唇端 | 1次IIRフィルタ | R_L ≈ -0.75〜-0.9 |
| 放射特性 | 1次差分フィルタ | output = f_N[n] - α×f_N[n-1], α≈0.9〜0.97 |

### 2.3 壁面損失

各区間に減衰係数を適用（音質への影響大、早期実装推奨）:
```
f_k[n] *= mu_k
b_k[n] *= mu_k
```
mu_k ≈ 0.999（典型値）。無損失だと金属的な不自然な音になる。

### 2.4 安定性

- 全反射係数 |r_k| < 1 で安定（A_k > 0 なら自動的に満たされる）
- 断面積下限値: A_min = 0.3 cm² （ゼロ除算防止）
- 断面積上限値: A_max = 10.0 cm²

---

## 3. 声門音源モデル

### 3.1 段階的実装戦略

| Phase | モデル | 特徴 |
|-------|--------|------|
| Phase 1 | KLGLOTT88 | 多項式ベース、暗黙方程式不要、4-5ops/sample |
| Phase 2 | LF (Rd パラメータ) | 高品質、Rd一つでチェスト↔ファルセット遷移 |

### 3.2 ピッチ制御 — 位相アキュムレータ方式

```
phase += F0 / sampleRate   (毎サンプル)
if phase >= 1.0: phase -= 1.0
output = glottal_model(phase)
```

- F0補間は対数空間で行う（知覚的に均一）
- ジッター: F0に0.5〜1.5%のランダム変動
- シマー: 振幅に0.5〜2%のランダム変動

### 3.3 有声/無声切替

```
output = AV × glottal_pulse(phase) + AN × noise()
```
切替時は5〜10msのクロスフェード。

### 3.4 声門パラメータインターフェース

| パラメータ | 用途 | 初期実装 | 拡張用 |
|-----------|------|---------|--------|
| F0 | 基本周波数 | ○ | |
| OQ | Open Quotient | ○ | |
| Ee / amplitude | 励振強度 | ○ | |
| Rd | 声質（LF用） | | ○ |
| Jitter | F0微小変動 | | ○ |
| Shimmer | 振幅微小変動 | | ○ |
| Aspiration | 気息ノイズ量 | | ○ |

---

## 4. 日本語5母音の声道断面積プリセット

### 4.1 物理定数

```
VOCAL_TRACT_LENGTH = 17.5 cm (成人男性)
SPEED_OF_SOUND     = 35000 cm/s (体温)
SAMPLE_RATE        = 44100 Hz
NUM_SECTIONS       = 44
SECTION_LENGTH     = 0.397 cm (= 17.5 / 44)
MIN_AREA           = 0.3 cm²
MAX_AREA           = 10.0 cm²
DEFAULT_AREA       = 4.0 cm²
NUM_CONTROL_POINTS = 16 (UI上の制御点数)
```

### 4.2 16制御点の断面積値 (cm², 唇→声門)

| idx | /a/ | /i/ | /u/ | /e/ | /o/ | neutral |
|-----|-----|-----|-----|-----|-----|---------|
| 0   | 5.0 | 1.0 | 0.5 | 2.5 | 0.8 | 4.0 |
| 1   | 5.0 | 0.5 | 0.5 | 2.0 | 1.0 | 4.0 |
| 2   | 5.5 | 0.4 | 1.0 | 1.0 | 2.0 | 4.0 |
| 3   | 8.0 | 0.3 | 2.5 | 0.8 | 4.0 | 4.0 |
| 4   | 8.0 | 0.5 | 4.0 | 1.0 | 6.0 | 4.0 |
| 5   | 7.0 | 1.0 | 5.0 | 2.0 | 7.0 | 4.0 |
| 6   | 4.0 | 3.0 | 4.0 | 4.0 | 6.0 | 4.0 |
| 7   | 2.0 | 5.0 | 2.0 | 5.5 | 4.0 | 4.0 |
| 8   | 1.0 | 6.5 | 0.5 | 6.0 | 2.0 | 4.0 |
| 9   | 0.7 | 6.0 | 0.4 | 5.5 | 1.0 | 4.0 |
| 10  | 0.8 | 5.5 | 0.5 | 5.0 | 1.5 | 4.0 |
| 11  | 1.5 | 4.5 | 1.5 | 4.0 | 2.5 | 4.0 |
| 12  | 2.0 | 3.5 | 3.0 | 3.0 | 3.5 | 4.0 |
| 13  | 3.0 | 2.5 | 3.5 | 2.5 | 4.0 | 4.0 |
| 14  | 3.5 | 2.0 | 3.0 | 2.0 | 3.5 | 4.0 |
| 15  | 2.5 | 1.5 | 2.0 | 1.5 | 2.5 | 4.0 |

※ 16制御点 → 44区間へスプライン補間して使用。
※ 日本語 /u/ は非円唇 [ɯ] のため唇端の断面積は英語より大きめ。

### 4.3 フォルマント目標値 (Hz, 成人男性)

| 母音 | F1 | F2 | F3 |
|------|-----|------|------|
| /a/ | 800 | 1300 | 2500 |
| /i/ | 300 | 2300 | 3000 |
| /u/ | 350 | 1400 | 2500 |
| /e/ | 500 | 1900 | 2600 |
| /o/ | 500 | 800 | 2500 |

### 4.4 チューニング指針

- F1を上げたい → 咽頭部の狭窄を強める / 口腔の開口を広げる
- F2を上げたい → 口腔前部を狭める（前舌的に）
- F2を下げたい → 口腔後部を狭める（後舌的に）

---

## 5. フォルマント推定

### 5.1 推奨: 声道パラメータからの直接計算

断面積配列から遅延ゼロ・高精度にフォルマントを計算可能:

1. 断面積列 → 反射係数列を計算
2. 反射係数列 → LPC多項式に変換 (step-up procedure)
3. LPC多項式 → コンパニオン行列を構成 (N×N)
4. QR法で固有値を計算
5. 固有値の角度からフォルマント周波数、絶対値から帯域幅を抽出

計算コスト: 44×44行列のQR分解で約1〜3ms。60fpsの描画予算 (16.7ms) に十分収まる。

### 5.2 スペクトル表示用: AnalyserNode

- fftSize: 2048 (周波数分解能 21.5Hz)
- smoothingTimeConstant: 0.75〜0.8
- 周波数軸: 対数スケール (50Hz〜5000Hz)
- 表示: Canvas上にスペクトル曲線 + フォルマントマーカー

---

## 6. Web Audio API / AudioWorklet

### 6.1 通信方式

| パラメータ | 方式 | 理由 |
|-----------|------|------|
| F0 (基本周波数) | AudioParam (k-rate) | スカラー値、オートメーション対応 |
| 音量 | AudioParam (k-rate) | スカラー値 |
| 断面積配列 (44要素) | postMessage | 配列データ |
| 音源種別 (パルス/ノイズ) | postMessage | コマンド的切替 |
| スペクトルデータ | AnalyserNode | ブラウザネイティブFFT |

### 6.2 レイテンシ構成

- レンダリングクォンタム: 128 samples ≈ 2.9ms (固定)
- AudioContext: latencyHint = "interactive"
- 合計: 15〜35ms (ハードウェア依存)

### 6.3 重要な実装注意点

- process() は常に `true` を返す (Chrome互換性)
- process() 内でメモリアロケーション禁止 (GC回避)
- AudioContext 生成は Start ボタンの click イベント内で (Autoplay Policy)
- SharedArrayBuffer は不使用 (GitHub Pages 互換性)

---

## 7. 自動歌唱モード (Auto Sing)

### 7.1 母音遷移

- 補間方式: コサイン補間 (ease-in/ease-out)
- 遷移時間: 80〜200ms (母音間のF1-F2距離に比例)

### 7.2 ピッチ生成

- 音階: ペンタトニック (デフォルト)
- 音域: 1〜1.5オクターブ
- メロディ生成: 1次マルコフ連鎖 + 音楽理論ルール制約
  - 跳躍幅: 最大完全5度 (7半音)
  - 大跳躍後は反進行
  - フレーズ末は主音/5度音に収束
- ビブラート: 5.5Hz / ±30cent / 正弦波 / 200msディレイ
- ポルタメント: 50〜200ms、60〜70%の確率で適用

### 7.3 リズム

- BPMベース (40〜200 BPM、スライダー調整)
- 音符長の確率分布: 8分40%、4分30%、付点8分15%、16分10%、2分5%
- マイクロタイミング: ±5〜15msのランダム揺らぎ

### 7.4 フレーズ構造

- フレーズ長: 4〜8拍
- フレーズ間: 0.5〜1拍の休符 + ブレスシミュレーション (100〜300ms)
- 音量: ノート単位ADSR + フレーズ単位アーチ型カーブ

---

## 8. Canvas UI 実装

### 8.1 声道断面積エディタ

- イベント: Pointer Events API (マウス+タッチ統一)
- setPointerCapture 必須 (Canvas外ドラッグ対応)
- CSS: `touch-action: none` (Canvas要素のみ)
- ヒット半径: 描画8px、判定15px (タッチ: 22px以上)
- 高DPI: devicePixelRatio でバッファスケーリング
- リサイズ: ResizeObserver

### 8.2 遷移アニメーション

- lerp + smoothstep イージング: `t² × (3 - 2t)`
- 遷移時間: 200〜500ms
- 描画と音声の同期: 断面積配列を共有状態として管理

### 8.3 スペクトル表示

- Canvas レイヤー: スペクトル描画層 + マーカー/数値オーバーレイ層の2層
- `{ alpha: false }` でコンテキスト生成 (描画高速化)
- フォルマント数値の更新: 10〜15fps (EMA平滑化)
- スペクトルマーカー: 30〜60fps (描画と同期)

---

## 9. Vite プロジェクト構成

### 9.1 ディレクトリ構造

```
vocal-tract-synth/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
├── public/
│   └── favicon.ico
└── src/
    ├── main.ts                    # エントリポイント
    ├── style.css
    ├── audio/
    │   ├── engine.ts              # AudioContext管理、ノード接続
    │   ├── worklet-processor.ts   # AudioWorkletProcessor (別バンドル)
    │   └── parameters.ts          # オーディオパラメータ定義
    ├── models/
    │   ├── vocal-tract.ts         # 声道の物理モデル (44区間)
    │   ├── glottal-source.ts      # 声門音源モデル
    │   ├── formant-calculator.ts  # フォルマント直接計算
    │   └── vowel-presets.ts       # 母音プリセットデータ
    ├── ui/
    │   ├── tract-editor.ts        # 声道断面積エディタ (Canvas)
    │   ├── spectrum-display.ts    # スペクトル表示 (Canvas)
    │   ├── controls.ts            # ボタン・スライダー
    │   └── auto-singer.ts         # 自動歌唱モード制御
    └── types/
        └── index.ts               # 共有型定義
```

### 9.2 AudioWorklet のビルド

```typescript
const workletUrl = new URL('./audio/worklet-processor.ts', import.meta.url);
await audioContext.audioWorklet.addModule(workletUrl.href);
```

### 9.3 GitHub Pages デプロイ

- `vite.config.ts`: `base: '/<repository-name>/'`
- GitHub Actions: `actions/deploy-pages` (公式方式)
- HTTPS配信 → AudioWorklet の Secure Context 要件を満たす

---

## 10. 実装フェーズ

| Phase | 内容 | 目標 |
|-------|------|------|
| 1 | パルス音源 + 44区間KL + 差分放射フィルタ + 基本UI | 音が出る |
| 2 | KLGLOTT88音源 + 壁面損失 + 改良放射フィルタ + 母音プリセット | 母音が聞こえる |
| 3 | スペクトル表示 + フォルマント計算 + ピッチ制御 | 可視化完成 |
| 4 | 自動歌唱モード + ビブラート + 揺らぎ | 歌える |
| 5 | LF声門モデル + 声質制御 + UI改善 | 品質向上 |

---

## 参考文献

- Fant, G. (1960). *Acoustic Theory of Speech Production*. Mouton.
- Kelly, J.L. & Lochbaum, C.C. (1962). "Speech Synthesis". Proc. 4th Int. Congress on Acoustics.
- Liljencrants, J. & Fant, G. (1985). "A four-parameter model of glottal flow". STL-QPSR.
- Smith, J.O. III. *Physical Audio Signal Processing*. CCRMA Stanford.
- Story, B.H., Titze, I.R. & Hoffman, E.A. (1996). "Vocal tract area functions from MRI". JASA.
- Flanagan, J.L. (1972). *Speech Analysis Synthesis and Perception*. Springer-Verlag.
- Klatt, D.H. & Klatt, L.C. (1990). "Analysis, synthesis, and perception of voice quality variations". JASA.
