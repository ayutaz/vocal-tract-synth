# PHASE6-001 子音基盤（摩擦音・破裂音）

## 1. 概要

| 項目 | 内容 |
|------|------|
| チケットID | PHASE6-001 |
| フェーズ名 | Phase 6 — 子音基盤（摩擦音・破裂音） |
| マイルストーン | [docs/MILESTONES.md `Phase 6` セクション](../MILESTONES.md) |
| 要件定義 | [docs/REQUIREMENTS_CONSONANT_TTS.md 2.1 / 2.2 / 2.4 / 2.5](../REQUIREMENTS_CONSONANT_TTS.md) |
| 技術調査 | [docs/CONSONANT_RESEARCH.md 1.1〜1.6 / 2.1〜2.4](../CONSONANT_RESEARCH.md) |
| 状態 | 計画中（未着手） |
| 前提条件 | Phase 5 完了（Kelly-Lochbaum 44区間モデル、KLGLOTT88/LF声門音源、壁面損失、Auto Sing が動作中） |
| 推定工数 | 3 名構成 × 約 5 営業日 |
| 優先度 | 高（Phase 7-9 の全機能の基盤） |
| 成果物（新規） | `src/audio/consonant-presets.ts` |
| 成果物（変更） | `src/models/vocal-tract.ts`, `src/audio/worklet-processor.ts`, `src/types/index.ts`, `src/main.ts` または `src/ui/controls.ts` |

---

## 2. タスク目的とゴール

### 2.1 目的

Phase 1-5 で構築した「母音合成専用の声の楽器」を、子音発声の物理基盤を備えた合成器に拡張する。Phase 6 単体では UI からデモボタンで /s/, /k/, /t/, /p/ を発声できる段階を到達点とし、後続フェーズ（鼻腔管・テキスト読み上げ）の土台となるインフラ（MIN_AREA 二段化・狭窄ノイズ注入・サンプル精度補間）を確立する。

母音合成は周期的な声門音源と緩やかな声道形状で十分に成立するが、子音は (a) 完全閉鎖や強い狭窄 (b) 乱流由来の広帯域ノイズ (c) 5〜20ms の急峻な遷移 という、母音とは質的に異なる3要素を必要とする。Phase 5 までの実装はこれらをいずれもサポートしていないため、Phase 6 では物理層 (`vocal-tract.ts`)・通信層 (`worklet-processor.ts`)・データ層 (`consonant-presets.ts`) の3層を協調して拡張する。

### 2.2 達成基準

- 完全閉鎖 (面積 0.01 cm²) を物理モデル経由で安定に表現できる
- 狭窄区間に挿入された乱流ノイズが Biquad BPF で帯域整形され、スペクトルピークが目的周波数 (例 /s/ で 5〜7 kHz) に出現する
- 5〜20 ms の閉鎖→開放遷移がサンプル精度で線形補間され、クリックノイズなく再生される
- /s/, /k/, /t/, /p/ の 4 音素を手動デモボタンから発声できる
- ノイズ注入の追加コストが要件 2.5 の +8 ops/sample 以内
- process() の追加メモリアロケーションがゼロ（GC 安全）
- 既存の母音プリセット・Auto Sing・スペクトル表示・フォルマント計算が退行なく動作する

### 2.3 完了条件

1. `setMinArea(0.01)` 相当のプログラム制御で MIN_AREA を 0.01 cm² まで下げ、UI ドラッグの下限は 0.3 cm² のまま維持する二段化が動作する
2. `setConstrictionNoise` メッセージで指定した区間に Biquad BPF 整形済みノイズが注入され、`vocal-tract.test.ts` のスペクトル検証で目的帯域にピークが出現する
3. `scheduleTransition` メッセージで送られた `targetAreas` への線形補間が `durationSamples` 単位で動作し、補間中に新メッセージを受信した場合は現在値を起点に新遷移へ即座切替できる
4. `consonant-presets.ts` に /s/, /k/, /t/, /p/, /g/, /d/, /b/, /ɕ/, /ç/, /ɸ/, /h/, /z/, /tɕ/, /ts/, /dʑ/, /dz/, /ɾ/, /j/, /w/ のプリセットが定義されている
5. デモ UI に /s/, /k/, /t/, /p/ の 4 ボタンを追加し、押下するとそれぞれの音素が単独発声される
6. `vocal-tract.test.ts` / `glottal-source.test.ts` の既存テストが全て通過する
7. ベンチマーク (`process()` 1 quantum 内のコスト) が母音発声時 + ノイズ注入 1 区間で +8 ops/sample 以内に収まる
8. Chrome / Firefox / Edge の最新版で動作確認済み

