# PHASE1-001: 基本音声パイプライン構築

**フェーズ**: Phase 1 — 音が出る
**マイルストーン**: [Phase 1](../MILESTONES.md#phase-1-基本音声パイプライン--音が出る)
**状態**: 🔲 未着手
**前提条件**: なし
**成果物**: パルス音源 + 44区間KL + 差分放射フィルタ + 基本Canvas UI

---

## 1. タスク目的とゴール

### 目的

声道物理モデルによるリアルタイム音声合成の基盤を構築する。ブラウザ上で声道断面積をドラッグ操作で変更し、その形状変化が即座に音に反映される「音が出る」状態を達成する。

### ゴール

- Viteプロジェクト（vanilla-ts）として開発環境が立ち上がる
- AudioWorklet上で44区間Kelly-Lochbaumアルゴリズムが動作する
- 簡易パルス音源（三角波パルス列）から声門入力が生成される
- 差分放射フィルタにより唇端出力が音声として放射される
- Canvas上に16個の制御点が表示され、ドラッグで断面積を変更できる
- 16制御点がスプライン補間により44区間の断面積配列に変換される
- Start/Stopボタンで音声合成の開始・停止ができる
- 断面積変更が即座に（< 20ms目標）音の変化として知覚できる

### 完了条件

**「ブラウザ上でStartを押して音が出る。制御点をドラッグすると音色が変わる。Stopで止まる。」**

---

## 2. 実装する内容の詳細

### 2.1 Viteプロジェクト初期化

`npm create vite@latest -- --template vanilla-ts` 相当の構成を手動で整備する。

| 項目 | 内容 |
|------|------|
| テンプレート | vanilla-ts |
| TypeScript設定 | strict mode有効 |
| ベースURL | `vite.config.ts` に `base` を設定（GitHub Pages対応準備） |
| HTMLエントリ | `index.html` にCanvas要素、Start/Stopボタン、制御パネルを配置 |

**ディレクトリ構造** (`TECHNICAL_RESEARCH.md` セクション9.1準拠):

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
    │   └── vowel-presets.ts       # 母音プリセットデータ (Phase 2で使用、構造のみ定義)
    ├── ui/
    │   ├── tract-editor.ts        # 声道断面積エディタ (Canvas)
    │   └── controls.ts            # ボタン・スライダー
    └── types/
        └── index.ts               # 共有型定義
```

**Phase 1では作成しないファイル** (構造定義のみ、または後続フェーズ):
- `src/models/formant-calculator.ts` (Phase 3)
- `src/ui/spectrum-display.ts` (Phase 3)
- `src/ui/auto-singer.ts` (Phase 4)

### 2.2 AudioWorklet基盤 (`src/audio/worklet-processor.ts`)

AudioWorkletProcessorのサブクラスを実装する。

```
クラス: VocalTractProcessor extends AudioWorkletProcessor
```

**責務**:
- `process()` メソッドで128サンプルごとに音声信号を生成
- 声門音源の生成 → KLアルゴリズムで声道フィルタリング → 放射フィルタ → 出力バッファへ書き込み
- メインスレッドからpostMessageで受信した断面積配列を内部バッファに反映
- AudioParam経由でF0値を受信

**重要な制約**:
- `process()` は常に `true` を返す（Chrome互換性: falseを返すとノードが破棄される）
- `process()` 内でオブジェクト生成・配列生成禁止（GCによるオーディオグリッチ回避）
- 全作業バッファはコンストラクタで事前確保する

**通信プロトコル** (`port.onmessage`):
```typescript
// メインスレッド → Worklet
{ type: 'setAreas', areas: Float64Array }  // 44要素の断面積配列
{ type: 'setSourceType', sourceType: 'pulse' | 'noise' }  // 音源切替

// AudioParam (k-rate)
frequency: F0 (Hz)  // デフォルト 120Hz
```

**ビルド方法**:
```typescript
const workletUrl = new URL('./audio/worklet-processor.ts', import.meta.url);
await audioContext.audioWorklet.addModule(workletUrl.href);
```
ViteがURLコンストラクタパターンを認識し、workletファイルを別チャンクとしてビルドする。

### 2.3 44区間Kelly-Lochbaumアルゴリズム (`src/models/vocal-tract.ts`)

Smith式1乗算接合による波動伝搬シミュレーション。worklet-processor.ts内から呼び出される純粋な計算モジュール。

**物理定数**:
```
VOCAL_TRACT_LENGTH = 17.5 cm (成人男性)
SPEED_OF_SOUND     = 35000 cm/s (体温)
SAMPLE_RATE        = 44100 Hz
NUM_SECTIONS       = 44
SECTION_LENGTH     = 0.397 cm (= 17.5 / 44)
MIN_AREA           = 0.3 cm²
MAX_AREA           = 10.0 cm²
DEFAULT_AREA       = 4.0 cm² (均一管)
```

**コアアルゴリズム**:

各サンプルについて、以下を実行:

1. **声門端境界条件**: 声門音源の値を進行波配列の末尾に注入
   ```
   f[N-1] = glottal_source_sample + r_glottis * b[N-1]
   r_glottis ≈ 0.9〜0.99
   ```

2. **接合部散乱計算** (k = N-2, ..., 0):
   ```
   delta = r[k] * (f[k][n] - b[k+1][n])
   f[k+1][n] = f[k][n] - delta
   b[k][n]   = b[k+1][n] + delta
   ```
   ここで反射係数: `r[k] = (A[k+1] - A[k]) / (A[k+1] + A[k])`

3. **唇端境界条件**:
   ```
   b[0] = R_L * f[0]
   R_L ≈ -0.75〜-0.9
   ```

4. **壁面損失の適用**: 各区間の進行波・反射波に減衰を適用
   ```
   f[k] *= mu    (mu ≈ 0.999)
   b[k] *= mu
   ```

5. **放射フィルタ**: 唇端出力を差分フィルタで処理

**断面積の方向規約**: index=0 が唇側、index=N-1 が声門側

**状態バッファ** (コンストラクタで事前確保):
- `forwardWave: Float64Array(N)` — 進行波（声門→唇）
- `backwardWave: Float64Array(N)` — 反射波（唇→声門）
- `reflectionCoefficients: Float64Array(N-1)` — 反射係数
- `areas: Float64Array(N)` — 断面積配列

### 2.4 簡易パルス音源 (`src/models/glottal-source.ts`)

Phase 1では三角波パルス列による簡易音源を実装する（Phase 2でKLGLOTT88に差し替え）。

**位相アキュムレータ方式**:
```
phase += F0 / sampleRate   (毎サンプル)
if (phase >= 1.0) phase -= 1.0
```

**三角波パルス波形**:
- Open Quotient (OQ) = 0.6 (デフォルト)
- 位相 0〜OQ: 三角波の上昇・下降部（声門パルス）
- 位相 OQ〜1.0: ゼロ（声門閉鎖期）

```
phase < OQ/2:     output = 2 * phase / OQ                 (上昇)
phase < OQ:       output = 2 * (1 - phase / OQ)            (下降) (訂正: OQ内の後半)
phase >= OQ:      output = 0                                (閉鎖期)
```

**パラメータ**:
- F0: AudioParam (k-rate) から取得、デフォルト 120Hz
- OQ: 固定値 0.6（Phase 1では変更不要）
- 振幅: 固定値 1.0

### 2.5 差分放射フィルタ

唇端からの音響放射特性を1次差分フィルタで近似する。

```
output[n] = f_N[n] - alpha * f_N[n-1]
alpha ≈ 0.9〜0.97
```

- `f_N` は唇端（index=0）の進行波
- `f_N[n-1]` は1サンプル前の値（状態変数として保持）
- Phase 1では alpha = 0.97 固定

### 2.6 メインスレッド - AudioWorklet通信 (`src/audio/engine.ts`)

**AudioContext管理**:
- AudioContextの生成はStartボタンのclickイベントハンドラ内で行う（Autoplay Policy対応）
- `latencyHint: 'interactive'` を指定
- sampleRate: 44100Hz

**ノード接続グラフ**:
```
AudioWorkletNode (VocalTractProcessor)
  → GainNode (音量制御)
    → AudioContext.destination
```

Phase 3ではGainNodeとdestinationの間にAnalyserNodeを挿入する。

**通信フロー**:
```
[メインスレッド]                            [AudioWorkletスレッド]
UIで制御点変更
  → スプライン補間 → 44区間断面積配列
  → workletNode.port.postMessage({ type: 'setAreas', areas })
                                            → port.onmessage で受信
                                            → 内部バッファに反映

F0変更
  → workletNode.parameters.get('frequency').value = newF0
                                            → AudioParam で即座に反映
```

**`src/audio/parameters.ts`**: AudioWorkletNodeのparameterDescriptors定義を格納する。

```typescript
// worklet-processor.ts 内の static get parameterDescriptors
static get parameterDescriptors(): AudioParamDescriptor[] {
  return [
    { name: 'frequency', defaultValue: 120, minValue: 50, maxValue: 600, automationRate: 'k-rate' },
  ];
}
```

### 2.7 基本Canvas UI (`src/ui/tract-editor.ts`)

16個の制御点を持つ声道断面積エディタ。

**表示仕様**:
- 横軸: 声道の位置（左 = 唇、右 = 声門）
- 縦軸: 断面積 (0.3〜10.0 cm²)
- 16個の制御点を等間隔に配置
- 制御点間を曲線（スプライン）で接続して描画
- 制御点: 円形、描画半径8px、ヒット判定半径15px

**ドラッグ操作**:
- Pointer Events API使用（マウス+タッチ統一）
- `pointerdown` で制御点をヒットテスト → ドラッグ開始
- `pointermove` でY座標から断面積値を計算（MIN_AREA〜MAX_AREAにクランプ）
- `pointerup` でドラッグ終了
- `setPointerCapture` でCanvas外ドラッグに対応
- Canvas要素に `touch-action: none` を設定

**リアルタイム反映**:
- ドラッグ中の `pointermove` ごとに:
  1. 16制御点の値を更新
  2. スプライン補間で44区間断面積を計算
  3. postMessageでAudioWorkletに送信
  4. Canvas再描画

**スプライン補間** (16制御点 → 44区間):
- 自然3次スプライン（natural cubic spline）
- 16個のx座標を44区間の空間に等間隔マッピング
- 補間結果はMIN_AREA〜MAX_AREAにクランプ
- 補間計算はメインスレッドで実行（AudioWorkletのGC制約を回避）

**高DPI対応**:
- `devicePixelRatio` でCanvasバッファをスケーリング
- ResizeObserverでリサイズに追従

### 2.8 Start/Stopボタン (`src/ui/controls.ts`)

**Start動作**:
1. click イベント内で `new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' })` 
2. AudioWorkletモジュールを `addModule()` でロード
3. AudioWorkletNodeを生成、GainNodeに接続、destinationに接続
4. 初期断面積（均一管 4.0cm² x 44区間）をpostMessageで送信
5. ボタン表示を「Stop」に切替

**Stop動作**:
1. AudioContextを `close()` で破棄（またはsuspend）
2. ボタン表示を「Start」に切替

**初期状態**: ページロード時はStop状態（音は出ない）

### 2.9 エントリポイント (`src/main.ts`)

アプリケーション全体の初期化を行う。

1. Canvas要素の取得・初期化
2. TractEditorインスタンス生成
3. Controlsインスタンス生成
4. 各モジュール間のイベント接続（断面積変更 → engine送信）

---

## 3. 実装に必要なエージェントチームの役割と人数

Phase 1は4名のエージェントチームで並列実装し、最後に統合する。

### 3.1 build-config エージェント (1名)

**専門**: Viteビルド設定、TypeScript設定、プロジェクト構成

**担当範囲**:
- Viteプロジェクトの初期化（package.json, vite.config.ts, tsconfig.json）
- ディレクトリ構造の作成
- index.htmlのスケルトン（Canvas要素、ボタン、基本レイアウト）
- style.cssの基本スタイル
- AudioWorkletファイルのビルド設定確認（URLコンストラクタパターン）
- GitHub Pages対応の base URL設定

**成果物**:
- `package.json`, `vite.config.ts`, `tsconfig.json`
- `index.html`, `src/style.css`
- `src/types/index.ts`（共有型定義の初期版）
- ビルド・開発サーバーの動作確認

**完了条件**: `npm run dev` でViteサーバーが起動し、空のCanvasが表示される

### 3.2 audio-engine エージェント (1名)

**専門**: Web Audio API、AudioWorklet、DSPアルゴリズム

**担当範囲**:
- `src/audio/worklet-processor.ts` — AudioWorkletProcessor実装
- `src/audio/parameters.ts` — AudioParam定義
- `src/models/vocal-tract.ts` — 44区間Kelly-Lochbaumアルゴリズム
- `src/models/glottal-source.ts` — 三角波パルス音源
- 差分放射フィルタの実装
- 壁面損失の実装
- process()内のGC回避（全バッファ事前確保）
- 数値安定性の確認

**成果物**:
- `src/audio/worklet-processor.ts`
- `src/audio/parameters.ts`
- `src/models/vocal-tract.ts`
- `src/models/glottal-source.ts`
- KLアルゴリズムのユニットテスト

**完了条件**: 均一管の断面積を入力したとき、理論的に予測される周波数特性に近い出力が得られる

### 3.3 ui-canvas エージェント (1名)

**専門**: Canvas描画、Pointer Events、UI操作、数学的補間

**担当範囲**:
- `src/ui/tract-editor.ts` — 声道断面積エディタCanvas
- 16制御点の描画とドラッグ操作
- スプライン補間（16制御点 → 44区間）
- 高DPI対応、ResizeObserver
- `src/ui/controls.ts` — Start/Stopボタン、基本UIイベント

**成果物**:
- `src/ui/tract-editor.ts`
- `src/ui/controls.ts`
- スプライン補間のユニットテスト

**完了条件**: Canvas上で16制御点をドラッグでき、補間された44区間の断面積配列が正しく出力される

### 3.4 integration エージェント (1名)

**専門**: モジュール結合、型定義、通信プロトコル、E2Eテスト

**担当範囲**:
- `src/audio/engine.ts` — AudioContext管理、ノード接続、postMessage通信
- `src/types/index.ts` — 全モジュールで共有する型定義の最終化
- `src/main.ts` — エントリポイント、各モジュールの結合
- メインスレッド - AudioWorklet間の通信プロトコル実装
- E2Eテスト: Start→音→断面積変更→音変化→Stop
- 全体の動作確認と不具合修正

**成果物**:
- `src/audio/engine.ts`
- `src/types/index.ts`
- `src/main.ts`
- E2Eテスト

**完了条件**: Phase 1の完了条件（Start→音が出る→ドラッグで音が変わる→Stop）を満たす

### 3.5 並列作業の流れ

```
Step 1 (並列):
  build-config  → プロジェクト初期化 + 型定義スケルトン
  audio-engine  → KL + 音源 + 放射フィルタ（単体テスト可能な状態）
  ui-canvas     → Canvas描画 + ドラッグ操作（スタブデータで単体確認）

Step 2 (並列、Step 1完了後):
  integration   → engine.ts + main.ts で全モジュール結合
  audio-engine  → integrationからのフィードバックで調整
  ui-canvas     → integrationからのフィードバックで調整

Step 3:
  integration   → E2Eテスト + 最終確認
```

---

## 4. 提供範囲とテスト項目

### 4.1 スコープ内

- Viteプロジェクト（vanilla-ts）の完全な開発環境
- AudioWorklet上で動作する44区間Kelly-Lochbaumフィルタ
- 三角波パルス列による簡易声門音源
- 差分放射フィルタ（alpha = 0.97固定）
- 壁面損失（mu = 0.999固定）
- 声門端反射（r_glottis = 0.95固定）
- 唇端反射（R_L = -0.85固定）
- Canvas上の16制御点ドラッグUI
- 自然3次スプライン補間（16点 → 44区間）
- F0のAudioParam（k-rate、デフォルト120Hz、Phase 1ではUI変更なし）
- Start/Stopボタン
- 断面積の初期値: 均一管 4.0cm² x 44区間

### 4.2 スコープ外（後続フェーズ）

- KLGLOTT88 / LF声門モデル（Phase 2）
- 母音プリセット（Phase 2、データ構造のみ定義は可）
- AnalyserNode / スペクトル表示（Phase 3）
- フォルマント計算（Phase 3）
- F0スライダーUI（Phase 3）
- 音量スライダーUI（Phase 3）
- 有声/無声切替UI（Phase 2）
- 自動歌唱モード（Phase 4）
- ジッター / シマー（Phase 5）
- GitHub Actionsデプロイ設定（必要に応じて）

### 4.3 ユニットテスト

#### KLアルゴリズム — 均一管の理論値照合
- **テスト内容**: 全区間が同一断面積（4.0cm²）の均一管にインパルスを入力し、出力を検証
- **期待値**: 均一管（長さL）の共鳴周波数は `f_n = (2n-1) * c / (4L)` (n=1,2,3,...) 。L=17.5cm, c=35000cm/s のとき、f1=500Hz, f2=1500Hz, f3=2500Hz
- **検証方法**: 出力信号をFFTし、ピーク周波数が理論値と一致するか確認（許容誤差: +/-50Hz）

#### 反射係数計算
- **テスト内容**: 既知の断面積ペアから反射係数を計算
- **テストケース**:
  - A[k]=4.0, A[k+1]=4.0 → r=0 (同一断面積、反射なし)
  - A[k]=1.0, A[k+1]=9.0 → r=0.8
  - A[k]=9.0, A[k+1]=1.0 → r=-0.8
  - A[k]=0.3, A[k+1]=10.0 → r≈0.942 (極端な断面積比)
- **検証**: |r| < 1 が常に成立すること

#### スプライン補間
- **テスト内容**: 16制御点から44区間への補間が正しく動作するか
- **テストケース**:
  - 全制御点が同一値(4.0) → 44区間すべてが4.0
  - 線形勾配（1.0〜10.0） → 補間結果が単調増加
  - 補間結果が MIN_AREA(0.3) 〜 MAX_AREA(10.0) の範囲内
- **検証**: 制御点の位置では補間値が制御点値と一致すること

#### 断面積下限クランプ
- **テスト内容**: 断面積がMIN_AREA未満にならないことの確認
- **テストケース**: 制御点を0に設定 → 補間結果が0.3以上であること

### 4.4 E2Eテスト（手動確認チェックリスト）

- [ ] `npm run dev` でVite開発サーバーが起動する
- [ ] ブラウザでページが表示される（Canvas + Start/Stopボタン）
- [ ] Startボタンを押すと音が出る
- [ ] 均一管の状態でブザー的な音が持続的に鳴る
- [ ] 制御点をドラッグすると音色が変化する
- [ ] 制御点を極端に変えると音色が大きく変わる（共鳴特性の変化が聞き取れる）
- [ ] Stopボタンを押すと音が止まる
- [ ] 再度Startを押すと再び音が出る
- [ ] 長時間（30秒以上）鳴らしても音が途切れない（数値発散なし）
- [ ] 制御点を高速にドラッグしてもクラッシュしない
- [ ] `npm run build` でビルドが成功する

---

## 5. 実装に関する懸念事項とレビュー項目

### 5.1 AudioWorklet内でのGC回避

**懸念**: `process()` メソッド内でオブジェクトや配列を生成すると、GC（Garbage Collection）がオーディオスレッドをブロックし、グリッチ（プチプチノイズ）が発生する。

**対策**:
- 全Float64Array/Float32Arrayバッファはコンストラクタで確保
- process()内では既存バッファへの値代入のみ
- ループ内での文字列結合・オブジェクト生成禁止
- postMessageの受信処理でも新規配列を作らず、既存バッファにコピー

**レビュー項目**:
- [ ] process() 内に `new`, `[]`, `{}`, テンプレートリテラル、`Array.from()` が存在しないこと
- [ ] postMessage受信時に `areas` データを既存Float64Arrayにコピーしていること
- [ ] for文のイテレータ変数以外に新しい変数バインディングがないこと（letでの一時変数は許容、クロージャ生成は禁止）

### 5.2 process()の戻り値

**懸念**: `process()` が `false` を返すと、Chromeではノードが即座にGC対象になり音が止まる。仕様上は「入力がなくなったとき」にfalseを返すべきだが、音源生成ノードには入力がないため常にtrueが必要。

**対策**: `return true;` を必ず記述。条件分岐で `false` を返すパスが存在しないことをレビューで確認。

**レビュー項目**:
- [ ] process() の全実行パスで `return true` が保証されていること

### 5.3 Autoplay Policy対応

**懸念**: ユーザーインタラクションなしにAudioContextを生成すると、ブラウザがサスペンド状態にする。特にChrome/Edgeで顕著。

**対策**:
- AudioContext生成を `Startボタンのclickイベントハンドラ` 内に限定
- DOMContentLoaded等での事前生成を禁止
- `audioContext.state` が 'suspended' の場合に `resume()` を呼ぶフォールバック

**レビュー項目**:
- [ ] AudioContextの `new` がユーザーインタラクション（click）のコールスタック内にあること
- [ ] ページロード時にAudioContextが生成されていないこと

### 5.4 断面積下限値によるゼロ除算防止

**懸念**: 反射係数の計算 `r = (A[k+1] - A[k]) / (A[k+1] + A[k])` で、分母がゼロになると無限大/NaNが発生し、波動伝搬が破綻する。

**対策**:
- 断面積の下限値 `MIN_AREA = 0.3 cm²` を設定
- UI側（スプライン補間後）とWorklet側（受信時）の2箇所でクランプ
- 二重防御により、通信エラーや競合状態でも安全

**レビュー項目**:
- [ ] スプライン補間結果に MIN_AREA クランプが適用されていること
- [ ] Worklet側でも受信した断面積にクランプが適用されていること
- [ ] 反射係数計算で分母がゼロになりうるパスがないこと

### 5.5 数値安定性

**懸念**: KLアルゴリズムは本質的にはエネルギー保存系だが、実装上の蓄積誤差やパラメータ設定ミスで発散する可能性がある。

**対策**:
- 壁面損失 mu=0.999 が減衰項として機能し、発散を抑制
- |r[k]| < 1 が全区間で保証されることの確認（A[k] > 0 で自動的に満たされる）
- 波動変数 (f, b) の値が異常に大きくなった場合のソフトクリッピング（安全弁）

**レビュー項目**:
- [ ] 壁面損失が全区間に正しく適用されていること
- [ ] 30秒以上の連続動作で出力振幅が発散しないこと
- [ ] 極端な断面積パターン（交互に最小/最大）でも安定に動作すること

### 5.6 SharedArrayBuffer不使用

**懸念**: SharedArrayBufferを使うと、GitHub PagesでCOOP/COEPヘッダーが必要になり、デプロイが複雑化する。

**対策**: 通信はすべてpostMessage（構造化クローン）で行う。SharedArrayBuffer / Atomicsは一切使用しない。

**レビュー項目**:
- [ ] コード内に `SharedArrayBuffer` / `Atomics` が存在しないこと

---

## 6. 一から作り直すとしたら

Phase 1はプロジェクトの最初のフェーズであるため、「初回設計で重視すべきポイント」と「やり直すなら変えたい判断」の両面から記述する。

### 6.1 アーキテクチャの設計思想

**重視すべき点: Workletの独立性**

AudioWorkletスレッドとメインスレッドの責務分離を徹底すること。KLアルゴリズム、音源生成、放射フィルタはすべてWorklet側に閉じた計算であり、メインスレッドの状態に依存してはならない。postMessageは「断面積配列が変わった」という事実の通知であり、毎サンプルの同期ではない。この非同期設計がレイテンシとGC回避の両立を可能にする。

**重視すべき点: バッファの事前確保パターン**

AudioWorkletの最大の制約は「process()内でGCを起こさない」こと。全バッファをコンストラクタで確保し、process()は既存メモリの読み書きだけを行う。この制約はPhase 1から徹底すべきで、後から修正すると全体に影響が波及する。

**重視すべき点: 型定義を通信プロトコルの契約として設計する**

`src/types/index.ts` に定義するメッセージ型は、メインスレッドとAudioWorkletの「契約」。Phase 2以降で音源パラメータが追加されるため、判別共用体型（discriminated union）で設計し、拡張可能にしておく。

### 6.2 モジュール分離の方針

**やるべきこと: 計算ロジックをWorkletから分離**

`vocal-tract.ts` と `glottal-source.ts` は純粋な数値計算モジュールとして実装し、`worklet-processor.ts` はこれらを呼び出すオーケストレーターに徹する。こうすることで、KLアルゴリズムのユニットテストがNode.js上で実行でき（AudioWorklet APIなしで）、開発効率が大幅に向上する。

**やるべきこと: スプライン補間をメインスレッドに配置**

補間計算はAudioWorklet側に置くべきではない（配列生成が発生しうるため）。メインスレッドで44区間に補間してからpostMessageで送る設計が正しい。

**入れなくてよいもの: 過度な抽象化**

Phase 1では音源インターフェースの抽象クラス / Strategy パターン等は不要。三角波パルスを直接実装し、Phase 2でKLGLOTT88に差し替えるときにインターフェースを抽出する方が、無駄な抽象層を避けられる。ただし、音源の `getSample(phase: number): number` という関数シグネチャだけは統一しておく（Phase 2の `GlottalSource` インターフェースとの整合性を確保）。

### 6.3 通信方式の設計

**やるべきこと: F0はAudioParam、断面積はpostMessage**

F0は毎ブロック（128サンプル）でスムーズに変化する可能性があり、AudioParam（k-rate）が適切。断面積配列は44要素のFloat64Arrayで、ユーザーのドラッグ操作ごとに送信（数十Hz程度の頻度）。この分離は最初から守るべき。

**入れなくてよいもの: 双方向通信**

Phase 1ではWorklet→メインスレッドへの通信は不要。Worklet側の状態（波動変数の振幅など）をモニタリングする機能はPhase 3以降で検討すれば十分。

### 6.4 初期フェーズで入れるべきもの

- **壁面損失 (mu=0.999)**: 無損失だと金属的で不自然な音になる。Phase 1から必須。CLAUDE.mdにも「音質に必須、初期実装から組み込む」と明記されている。
- **断面積下限値 (0.3cm²)**: ゼロ除算防止は安全性の基本。初日から入れる。
- **process() return true**: Chrome互換性のため必須。
- **TypeScript strict mode**: 型安全性は後から追加すると修正コストが高い。

### 6.5 初期フェーズで入れなくてよいもの

- **音源の高品質化**: 三角波で十分。KLGLOTT88はPhase 2で。
- **F0のUI制御**: デフォルト120Hz固定でPhase 1は成立する。
- **AnalyserNode接続**: Phase 3で追加すればよい。GainNode→destinationの間にinsertする設計にしておくだけで十分。
- **母音プリセットの実データ**: データ構造（`vowel-presets.ts`）の型定義だけ用意し、実際の値はPhase 2で投入。

### 6.6 補足: レビューによる追加事項

#### エラーハンドリング戦略

Phase 1 で最低限カバーすべきエラーケース:

- **AudioContext 生成失敗**: ブラウザが Web Audio API を未サポートの場合、`new AudioContext()` が例外を投げる。Start ボタンの click ハンドラ内で try-catch し、ユーザーに「このブラウザは対応していません」と表示する。
- **AudioWorklet モジュール読み込み失敗**: `addModule()` は Promise を返す。reject された場合（ファイル 404、パースエラー等）のハンドリングが必要。await を try-catch で囲み、失敗時は Start ボタンを無効化してエラーメッセージを表示する。
- **AudioContext の suspend 状態**: Autoplay Policy により `audioContext.state === 'suspended'` となるケースがある。Start 時に `resume()` を呼び、それでも 'running' にならなければユーザーに通知する。

これらはコード量が少なく（各 5-10 行程度）、Phase 1 から入れておくべき。Phase 2 以降でデバッグ時間を大幅に節約できる。

#### デバッグ容易性のための設計

- **Worklet 内のログ出力**: AudioWorklet スレッドの `console.log` はブラウザの DevTools コンソールに表示されるが、大量のログは process() のパフォーマンスに影響する。開発時のみ有効化するフラグ（`DEBUG` 定数、または postMessage で制御するモード切替）を用意する。ただし process() 内の条件分岐は最小限にとどめる。
- **波動変数のモニタリング**: Phase 1 の段階では不要だが、発散検出のために `forwardWave` / `backwardWave` の最大振幅をチェックし、閾値を超えた場合に postMessage で警告を送る仕組みは、デバッグ時に有用。Phase 1 では簡易版（ソフトクリッピング + console.warn）で十分。

#### Vite 開発サーバーでの AudioWorklet リロード

Vite の HMR（Hot Module Replacement）は AudioWorklet ファイルに対して正しく機能しない。AudioWorklet は `addModule()` で一度ロードされると、同じ AudioContext 上で再登録できない（ブラウザの制約）。

- **影響**: worklet-processor.ts を編集しても、HMR ではページ全体のリロードが必要になる。
- **対策**: Vite の設定で AudioWorklet ファイルの変更時にフルリロードを強制するか、開発時のワークフローとして「worklet 変更時はブラウザをリロード」をドキュメント化する。
- **Phase 1 での対応**: フルリロードで十分。過度な自動化は不要だが、この制約を開発者が認識していることが重要。

---

## 7. 後続タスクへの連絡事項

### 7.1 Phase 2 で必要になるインターフェース仕様

Phase 2（KLGLOTT88声門音源 + 母音プリセット）が依存するPhase 1の公開インターフェース:

#### 音源モジュールのインターフェース

```typescript
// Phase 1 の glottal-source.ts が公開する関数シグネチャ
// Phase 2 でこのシグネチャを維持しつつ KLGLOTT88 に差し替える
function generateGlottalSample(phase: number, params: GlottalParams): number;

interface GlottalParams {
  // Phase 1: OQ のみ使用
  openQuotient: number;  // 0.0〜1.0, デフォルト 0.6
  // Phase 2 で追加予定:
  // speedQuotient: number;
  // amplitude: number;
}
```

#### 断面積配列の通信プロトコル

```typescript
// postMessage で送信するメッセージ型
type WorkletMessage =
  | { type: 'setAreas'; areas: number[] }          // 44要素
  | { type: 'setSourceType'; sourceType: 'pulse' | 'noise' };
  // Phase 2 で追加予定:
  // | { type: 'setGlottalParams'; params: GlottalParams }
```

#### 母音プリセットのデータ構造

```typescript
// Phase 1 で型定義のみ、Phase 2 で実データ投入
interface VowelPreset {
  name: string;          // 'a', 'i', 'u', 'e', 'o'
  label: string;         // 'あ', 'い', 'う', 'え', 'お'
  controlPoints: number[];  // 16要素 (cm²)
}
```

### 7.2 Phase 2 で差し替えが必要なコンポーネント

| コンポーネント | Phase 1 | Phase 2 |
|---------------|---------|---------|
| 声門音源 | 三角波パルス列 | KLGLOTT88多項式モデル |
| 放射フィルタ alpha | 0.97固定 | 周波数依存の改良版 |
| 壁面損失 mu | 0.999固定 | 区間ごとの断面積依存値（任意） |
| 声門反射係数 | 0.95固定 | 声門開度に連動した可変値 |

**差し替えの影響範囲**:
- `src/models/glottal-source.ts` — 波形生成ロジックの全面書き換え
- `src/audio/worklet-processor.ts` — 音源呼び出し部分の修正、新パラメータ受信の追加
- `src/types/index.ts` — GlottalParams型の拡張、WorkletMessage型へのメッセージ追加

### 7.3 Phase 3 で使うAnalyserNodeの接続ポイント

Phase 3（スペクトル表示 + フォルマント計算）でAnalyserNodeを挿入するためのガイド。

**現在のノード接続 (Phase 1)**:
```
AudioWorkletNode → GainNode → destination
```

**Phase 3 での変更**:
```
AudioWorkletNode → GainNode → AnalyserNode → destination
```

**接続変更の実装箇所**: `src/audio/engine.ts`

**AnalyserNode設定** (TECHNICAL_RESEARCH.md準拠):
```typescript
const analyser = audioContext.createAnalyser();
analyser.fftSize = 2048;                    // 周波数分解能 21.5Hz
analyser.smoothingTimeConstant = 0.75;      // スペクトル平滑化

// 既存の接続を変更
gainNode.connect(analyser);
analyser.connect(audioContext.destination);
// gainNode.connect(audioContext.destination);  // これを削除
```

**Phase 3 で追加するファイル**:
- `src/models/formant-calculator.ts` — 断面積→反射係数→LPC多項式→QR法→フォルマント
- `src/ui/spectrum-display.ts` — AnalyserNodeデータのCanvas描画

**Phase 1 で準備しておくべきこと**:
- `engine.ts` で GainNode のインスタンスを外部から参照可能にしておく（Phase 3で接続先変更のため）
- AudioWorkletNodeのインスタンスも同様に公開
- AnalyserNode用の挿入ポイントをコメントで明示しておく

---

## 参考資料

- [REQUIREMENTS.md](../../REQUIREMENTS.md) — 要求定義書
- [TECHNICAL_RESEARCH.md](../../TECHNICAL_RESEARCH.md) — 技術調査報告書
- [CLAUDE.md](../../CLAUDE.md) — Claude Code向けプロジェクトガイド
- Smith, J.O. III. *Physical Audio Signal Processing*. CCRMA Stanford. (KLアルゴリズム参照実装)
- Kelly, J.L. & Lochbaum, C.C. (1962). "Speech Synthesis". (原論文)
