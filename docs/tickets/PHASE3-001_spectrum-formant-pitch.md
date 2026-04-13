# PHASE3-001: スペクトル表示・フォルマント計算・ピッチ制御

**フェーズ**: Phase 3 — 可視化完成
**マイルストーン**: [Phase 3](../MILESTONES.md#phase-3-可視化ピッチ制御--可視化完成)
**状態**: 🔲 未着手
**前提条件**: Phase 2 完了（[PHASE2-001](PHASE2-001_klglott88-vowel-presets.md)）
**成果物**: FFTスペクトル表示 + フォルマント直接計算 + F0スライダー

---

## 1. タスク目的とゴール

Phase 2 で実現した「母音が聞こえる」状態に対し、音声の周波数特性をリアルタイムに可視化し、基本周波数（F0）を手動制御できるようにする。

### ゴール

- 合成音声のFFTスペクトルをCanvas上にリアルタイム表示する
- 声道の断面積配列から直接フォルマント周波数（F1, F2, F3）を計算し、数値表示する
- フォルマント位置をスペクトル上にマーカーとしてオーバーレイする
- F0制御スライダーを追加し、ピッチをリアルタイムに変更できるようにする
- 母音ごとのフォルマント構造の違いがスペクトル表示上で視認できる

### 完了条件

- スペクトル表示で母音ごとのフォルマント構造の違いが視認できる
- F1, F2, F3 の数値が母音プリセットの目標値（TECHNICAL_RESEARCH.md 4.3節）と概ね一致する
- F0スライダーの操作で基本周波数が即座に変化し、スペクトル上のハーモニクス間隔が変化する

---

## 2. 実装する内容の詳細

### 2.1 AnalyserNode の接続

AudioWorkletNode の出力に AnalyserNode を接続し、ブラウザネイティブのFFTデータを取得する。

- **接続場所**: `src/audio/engine.ts` の AudioContext ノードグラフに追加
- **fftSize**: 2048（周波数分解能: 44100 / 2048 = 21.5Hz）
- **smoothingTimeConstant**: 0.75 - 0.8（スペクトルの時間平滑化）
- **データ取得**: `getFloatFrequencyData()` で dB スケールのスペクトルデータを取得
- **ノード接続順**: AudioWorkletNode → AnalyserNode → AudioContext.destination

### 2.2 Canvas スペクトル表示

`src/ui/spectrum-display.ts` にスペクトル描画ロジックを実装する。

- **周波数軸**: 対数スケール、50Hz - 5000Hz の範囲
- **振幅軸**: dB スケール（AnalyserNode の出力がそのまま dB 値）
- **描画方式**: requestAnimationFrame ループによるリアルタイム更新
- **対数周波数マッピング**: `x = (log(f) - log(50)) / (log(5000) - log(50)) * canvasWidth`
- **グリッド線**: 100Hz, 200Hz, 500Hz, 1000Hz, 2000Hz, 5000Hz に周波数目盛りを描画
- **描画色**: スペクトル曲線はメインカラー、背景は暗色系で視認性を確保

### 2.3 フォルマント直接計算

`src/models/formant-calculator.ts` にフォルマント計算ロジックを実装する。AnalyserNode のスペクトルピーク検出ではなく、声道パラメータから直接計算する方式を採用する（遅延ゼロ・高精度）。

#### 計算パイプライン

```
断面積配列 A[0..43]
  ↓
反射係数列 r[k] = (A[k+1] - A[k]) / (A[k+1] + A[k])  (k = 0..42)
  ↓
LPC多項式に変換 (step-up procedure / Levinson-Durbin の逆操作)
  ↓
コンパニオン行列を構成 (44 x 44)
  ↓
QR法で固有値を計算
  ↓
固有値の角度 → フォルマント周波数: f = angle / (2π) × fs
固有値の絶対値 → 帯域幅: BW = -fs / π × ln|z|
  ↓
0Hz < f < fs/2 の範囲でソートし、F1, F2, F3 を抽出
```

#### step-up procedure（反射係数 → LPC多項式）

```typescript
// a[0] = 1 (初期値)
// 各ステージ k で:
//   a_new[j] = a_old[j] + r[k] * a_old[k-j]  (j = 1..k)
//   a_new[k+1] = r[k]
```

#### QR法の実装

- 初期値: コンパニオン行列（LPC多項式の係数から構成）
- 上側ヘッセンベルグ行列への変換（コンパニオン行列は既にヘッセンベルグ形式）
- シフト付きQR反復（Wilkinson シフト推奨）
- 収束判定: 副対角成分の絶対値が閾値（1e-10 程度）以下
- 最大反復回数: 行列サイズの30倍程度（44x44なら ~1320回）

### 2.4 F1, F2, F3 の数値表示

フォルマント周波数の数値をUI上に表示する。

- **表示位置**: スペクトル表示 Canvas の上部または横に数値パネル
- **更新頻度**: 10 - 15 fps（描画フレームごとではなく間引く）
- **EMA平滑化**: 急激な値の変動を抑制
  - `F_display = alpha * F_new + (1 - alpha) * F_display`
  - alpha = 0.2 - 0.3 程度（10-15fps更新時）
- **表示形式**: `F1: 800 Hz  F2: 1300 Hz  F3: 2500 Hz`
- **有効桁数**: 整数Hz表示（小数点以下不要）

### 2.5 フォルマントマーカーのスペクトル上オーバーレイ

計算されたフォルマント周波数の位置をスペクトル曲線上にマーカーとして描画する。

- **マーカー形状**: 垂直の点線 + 上部にラベル（F1, F2, F3）
- **色分け**: F1, F2, F3 をそれぞれ異なる色で表示
- **描画タイミング**: スペクトル描画後にオーバーレイ層に描画（30 - 60fps）
- **マーカーの平滑移動**: EMA平滑化されたフォルマント値を使用（ちらつき防止）

### 2.6 F0 制御スライダー

AudioParam (k-rate) を使った基本周波数の制御UIを実装する。

- **パラメータ定義**: AudioWorkletProcessor の `parameterDescriptors` に F0 を追加
  ```typescript
  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 120, minValue: 50, maxValue: 400, automationRate: 'k-rate' }
    ];
  }
  ```
- **UI**: HTML range input スライダー
- **範囲**: 50Hz - 400Hz（男性低音域 ~ 女性高音域）
- **スケール**: 対数スケール（知覚的に均一なピッチ変化）
  - スライダー値 → F0: `F0 = 50 * (400/50)^(sliderValue)`（sliderValue: 0.0 - 1.0）
- **数値表示**: スライダー横に現在のF0値をHz表示
- **デフォルト値**: 120Hz（成人男性の平均的なF0）

### 2.7 Canvas 描画の2層構造

スペクトル表示のCanvas描画を2層に分離し、描画パフォーマンスを最適化する。

- **下層（スペクトル層）**: AnalyserNode のFFTデータを毎フレーム描画
  - 背景クリア + グリッド線 + スペクトル曲線
  - 60fps で更新
- **上層（マーカー/数値オーバーレイ層）**: フォルマントマーカー + 数値表示
  - フォルマント値の変化時のみ再描画（10 - 15fps）
  - 透明背景で下層の上に重ねる
- **実装方法**: 2枚の Canvas 要素を CSS position: absolute で重ねる
- **コンテキスト生成**: 下層は `{ alpha: false }` で生成（合成不要のため高速化）
- **上層は `{ alpha: true }`**（透明部分が必要）

### 2.8 描画パフォーマンス最適化

- **`{ alpha: false }` コンテキスト**: スペクトル層（下層）で使用し、ブラウザの合成処理を省略
- **Path2D の再利用**: スペクトル曲線の Path2D オブジェクトをフレーム間で再利用（GC削減）
- **devicePixelRatio 対応**: 高DPIディスプレイでのぼやけ防止
- **ResizeObserver**: ウィンドウリサイズ時のCanvas再設定

---

## 3. 実装に必要なエージェントチームの役割と人数

### 3.1 spectrum-renderer（1名）

**責務**: AnalyserNode の接続とCanvas スペクトル描画

- `src/audio/engine.ts` に AnalyserNode を追加・接続
- `src/ui/spectrum-display.ts` を新規作成
- 対数周波数軸でのスペクトル描画ロジック
- requestAnimationFrame ループの管理
- Canvas の devicePixelRatio 対応、ResizeObserver 設定

**入力**: engine.ts の既存 AudioContext ノードグラフ
**出力**: AnalyserNode インスタンス（formant-calculator と共有）、スペクトル Canvas

### 3.2 formant-calculator（1名）

**責務**: QR法によるフォルマント直接計算（44x44行列）

- `src/models/formant-calculator.ts` を新規作成
- 断面積配列 → 反射係数列の変換
- 反射係数列 → LPC多項式の変換（step-up procedure）
- コンパニオン行列の構成
- QR法による固有値計算（シフト付き）
- 固有値 → フォルマント周波数・帯域幅の抽出
- EMA平滑化ロジック

**入力**: 44要素の断面積配列（メインスレッドの現在値）
**出力**: FormantResult（F1, F2, F3 の周波数と帯域幅）

### 3.3 pitch-control（1名）

**責務**: F0の AudioParam 定義とスライダーUI

- `src/audio/worklet-processor.ts` に F0 の AudioParam (k-rate) を追加
- `src/audio/engine.ts` で AudioParam への接続インターフェースを公開
- `src/ui/controls.ts` にF0スライダーを追加
- 対数スケールのスライダー値 ↔ F0Hz 変換
- スライダー横のF0数値表示
- `src/audio/parameters.ts` にF0パラメータ定義を追加

**入力**: ユーザーのスライダー操作
**出力**: AudioParam 経由で AudioWorklet スレッドの F0 値が変化

### 3.4 canvas-optimizer（1名）

**責務**: 2層描画アーキテクチャと描画パフォーマンス最適化

- 2枚 Canvas の HTML/CSS レイアウト設計
- 下層 `{ alpha: false }`、上層 `{ alpha: true }` のコンテキスト管理
- フォルマントマーカー描画（垂直点線 + ラベル）
- F1, F2, F3 数値パネルの描画
- 描画頻度制御（スペクトル層: 60fps、オーバーレイ層: 10-15fps）
- Path2D の再利用戦略
- spectrum-renderer との Canvas 共有インターフェース

**入力**: spectrum-renderer のスペクトルデータ、formant-calculator のフォルマント値
**出力**: 最適化された2層Canvas描画

---

## 4. 提供範囲とテスト項目

### 4.1 スコープ内

- AnalyserNode の AudioWorkletNode 出力への接続
- Canvas 上のリアルタイムFFTスペクトル表示（対数周波数軸、dBスケール）
- フォルマント直接計算（断面積 → 反射係数 → LPC → QR法 → F1/F2/F3）
- フォルマント数値表示（EMA平滑化、10-15fps更新）
- フォルマントマーカーのスペクトル上オーバーレイ
- F0 AudioParam (k-rate) の定義と AudioWorklet 側の対応
- F0制御スライダー（対数スケール、50-400Hz）
- Canvas 2層描画（スペクトル層 + オーバーレイ層）
- 描画パフォーマンス最適化（`{ alpha: false }`, devicePixelRatio 対応）

### 4.2 スコープ外

- スペクトログラム（ウォーターフォール表示）: Phase 5 以降の検討事項
- LPC係数からの伝達関数表示（スペクトル包絡線）: Phase 5 以降
- F0の自動制御・ビブラート: Phase 4 の Auto Sing で実装
- 帯域幅（BW）の数値表示: フォルマント周波数のみ Phase 3 で対応
- マイク入力からの逆推定: スコープ外（REQUIREMENTS.md 7章）
- フォルマント計算のWebWorker化: Phase 3 ではメインスレッドで実行（性能問題が出た場合に再検討）
- スペクトルピーク検出によるフォルマント推定: 直接計算のみ採用

### 4.3 ユニットテスト

#### フォルマント計算の正確性テスト

```typescript
// テスト1: 均一管のフォルマント理論値との照合
// 均一管（全区間同一断面積）の場合:
//   F_n = (2n - 1) × c / (4L)
//   F1 = c / (4L) = 35000 / (4 × 17.5) = 500 Hz
//   F2 = 3 × 500 = 1500 Hz
//   F3 = 5 × 500 = 2500 Hz
// 許容誤差: ±50Hz（離散化誤差を考慮）
test('均一管のフォルマントが理論値と一致する', () => {
  const uniformAreas = new Float64Array(44).fill(4.0);
  const result = calculateFormants(uniformAreas);
  expect(result.f1).toBeCloseTo(500, -2); // ±50Hz
  expect(result.f2).toBeCloseTo(1500, -2);
  expect(result.f3).toBeCloseTo(2500, -2);
});
```

#### 反射係数 → LPC 変換の正確性テスト

```typescript
// テスト2: 既知の反射係数列からLPC多項式を構成し、
//          逆変換（LPC → 反射係数）で元に戻ることを検証
test('step-up/step-down の往復変換が一致する', () => {
  const reflectionCoeffs = generateTestReflectionCoeffs();
  const lpcCoeffs = stepUp(reflectionCoeffs);
  const recovered = stepDown(lpcCoeffs);
  for (let i = 0; i < reflectionCoeffs.length; i++) {
    expect(recovered[i]).toBeCloseTo(reflectionCoeffs[i], 10);
  }
});
```

#### QR法の収束テスト

```typescript
// テスト3: 既知の固有値を持つ行列でQR法の精度を検証
test('QR法が正しい固有値に収束する', () => {
  const knownEigenvalues = [/* 既知の値 */];
  const matrix = constructCompanionMatrix(lpcCoeffs);
  const eigenvalues = qrAlgorithm(matrix);
  // 固有値のペア（共役複素数）を周波数に変換して検証
});
```

#### 断面積 → 反射係数の変換テスト

```typescript
// テスト4: 基本的な反射係数の性質検証
test('反射係数が -1 < r < 1 の範囲に収まる', () => {
  const areas = generateVowelPreset('a');
  const coeffs = areasToReflectionCoeffs(areas);
  coeffs.forEach(r => {
    expect(Math.abs(r)).toBeLessThan(1);
  });
});
```

### 4.4 E2Eテスト

#### スペクトル表示の動作テスト

```
手順:
1. アプリを起動し Start ボタンを押す
2. スペクトル表示 Canvas が描画を開始することを確認
3. 周波数軸の目盛り（100Hz, 1kHz, 5kHz）が正しい位置に表示される

期待結果:
- スペクトル曲線がリアルタイムに更新される
- ハーモニクス（F0の整数倍）がスペクトル上にピークとして現れる
```

#### 母音プリセットとフォルマント表示の統合テスト

```
手順:
1. Start ボタンを押して音声合成を開始
2. 母音プリセット「あ」を選択
3. スペクトル上のフォルマントマーカー位置と数値表示を確認
4. 母音プリセット「い」に切り替え
5. フォルマントマーカーと数値が変化することを確認

期待結果:
- /a/: F1 ≈ 800Hz, F2 ≈ 1300Hz (マーカーが対応する位置に表示)
- /i/: F1 ≈ 300Hz, F2 ≈ 2300Hz (F1が下がり、F2が大きく上がる)
- 切替時にEMA平滑化により滑らかに遷移する
```

#### F0変更とスペクトル変化の統合テスト

```
手順:
1. 音声合成開始状態で母音プリセット「あ」を選択
2. F0スライダーを120Hz (デフォルト) に設定
3. スペクトルのハーモニクス間隔を目視確認
4. F0スライダーを240Hzに変更
5. ハーモニクス間隔が2倍に広がることを確認

期待結果:
- F0=120Hz: ハーモニクスが約120Hz間隔で並ぶ
- F0=240Hz: ハーモニクスが約240Hz間隔で並ぶ
- フォルマントマーカーの位置は変化しない（声道形状が同じなら）
- F0の数値表示がスライダーと連動する
```

---

## 5. 実装に関する懸念事項とレビュー項目

### 5.1 QR法の44x44行列の計算コスト

**懸念**: 44x44行列のQR分解が16.7ms（60fps）の描画予算内に収まるか。

- **見積もり**: TECHNICAL_RESEARCH.md では約1-3ms と見積もられている
- **対策**:
  - フォルマント計算は描画フレームごとではなく10-15fpsに間引く（66-100msの予算）
  - 断面積が変化していない場合は再計算をスキップ（前回値との比較）
  - 万一性能不足の場合、QR反復の最大回数を調整して精度と速度をトレードオフ
- **レビュー項目**: Chrome DevTools の Performance タブで formant-calculator の実行時間を計測し、p95 が5ms以下であることを確認

### 5.2 AnalyserNode の FFT と直接計算の整合性

**懸念**: AnalyserNode のスペクトルピーク位置と、直接計算のフォルマント周波数がずれる可能性。

- **原因**: AnalyserNode は実際の音声信号のFFT（音源特性を含む）、直接計算は声道の伝達関数のみ
- **影響**: スペクトル上のフォルマントマーカーがピーク位置と完全には一致しない場合がある
- **対策**: これは物理的に正しい挙動（音源のスペクトル傾斜が影響）であることをドキュメントに記載
- **レビュー項目**: 母音プリセットでのマーカー位置とスペクトルピークのずれが、ユーザーに混乱を与えない程度（±100Hz 以内）であることを確認

### 5.3 Canvas 再描画のパフォーマンス

**懸念**: 60fps でのスペクトル描画がフレームドロップなく動作するか。

- **リスク要因**:
  - 対数周波数軸へのマッピング計算（毎フレーム1024点）
  - Canvas の clearRect + 曲線描画のコスト
  - 声道エディタ Canvas との同時描画
- **対策**:
  - `{ alpha: false }` で合成コストを削減
  - 周波数→x座標の変換テーブルを事前計算（起動時またはリサイズ時に一度だけ）
  - lineTo のみで描画（bezierCurveTo は不使用）
  - 2層分離によりオーバーレイ層の更新頻度を下げる
- **レビュー項目**: Chrome DevTools の Performance タブで、16.7ms 予算内にスペクトル描画 + 声道エディタ描画が収まることを確認

### 5.4 F0 の AudioParam が k-rate であることの制約

**懸念**: k-rate AudioParam は128サンプル（≈2.9ms）単位でしか値が変化しない。

- **影響**:
  - スライダーの手動操作では知覚不能な粒度であり、実用上問題なし
  - Phase 4 のビブラート（5.5Hz）でも 128サンプル単位の階段状変化は十分細かい（1周期あたり約63ステップ）
- **ただし**: F0の急激な変化（ポルタメント等）で、位相アキュムレータのリセットやクリックノイズに注意が必要
- **レビュー項目**: F0スライダーを素早く動かした際に音声にクリックノイズが発生しないことを確認

### 5.5 メモリとGC

**懸念**: formant-calculator がフレームごとに配列を生成するとGCが発生し、UIがカクつく。

- **対策**:
  - 計算用の中間配列（反射係数、LPC係数、コンパニオン行列）を事前確保し再利用
  - Float64Array を使用（型付き配列のほうがGCプレッシャーが低い）
  - 計算結果オブジェクトも再利用（毎回 new しない）
- **レビュー項目**: Chrome DevTools の Memory タブで、スペクトル表示中にGCポーズが発生していないことを確認

---

## 6. 一から作り直すとしたら

### 6.1 Phase 1-3 を統合設計するなら

Phase 1 から AnalyserNode の接続とスペクトル Canvas の骨格を用意しておくべきだった。音が出た瞬間にスペクトルが見えると、声道パラメータのチューニングが格段にやりやすくなる。Phase 2 の母音プリセット調整でもスペクトル表示があれば、フォルマント目標値との照合を視覚的に行えた。

### 6.2 AnalyserNode を Phase 1 から接続しておくべきだったか

AnalyserNode 自体のコストはほぼゼロ（ブラウザネイティブ実装）であり、Phase 1 の engine.ts に最初から接続しておくのが理想。Canvas 描画まで実装しなくても、console.log でスペクトルピークを確認するだけでデバッグ効率が大幅に向上する。再設計するなら、Phase 1 の engine.ts で AnalyserNode を必ず接続し、Phase 3 では描画ロジックのみを追加する構成にする。

> **Phase 1 との整合性に関する注記**: Phase 1 チケット（6.5節）では AnalyserNode を「入れなくてよいもの」としている。これは「Phase 1 のスコープとして描画まで作り込む必要はない」という意味であり、本チケットの主張と矛盾しない。バランスの取れた結論は: **Phase 1 の engine.ts で AnalyserNode の接続（1行）だけ行い、描画やUI表示は Phase 3 で実装する**。接続コストはゼロであり、Phase 1 の複雑性を増さずにデバッグ利便性とPhase 3 への準備が得られる。Phase 1 チケットの「GainNode→destination の間に insert する設計にしておくだけで十分」という記述がこの方針と一致する。

### 6.3 フォルマント計算の WebWorker 化の検討

現在の設計ではメインスレッドでQR法を実行するが、以下の場合は WebWorker への移行を検討すべき:

- 行列サイズが大きくなる場合（N=44 なら問題ないが、N=48（48kHz）等への拡張時）
- 描画処理が増える場合（Phase 5 のスペクトログラム追加等）
- 低スペックデバイス対応が必要な場合

WebWorker 化する場合の設計:
```
[メインスレッド]                    [WebWorker]
断面積配列 → postMessage →       フォルマント計算（QR法）
Canvas描画 ← postMessage ←       FormantResult
```

ただし、postMessage のオーバーヘッド（シリアライゼーション）と Worker の起動コストを考慮すると、44x44 で 1-3ms の計算コストなら、メインスレッドでの実行が総合的に有利。postMessage のシリアライゼーションコスト自体は FormantResult（数値3-6個）程度なら数十us以下で無視できるが、Worker スレッドへの切り替えと応答待ちのラウンドトリップ（0.5-2ms）が加わるため、計算本体が1-3ms の場合は通信オーバーヘッドが相対的に大きい。

> **計算コスト見積もりの根拠**: TECHNICAL_RESEARCH.md の「1-3ms」は理論的見積もり（QR法の O(N^3) 複雑度から N=44 での概算）であり、実測値ではない。Phase 3 実装時に Chrome DevTools で実測し、5.1節のレビュー項目（p95 < 5ms）で検証すること。

### 6.4 Canvas 描画のアーキテクチャ再設計

声道エディタ（Phase 1）とスペクトル表示（Phase 3）の Canvas を統合的に管理するレンダリングループが最初から設計されていると理想的:

```typescript
// 統合レンダリングマネージャー
class RenderManager {
  private tractEditor: TractEditorRenderer;
  private spectrumDisplay: SpectrumRenderer;
  private formantOverlay: FormantOverlayRenderer;

  render(timestamp: number) {
    // 全Canvasを1つのrAFループで管理
    this.tractEditor.render(timestamp);
    this.spectrumDisplay.render(timestamp);  // 毎フレーム
    this.formantOverlay.render(timestamp);   // 間引き（10-15fps）
    requestAnimationFrame(this.render.bind(this));
  }
}
```

Phase 1 で tract-editor.ts が独自の rAF ループを持っている場合、Phase 3 で2つ目の rAF ループが走ることになる。ただし、現実の影響度は限定的である: **ブラウザの rAF コールバックは全て同一の VSync タイミングに同期される**ため、2つの rAF ループが「ずれる」ことはない。パフォーマンス上の無駄も、rAF コールバック呼び出し自体のコストは無視できる程度（数us）である。統合 RenderManager の主なメリットは同期ではなく、**描画順序の制御**（声道エディタとスペクトルを同じフレームで確実に更新）と**フレーム間引きの一元管理**（formantOverlay の 10-15fps 制御等）にある。再設計するなら、Phase 1 の段階でレンダリングマネージャーを導入するが、2つの独立 rAF ループでも実用上の問題は小さい。

### 6.5 補足: レビューによる追加事項

#### フォルマント直接計算のキャッシング戦略

QR法の計算コスト（1-3ms見積もり）は10-15fpsに間引いても毎回実行する必要はない。断面積配列が変化していなければフォルマントも変化しないため、**前回計算時の断面積配列との差分チェック**（Float64Array の要素比較、44要素なら数us）で再計算をスキップできる。特にユーザーがドラッグ操作をしていない静止状態では、計算コストを実質ゼロにできる。5.1節に「断面積が変化していない場合は再計算をスキップ」と記載済みだが、再設計時にはキャッシュ機構を formant-calculator の内部責務として最初から組み込むべき。

#### スペクトル表示の周波数分解能とFFTサイズの最適化

fftSize=2048（周波数分解能 21.5Hz）は F1 の識別に十分だが、低域の分解能を上げたい場合は fftSize=4096（10.8Hz）も選択肢となる。ただし、4096 サンプルのウィンドウ長は約93ms であり、時間分解能とのトレードオフが生じる。再設計時には、**fftSize を設定可能なパラメータ**として公開し、用途に応じて切り替えられる設計にすべき。

#### 高DPIディスプレイでのCanvas描画パフォーマンス

2.8節で devicePixelRatio 対応に言及しているが、パフォーマンスへの影響の検討が不足している。devicePixelRatio=2 のディスプレイでは Canvas のピクセル数が4倍になり、clearRect + lineTo の描画コストが増加する。対策として:
- スペクトル描画の解像度を論理ピクセルに制限する選択肢（`canvas.width = cssWidth` として DPR を適用しない）を検討
- グリッド線やラベルのみ高DPI、スペクトル曲線はフル解像度不要（1px幅の線を2x解像度で描画する意味は薄い）
- 描画コストが問題になった場合のフォールバック戦略を事前に設計しておく

#### Phase 4 の F0 制御 API との整合性

Phase 3 の 7.1 節で定義する `AudioEngine.setF0()` / `rampF0()` / `getF0AudioParam()` インターフェースは、Phase 4 のビブラート実装（OscillatorNode → GainNode → F0 AudioParam のチェーン）と整合している。ただし、Phase 4 の rebuild（6.2節）ではイベント駆動アーキテクチャ（`emit({ type: 'pitchChange', ... })`）を提案しており、直接的な `setF0()` 呼び出しとは設計思想が異なる。Phase 3 の API 設計時には、Phase 4 でイベントレイヤーをラップできるよう、**AudioEngine の F0 制御メソッドをシンプルかつ薄く保つ**ことが重要。

---

## 7. 後続タスクへの連絡事項

### 7.1 Phase 4（自動歌唱モード）向け

#### F0 を動的に変更する API

Phase 3 で追加する F0 AudioParam に対して、Phase 4 では以下のインターフェースで制御する:

```typescript
// engine.ts が公開するF0制御API
interface AudioEngine {
  setF0(value: number): void;                    // 即座に変更
  rampF0(target: number, duration: number): void; // linearRampToValueAtTime
  getF0AudioParam(): AudioParam;                  // 直接アクセス（高度な制御用）
}
```

- `setF0()`: `audioParam.setValueAtTime(value, audioContext.currentTime)` のラッパー
- `rampF0()`: ポルタメント用。`linearRampToValueAtTime` を使用
- `getF0AudioParam()`: ビブラートの正弦波変調を OscillatorNode → GainNode → F0 AudioParam のチェーンで実現する場合に必要

#### ビブラートに使う F0 の微細制御方法

Phase 4 のビブラート実装には2つの選択肢がある:

1. **OscillatorNode + GainNode → F0 AudioParam に接続**: Web Audio API ネイティブの変調。5.5Hz / ±30cent の正弦波ビブラートに最適。AudioParam の `setValueAtTime` と組み合わせ可能。
2. **process() 内で位相アキュムレータに直接加算**: 128サンプル単位のF0変動。ジッターやシマーと統合しやすい。

Phase 3 では選択肢1が可能な AudioParam 設計にしておくこと。F0の AudioParam が additive（加算）入力を受け付ける設計であることを確認しておく。

### 7.2 Phase 5（UI改善）向け

#### Canvas 描画の拡張ポイント

Phase 3 で構築するスペクトル表示の Canvas アーキテクチャを、Phase 5 で以下のように拡張できるよう設計しておく:

- **スペクトログラム追加**: スペクトル表示 Canvas の下に時間-周波数のウォーターフォール表示を追加する可能性あり。2層構造のアーキテクチャを3層以上に拡張できる設計にすること。
- **LPC包絡線の重畳**: スペクトル曲線の上に、LPC係数から計算した伝達関数（スペクトル包絡線）をオーバーレイする可能性あり。フォルマントマーカーと同じオーバーレイ層に追加できる設計にすること。
- **声道断面図の描画**: 横断面のアニメーション表示（MRI風の可視化）。別 Canvas として追加する可能性があるため、レンダリングループへの Canvas 登録が容易な設計にすること。
- **UI テーマ変更**: 描画色をハードコードせず、設定オブジェクトで管理すること。Phase 5 のダークモード/ライトモード対応に備える。