---

## 3. 実装する内容の詳細

### 3.1 MIN_AREA の二段階制限

`src/types/index.ts` の `MIN_AREA = 0.3` を「UI ドラッグ下限」と再定義し、新たに `MIN_AREA_PROGRAM = 0.01` を追加する。`vocal-tract.ts` の `setAreas()` は `MIN_AREA_PROGRAM` でクランプし、`tract-editor.ts` のドラッグ処理は従来通り `MIN_AREA` でクランプする。

```typescript
// src/types/index.ts
export const MIN_AREA = 0.3;          // UI ドラッグ下限（既存名を維持）
export const MIN_AREA_PROGRAM = 0.01; // プログラム制御下限（子音用、新規）
```

```typescript
// src/models/vocal-tract.ts setAreas() 内
import { MIN_AREA_PROGRAM } from '../types/index.js';
// ...
if (a < MIN_AREA_PROGRAM) a = MIN_AREA_PROGRAM;
```

数値安定性: r = (4.0 - 0.01) / (4.0 + 0.01) ≈ 0.995。Smith 1 乗算接合の係数として安定範囲。完全閉鎖区間が連続すると bidirectional reflection でエネルギーが累積する可能性があるため、壁面損失 mu = 0.999 と既存ソフトクリッピング (SOFT_CLIP_THRESHOLD = 10.0) を保険として保持する。

### 3.2 VocalTract の狭窄ノイズ注入

`vocal-tract.ts` の散乱ループ内で、指定された狭窄区間 k の前進波 f[k] にバンドパスフィルタ整形済みのノイズを加算する。実装は GC-free 制約に従い、全バッファ・状態をコンストラクタで事前確保する。

```typescript
// 追加するメンバ（コンストラクタで初期化）
private constrictionPosition: number = -1; // -1 = 無効
private constrictionGain: number = 0;
private noiseSeed: number = 13579;          // LCG 独立シード
// Biquad BPF 状態（Direct Form II Transposed）
private bpfB0 = 0; private bpfB1 = 0; private bpfB2 = 0;
private bpfA1 = 0; private bpfA2 = 0;
private bpfZ1 = 0; private bpfZ2 = 0;
```

```typescript
// 散乱ループ後、各半ステップ内で実行
if (this.constrictionPosition >= 0) {
  // LCG ノイズ生成 (2 ops): seed = (seed * 1664525 + 1013904223) | 0
  this.noiseSeed = (Math.imul(this.noiseSeed, 1664525) + 1013904223) | 0;
  const white = this.noiseSeed * 4.6566e-10; // [-1, 1] 正規化

  // Biquad BPF (5 ops, Direct Form II Transposed)
  const bp = this.bpfB0 * white + this.bpfZ1;
  this.bpfZ1 = this.bpfB1 * white - this.bpfA1 * bp + this.bpfZ2;
  this.bpfZ2 = this.bpfB2 * white - this.bpfA2 * bp;

  // 注入 (1 op)
  f[this.constrictionPosition] += this.constrictionGain * bp;
}
```

`setConstrictionNoise(position, intensity, centerFreq, bandwidth)` メソッドを公開し、Biquad 係数を RBJ Cookbook の BPF (constant 0 dB peak gain) 公式で計算してメンバに格納する。中心周波数 0 や intensity 0 を渡すと `constrictionPosition = -1` となりノイズ計算自体をスキップする。

合計コスト: LCG (2 ops) + Biquad (5 ops) + 加算 (1 op) = **8 ops/sample**。要件 2.5 の上限と一致。

### 3.3 子音プリセットデータ（consonant-presets.ts）

新規ファイル `src/audio/consonant-presets.ts` に、技術調査 1.1〜1.5 の表に基づくプリセットを定義する。型定義は再利用性のため `src/types/index.ts` に追加する。

```typescript
// src/types/index.ts に追加
export type ConsonantId =
  | 's' | 'sh' | 'h' | 'hi' | 'fu' | 'z'           // 摩擦音
  | 'k' | 't' | 'p' | 'g' | 'd' | 'b'              // 破裂音
  | 'ts' | 'tsh' | 'dz' | 'dzh'                    // 破擦音
  | 'r' | 'j' | 'w';                               // 弾音・半母音

export type ConsonantCategory =
  | 'plosive'    // 破裂音（閉鎖→バースト→VOT）
  | 'fricative'  // 摩擦音（持続的狭窄+ノイズ）
  | 'affricate'  // 破擦音（閉鎖→摩擦の連続）
  | 'flap'       // 弾音
  | 'approximant'; // 半母音

export interface ConsonantPreset {
  id: ConsonantId;
  ipa: string;                       // 'k', 'tɕ' 等
  category: ConsonantCategory;
  voiced: boolean;                   // 有声/無声
  // 閉鎖/狭窄区間の指定 (NUM_SECTIONS=44 における index 範囲)
  constrictionRange: { start: number; end: number };
  constrictionArea: number;          // cm² (閉鎖時=0.01, 摩擦時=0.10〜0.30)
  // ノイズパラメータ（摩擦音・バースト用）
  noise?: {
    centerFreq: number;              // Hz
    bandwidth: number;               // Hz
    gain: number;                    // 0.2〜0.8
  };
  // 時間構造
  closureMs?: number;                // 閉鎖区間長（破裂・破擦のみ）
  burstMs?: number;                  // バースト長（破裂・破擦のみ）
  frictionMs?: number;               // 摩擦区間長（摩擦・破擦）
  vot?: number;                      // ms (有声=負, 無声=正)
}
```

```typescript
// src/audio/consonant-presets.ts (例)
export const CONSONANT_PRESETS: Record<ConsonantId, ConsonantPreset> = {
  s: {
    id: 's', ipa: 's', category: 'fricative', voiced: false,
    constrictionRange: { start: 6, end: 9 },   // 16点 idx 2-3 ≒ 44区間 idx 6-9
    constrictionArea: 0.12,
    noise: { centerFreq: 6000, bandwidth: 4000, gain: 0.7 },
    frictionMs: 70,
  },
  k: {
    id: 'k', ipa: 'k', category: 'plosive', voiced: false,
    constrictionRange: { start: 14, end: 17 }, // 16点 idx 5-6 ≒ 44区間 idx 14-17
    constrictionArea: 0.01,
    noise: { centerFreq: 4000, bandwidth: 6000, gain: 0.5 },
    closureMs: 60, burstMs: 10, vot: 30,
  },
  // ... 残り 17 音素
};
```

16制御点 → 44区間の index 換算は `Math.round(idx_16 * (44/16))` を基準とし、`constrictionRange` は閉鎖/狭窄を実現する 44区間側の連続 index を直接記述する（プリセット定義時にスプライン補間を経ずに済むため）。

### 3.4 Worklet サンプル精度補間（scheduleTransition）

`src/types/index.ts` の `WorkletMessage` 判別共用体に新規メッセージを追加する。

```typescript
| { type: 'setConstrictionNoise'; position: number; intensity: number;
    centerFreq: number; bandwidth: number }
| { type: 'scheduleTransition'; targetAreas: Float64Array; durationSamples: number }
```

`worklet-processor.ts` に補間状態を追加する。

```typescript
private transitionActive: boolean = false;
private transitionStartAreas: Float64Array = new Float64Array(NUM_SECTIONS);
private transitionTargetAreas: Float64Array = new Float64Array(NUM_SECTIONS);
private transitionInterimAreas: Float64Array = new Float64Array(NUM_SECTIONS);
private transitionElapsedSamples: number = 0;
private transitionDurationSamples: number = 0;
```

`onmessage` ハンドラで `scheduleTransition` を受信した時:
1. `vocalTract` の現在 areas を `transitionStartAreas` にコピー（既存値を始点とする）
2. `targetAreas` を `transitionTargetAreas` にコピー
3. `transitionElapsedSamples = 0`, `transitionDurationSamples = msg.durationSamples`
4. `transitionActive = true`

`process()` 内で各サンプル毎に補間を進める（128 サンプル quantum 中で適切な頻度に間引いて良い。例: 16 サンプル毎に再計算）:

```typescript
if (this.transitionActive) {
  const t = this.transitionElapsedSamples / this.transitionDurationSamples;
  if (t >= 1.0) {
    // 完了: 最終値を vocalTract に commit
    this.vocalTract.setAreas(this.transitionTargetAreas);
    this.transitionActive = false;
  } else {
    for (let k = 0; k < NUM_SECTIONS; k++) {
      this.transitionInterimAreas[k] =
        this.transitionStartAreas[k] +
        (this.transitionTargetAreas[k] - this.transitionStartAreas[k]) * t;
    }
    this.vocalTract.setAreas(this.transitionInterimAreas);
  }
  this.transitionElapsedSamples += INTERPOLATION_INTERVAL_SAMPLES;
}
```

補間途中で新 `scheduleTransition` を受信した場合: `transitionStartAreas` に「補間中の現在値」を再格納して新遷移を上書き開始する（クリック回避）。

既存 `setAreas` メッセージ受信時: 補間中であっても即座に確定値として上書きする（手動操作優先）。両者の競合は 6.3 章で扱う。

### 3.5 子音手動トリガーUI（デモ用）

Phase 6 ではフルテキスト入力 UI は実装しない（Phase 9）。デモ用に既存 UI の隅に 4 ボタンを配置する。

```html
<!-- index.html の母音プリセットボタン群の隣 -->
<div class="consonant-demo-buttons">
  <button id="consonant-s-btn">/s/</button>
  <button id="consonant-k-btn">/k/</button>
  <button id="consonant-t-btn">/t/</button>
  <button id="consonant-p-btn">/p/</button>
</div>
```

`src/ui/controls.ts` または `src/main.ts` でクリックイベントを受け、`engine.ts` の新メソッド `playConsonant(id: ConsonantId)` を呼ぶ。`playConsonant` の責務:

1. 現在の母音プリセットの areas を「先行/後続母音形状」として保持
2. プリセットに従って閉鎖/狭窄形状を生成（全体: 母音形状を起点に `constrictionRange` 内のみ `constrictionArea` で上書き）
3. 摩擦音: `setConstrictionNoise` を送信 → `scheduleTransition` で母音→狭窄→母音遷移
4. 破裂音: `scheduleTransition` で閉鎖 → `closureMs` 待機 → `setConstrictionNoise` (バースト) + `scheduleTransition` で開放 → VOT 後にノイズ停止
5. シーケンスは `setTimeout` ベースで簡易実装（Phase 8 の phoneme-player で精密化）

---

## 4. 実装に必要なエージェントチーム

### 4.1 audio-dsp エージェント

| 項目 | 内容 |
|------|------|
| 担当ファイル | `src/models/vocal-tract.ts`, `src/types/index.ts` (定数追加) |
| 入力 | Phase 5 完成版の vocal-tract.ts、CONSONANT_RESEARCH.md 2.1〜2.2、要件定義 2.5 |
| 出力 | MIN_AREA 二段化 + ノイズ注入 + Biquad BPF を含む vocal-tract.ts |
| 完了条件 | `vocal-tract.test.ts` 既存テストが全通過 + ノイズ注入の 8 ops/sample コスト要件達成 + 数値発散なし |

### 4.2 consonant-data エージェント

| 項目 | 内容 |
|------|------|
| 担当ファイル | `src/audio/consonant-presets.ts` (新規), `src/types/index.ts` (型追加) |
| 入力 | CONSONANT_RESEARCH.md 1.1〜1.5、REQUIREMENTS_CONSONANT_TTS.md 2.1 表 |
| 出力 | 19音素のプリセットデータ + 型定義 + 16点⇔44区間 index 換算ヘルパー |
| 完了条件 | プリセット境界値テスト全通過 + audio-dsp と integration-test が型を import して使える |

### 4.3 integration-test エージェント

| 項目 | 内容 |
|------|------|
| 担当ファイル | `src/audio/worklet-processor.ts`, `src/audio/engine.ts`, `src/main.ts`, `src/ui/controls.ts`, `index.html` |
| 入力 | audio-dsp の vocal-tract.ts、consonant-data の consonant-presets.ts |
| 出力 | scheduleTransition / setConstrictionNoise の Worklet ハンドラ + デモ UI 4 ボタン + engine.ts の playConsonant API |
| 完了条件 | /s/, /k/, /t/, /p/ がブラウザでクリック発声可能 + スペクトル目視検証 + 補間クリックノイズなし |

### 4.4 依存関係

```
       audio-dsp ──┐
                   ├──→ integration-test ──→ デモ動作 + E2E検証
       consonant-data ─┘
```

audio-dsp と consonant-data は並行で進行可能（型定義のみ先に共有）。integration-test は両者の完了を待ってから着手するが、worklet-processor.ts のメッセージ型拡張だけは先行して進められる。

---

## 5. 提供範囲とテスト項目

### 5.1 スコープ内

- 破裂音 /k/, /t/, /p/ + 有声版 /g/, /d/, /b/
- 摩擦音 /s/, /ɕ/, /h/, /ç/, /ɸ/ + 有声版 /z/, /dʑ/
- 破擦音 /tɕ/, /ts/, /dʑ/, /dz/
- 弾音 /ɾ/、半母音 /j/, /w/
- MIN_AREA 二段階制限（UI=0.3 / プログラム=0.01）
- 狭窄ノイズ注入（1 区間のみ。複数同時注入は範囲外）
- Worklet サンプル精度線形補間
- デモ用 4 音素ボタン UI

### 5.2 スコープ外

- 鼻音 /m/, /n/, /ɲ/（Phase 7 で鼻腔管と同時実装）
- ひらがな→音素変換、テキスト読み上げ（Phase 8）
- フルテキスト入力 UI、音素タイムライン表示（Phase 9）
- 撥音「ん」異音規則（Phase 7 / 8 にまたがる）
- コアーティキュレーション（先行/後続母音による狭窄位置の連続変化）の高度な実装
- 鼻腔分岐管・3ポート接合
- 複数狭窄の同時注入（Phase 8 で必要になれば再検討）

### 5.3 ユニットテスト項目

`src/models/vocal-tract.test.ts` を拡張する。

| テストID | 内容 | 期待動作 |
|---------|------|---------|
| UT-01 | MIN_AREA 境界値 | `setAreas([0.005,...])` でクランプ後 0.01 になる、`setAreas([0.5,...])` はそのまま 0.5 |
| UT-02 | MIN_AREA 連続区間で発散しない | 全区間 0.01 を 1 秒シミュレートして NaN/Inf が出ない、ピーク振幅 < 100 |
| UT-03 | Biquad BPF 周波数応答 | sweepInput を generate → FFT → 中心周波数 ±1 kHz 内にピーク、3dB 帯域幅が指定値 ±20% |
| UT-04 | LCG 乱数性 | 10000 サンプルで平均 < 0.01、分散 > 0.3、自己相関 1 サンプル < 0.05 |
| UT-05 | scheduleTransition 補間精度 | start=均一管、target=/s/形状、duration=2205 サンプル(50ms) で中間 t=0.5 時に各区間が線形中点 |
| UT-06 | scheduleTransition 上書き | 補間 50% 進行時に新 transition を投入、現在値起点で再開 |
| UT-07 | setAreas vs scheduleTransition 競合 | 補間中の setAreas は即時上書き＆補間停止 |
| UT-08 | consonant-presets 妥当性 | 全 19 音素について constrictionRange in [0,43]、constrictionArea ∈ [0.01, 0.5]、有声破裂は VOT < 0 |
| UT-09 | ノイズ無効化スキップ | constrictionPosition = -1 時に LCG/Biquad の計算が走らない（performance.now() 比較） |
| UT-10 | GC 安全性 | processSample を 100 万回呼んで Heap allocation が増えない (Chrome DevTools Memory profiler 確認) |

### 5.4 E2E テスト項目

| テストID | 内容 | 期待動作 |
|---------|------|---------|
| E2E-01 | /s/ 単独発声 | デモボタン押下 → 約 70 ms の摩擦音、スペクトルで 5-7 kHz 帯にピーク |
| E2E-02 | /k/ 単独発声 | 閉鎖 60 ms → バースト → /a/遷移、波形にクリックなし、スペクトルで広帯域バースト |
| E2E-03 | /t/ 単独発声 | 歯茎位置（idx 6-9）の閉鎖→バースト、/k/ より高域寄り |
| E2E-04 | /p/ 単独発声 | 両唇位置（idx 0-2）の閉鎖→バースト、低域中心の弱バースト |
| E2E-05 | 既存母音プリセット非退行 | /a/, /i/, /u/, /e/, /o/ ボタンが Phase 5 と同じ波形・スペクトルを出力 |
| E2E-06 | Auto Sing 非退行 | Auto Sing 起動 → 5 音素以上の母音遷移が Phase 5 と同等 |
| E2E-07 | パフォーマンス | Chrome DevTools Performance タブで quantum 内 process() < 1.45 ms（要件 6） |
| E2E-08 | クロスブラウザ | Firefox / Edge でも E2E-01〜04 が同等動作 |
| E2E-09 | 連続デモボタン押下 | /s/ → /k/ → /s/ を 100 ms 間隔で押下、補間が崩れず音切れ・クリックなし |

---

## 6. 実装に関する懸念事項とレビュー項目

### 6.1 GC 安全性（process() 内アロケーション）

AudioWorklet の process() は 2.9 ms ごとに呼ばれるため、内部での `new` / 配列リテラル / オブジェクトリテラルは GC を誘発しオーディオドロップアウトの直接原因となる。

**チェック項目**
- [ ] vocal-tract.ts の processSample / setAreas / setConstrictionNoise で `new` キーワード非使用
- [ ] worklet-processor.ts の process() / onmessage 内で配列リテラル `[...]` 非使用
- [ ] `transitionStartAreas` / `transitionTargetAreas` / `transitionInterimAreas` をコンストラクタで `new Float64Array(NUM_SECTIONS)` で事前確保
- [ ] postMessage 受信時の `msg.targetAreas` を `transitionTargetAreas` に **コピー** (copyWithin / set) し、参照保持しない
- [ ] Biquad 状態変数を全て `private` メンバとしてクラスフィールド化
- [ ] Chrome DevTools Memory profiler で 1 分連続再生時のヒープ変動 < 100 KB

### 6.2 MIN_AREA 0.01 による数値発散リスク

完全閉鎖区間 (0.01 cm²) が連続すると、反射係数 r ≈ 0.995 が続き、bidirectional reflection でエネルギーが累積する可能性がある。

**チェック項目**
- [ ] 全区間 0.01 で 10 秒シミュレートし NaN/Inf が出ない (UT-02)
- [ ] 反射係数の絶対値が 1.0 を超えないことを `updateReflectionCoefficients` 内で assert
- [ ] 既存ソフトクリッピング (SOFT_CLIP_THRESHOLD = 10.0) を維持
- [ ] WALL_LOSS_FACTOR (0.999) を変更しない（変えるとフォルマント帯域幅が変動する）
- [ ] 閉鎖→開放遷移時に「狭窄区間に蓄積した波エネルギー」が突発放出されてバーストになる挙動を（むしろ望ましいが）数値的に検証

### 6.3 scheduleTransition と既存 setAreas の競合

`setAreas` は手動 UI 操作（ドラッグ）由来、`scheduleTransition` はプログラム制御由来。Phase 6 ではモード排他制御を導入しないため、両者が同時に届く可能性がある。

**チェック項目**
- [ ] 補間中の `setAreas` 受信は補間を即停止し、`setAreas` の値を確定値とする
- [ ] 補間中の `scheduleTransition` 受信は現在の補間中間値を新 startAreas として上書き再開
- [ ] テストケース UT-06 / UT-07 で両ケースを検証
- [ ] Phase 9 で OperationMode 排他制御が入った後に簡素化できるよう、優先度ロジックを 1 関数にまとめる

### 6.4 コアーティキュレーションの実装深さ

子音は本質的に「先行/後続母音との関係」で実現される。Phase 6 では「母音形状を起点に狭窄区間のみ上書き」という最小実装にとどめ、本格的なコアーティキュレーションは Phase 8 の phoneme-timeline で実装する。

**チェック項目**
- [ ] consonant-presets.ts のドキュメントコメントに「先行/後続母音形状を呼び出し側で渡す」前提を明記
- [ ] engine.ts の `playConsonant(id)` が現在の `currentVowelAreas` を保持して使う
- [ ] 母音遷移の補間カーブを線形に固定（Phase 8 で raised cosine などに差し替え可能なよう関数化）
- [ ] /j/, /w/ の半母音は「/i/, /u/ 形状を 50 ms 維持してから後続母音へ遷移」という最低限の実装で OK

---

## 7. 一から作り直すとしたらどうするか

Phase 1-5 は「母音中心の声の楽器」として設計されており、子音は当初から想定外であった。仮にこの段階で時間を巻き戻して、最初から子音と母音の両方を視野に入れて設計するならば、以下の点が変わる。

**設計フェーズの順序**: 現行は (1) 物理モデル → (2) 母音 → (3) 表現拡張 (Auto Sing, ジッター/シマー) → (4) 子音 という順で進行している。再設計するなら (1) 物理モデル → (2) 子音まで含めた声道制御の抽象 → (3) 母音 → (4) 表現拡張 とし、最も制約の厳しい子音要件 (完全閉鎖、サンプル精度遷移、GC-free ノイズ注入) を先に解決しておく。母音は子音の特殊ケースとして扱える (母音 = 「狭窄なし、ノイズなし、長時間定常」) ため、子音の API があれば母音は容易に乗せられる。

**VocalTract クラスのインターフェース設計**: 現行の `setAreas(areas)` / `processSample(glottal)` という単純な 2 メソッド構成は母音には十分だが、子音には足りない。再設計版では `processSample` の引数を `processSample(glottal: number, sampleIndex: number): number` とし、内部で「予約済み補間トラジェクトリ」を参照してサンプル毎の補間を自動実行する。これにより `scheduleTransition` のような後付け機構ではなく、最初から「断面積はキーフレーム列 + 補間関数」が一級概念となる。`setConstrictionNoise` も同様にトラジェクトリとして設計し、`setAreas` は単に「現在キーフレームを書き換える」糖衣構文に降格する。

**断面積制御の粒度**: 16 制御点 → スプライン補間 → 44 区間という現行の二層構造は、UI のドラッグ操作には適しているが子音には粗すぎる (16 点で /s/ の歯茎位置を狙い撃ちするのは難しい)。再設計版では UI 制御点と内部表現を完全分離し、内部は常に 44 区間の Float64Array として扱い、UI は「44 区間に対する任意個数の制御点」として柔軟に変更可能にする。子音プリセットは内部 44 区間配列を直接記述し、スプライン経由の歪みを回避する。

**Worklet ↔ メインスレッドの責任分割**: 現行は「メインスレッドが断面積の正、Worklet がレプリカ」だが、子音の遷移はサンプル精度のため必然的に Worklet 側で時間進行する。再設計版では「メインスレッドはイベント記述子 (PhonemeEvent) の正、Worklet はサンプル単位の状態と物理計算の正」と明確に分離し、postMessage は「キューイング命令」のみで「即時値の同期」は廃止する。これにより `scheduleTransition` と `setAreas` の優先度競合 (6.3) が消える。

**scheduleTransition のような機構を Phase 1 から入れるべきだったか**: イエス。Phase 1 で母音の「あ→い」遷移をクリックノイズなく実現するだけでも、本質的にはサンプル精度補間が必要 (現行は rAF ベースで 16 ms 粒度のため、注意深く聞くと階段状ノイズが乗る)。Phase 1 でこれを諦めた結果、Phase 6 で同じ機構を「後付け」する必要が生じている。

**consonant-presets.ts の配置場所**: `src/audio/` か `src/models/` か。`src/audio/` は Worklet との通信レイヤの色が強く、純粋データであるプリセットは `src/models/` の方が適切である。再設計版では `src/models/` 配下を「物理モデル + データ定義」、`src/audio/` を「Web Audio API ラッパ + メッセージ通信」として明確に責務分離する。Phase 6 では MILESTONES.md の指定に従い `src/audio/` に置くが、Phase 8 で `models/` への移動を検討すべき。

**ノイズ注入の配置**: VocalTract クラス内に置く現行案は GC-free のために合理的だが、責務としては「乱流発生 + フィルタ整形」という独立した DSP モジュール (`turbulence-noise.ts`) に切り出し、VocalTract が依存性注入で受け取る形が望ましい。再設計版なら最初からこの切り出しを行い、テストも独立して書ける (UT-03, UT-04 が VocalTract 全体に依存しない)。

**実装順序（再設計版）**: ①types/parameters → ②Worklet 通信プロトコル (含む scheduleTransition) → ③turbulence-noise モジュール → ④VocalTract (子音対応含む) → ⑤声門音源 → ⑥プリセット (母音 + 子音) → ⑦UI → ⑧Auto Sing → ⑨テキスト読み上げ。これにより Phase 6 で発生している「後付け改修」コストがほぼゼロになる。

---

## 8. 後続タスクへの連絡事項

### 8.1 Phase 7 (鼻腔管モデル・鼻音) への申し送り

- **影響ファイル**: `vocal-tract.ts` の散乱ループに 3 ポート接合を追加する箇所が、Phase 6 でノイズ注入を追加した位置の直前または直後となる。両者の順序が出力に影響するためテストで確認すること。
- **VocalTract API 拡張**: `setNasalCoupling(velopharyngealArea)` を追加する際、Phase 6 で導入した `setConstrictionNoise` の引数命名 (camelCase + 単位コメント) と一貫させること。
- **velum 閉鎖時のスキップ**: Phase 6 の `constrictionPosition === -1` スキップと同じパターンで、`velopharyngealArea === 0` 時に鼻腔管計算を完全にスキップすること。process() 1 quantum 内で if 分岐 1 つで実現する。
- **3 ポート接合の係数**: 口腔・咽頭・鼻腔の境界での Smith 接合と Phase 6 の 1 乗算接合を共存させる。係数計算ヘルパーを `vocal-tract.ts` に切り出すと再利用しやすい。
- **MIN_AREA_PROGRAM の継承**: 鼻音 /m/, /n/ の口腔閉鎖は Phase 6 の `MIN_AREA_PROGRAM = 0.01` を流用するため、定数を変更しないこと。
- **scheduleTransition の対象**: Phase 6 では口腔断面積のみ補間対象。Phase 7 では `velopharyngealArea` も補間対象に加える必要がある。型を `{ targetAreas: Float64Array; targetVelumArea?: number; durationSamples: number }` に拡張すること。

### 8.2 Phase 8 (テキスト→音素→発声) への申し送り

- **consonant-presets.ts の追加点**: Phase 6 で /m/, /n/, /ɲ/ は未追加 (Phase 7 範囲)。Phase 8 着手時にはこれらが入っている前提で良いが、拗音派生 (/kʲa/, /sʲa/ など) と特殊拍 /Q/ (促音) /ɴ/ (撥音) の取り扱いが残る。`ConsonantId` 型をリテラル和集合からテンプレートリテラル型へ拡張するか検討。
- **scheduleTransition API の安定化**: Phase 8 では phoneme-player が大量の `scheduleTransition` を高頻度で送信する。Phase 6 段階で「補間中の上書き挙動」「補間完了後のメッセージキュー処理」「2 つ以上の補間が pending な場合の優先度」を仕様化しドキュメント化しておくこと。Phase 8 着手時にはこのドキュメントが API 仕様の正となる。
- **playConsonant API の置き換え**: Phase 6 の `engine.ts#playConsonant(id)` は Phase 8 で `phoneme-player.ts` に統合される。Phase 6 の API は「phoneme-player の内部実装で再利用可能な低レベルプリミティブ」として設計し、`setTimeout` ベースのシーケンス処理は engine.ts の外 (controls.ts や main.ts) に置くこと。
- **コアーティキュレーション**: Phase 6 では「母音形状起点の上書き」のみ。Phase 8 で本格対応する際、`consonant-presets.ts` のプリセット形式に「先行/後続母音による補正テーブル」を追加可能なよう、`ConsonantPreset` 型を将来拡張可能に設計しておくこと（Optional フィールドの追加が破壊変更にならないよう、interface ベースで定義）。
- **強度・F0 の連動**: Phase 6 では子音時の声門振幅・F0 は変更しない（既存スライダー値そのまま）。Phase 8 で強度テーブル（要件 3.3）と連動させる際、`engine.ts` 経由で声門音源パラメータを変更するインターフェースが必要。Phase 6 段階で `setGlottalAmplitude(level: number)` を追加するかは consonant-data エージェントと相談。

### 8.3 Phase 9 (テキスト読み上げ UI) への申し送り

- **デモ UI の扱い**: Phase 6 の 4 ボタン (/s/, /k/, /t/, /p/) は Phase 9 で完成形 UI が入った時点で削除するか、開発者向け debug モードに移すこと。production ビルドでは非表示にする。
- **モード遷移時の子音再生停止**: Phase 9 で OperationMode (`manual` | `autoSing` | `textRead`) の切替時に、進行中の `scheduleTransition` をキャンセルする必要がある。Phase 6 段階で `cancelTransition()` メッセージを worklet-processor.ts に追加しておくこと（実装は `transitionActive = false` のみ）。
- **constrictionPosition マーカー**: Phase 9 では声道エディタ Canvas 上に「現在の狭窄位置」マーカーを描画する。Phase 6 で worklet → メイン方向の `port.postMessage({type:'constrictionStateChanged', position, intensity})` を送るかは要検討（送ると UI 側で参照できるが、Phase 6 では engine.ts 側で「最後に送信した狭窄位置」を保持する方式で十分）。
- **既存 UI 要素との非干渉**: Phase 6 のデモボタンは index.html の母音プリセットボタン群の隣に追加する。Phase 9 で UI レイアウトを再構成する際の影響範囲を最小化するため、CSS クラス名を `.consonant-demo-*` で接頭辞統一すること。

---

## 9. 参考リンク

- [docs/REQUIREMENTS_CONSONANT_TTS.md](../REQUIREMENTS_CONSONANT_TTS.md) — 子音対応・テキスト読み上げ要件定義
- [docs/CONSONANT_RESEARCH.md](../CONSONANT_RESEARCH.md) — 10エージェントによる技術調査統合結果
- [docs/MILESTONES.md](../MILESTONES.md) — Phase 6 セクション
- [CLAUDE.md](../../CLAUDE.md) — 既存アーキテクチャと設計判断
- Sinder, D.J. (1999). "Speech Synthesis Using an Aeroacoustic Friction Model." PhD Thesis, Rutgers.
- Cho, T. & Ladefoged, P. (1999). "Variation and universals in VOT." J. Phonetics.
- Stevens, K.N. (1998). *Acoustic Phonetics*. MIT Press. — 摩擦音・破裂音の音響特性
- RBJ Audio EQ Cookbook — Biquad BPF (constant 0 dB peak gain) 公式
