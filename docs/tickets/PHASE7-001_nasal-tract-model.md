# PHASE7-001 鼻腔管モデル・鼻音（/m/, /n/, /ɲ/）

## 1. 概要

| 項目 | 内容 |
|------|------|
| チケットID | PHASE7-001 |
| フェーズ名 | Phase 7 — 鼻腔管モデル・鼻音 |
| マイルストーン | [docs/MILESTONES.md `Phase 7` セクション](../MILESTONES.md) |
| 要件定義 | [docs/REQUIREMENTS_CONSONANT_TTS.md 2.3 / 2.5](../REQUIREMENTS_CONSONANT_TTS.md) |
| 技術調査 | [docs/CONSONANT_RESEARCH.md 1.4 / 2.3](../CONSONANT_RESEARCH.md) |
| 状態 | 計画中（未着手） |
| 前提条件 | Phase 6 完了（[PHASE6-001](./PHASE6-001_consonant-foundation.md)）。MIN_AREA 二段化、`setConstrictionNoise`、`scheduleTransition`、`consonant-presets.ts` の19音素プリセットが動作中。 |
| 推定工数 | 3 名構成 × 約 5 営業日 |
| 優先度 | 高（鼻音なしでは「ま行」「な行」「ん」が表現不可。Phase 8 以降のテキスト読み上げの土台） |
| 成果物（新規） | `src/models/nasal-tract.ts`, `src/models/nasal-tract.test.ts` |
| 成果物（変更） | `src/models/vocal-tract.ts`, `src/audio/worklet-processor.ts`, `src/audio/consonant-presets.ts`, `src/types/index.ts`, `src/main.ts` または `src/ui/controls.ts` |

---

## 2. タスク目的とゴール

### 2.1 目的

Phase 6 で確立した子音発声基盤（狭窄ノイズ注入・MIN_AREA 二段化・サンプル精度補間）に、口腔とは独立した **鼻腔分岐管** を追加する。Phase 6 単体では摩擦音と破裂音までしか発声できず、日本語五十音のうち「ま行・な行・に・撥音ん」は物理的に表現する手段がない。これらは口腔のみの単管モデルでは原理的に再現不可能で、軟口蓋（velum）の開放によって声門気流が口腔と鼻腔の両方に分岐するという二本管構造が必要になる。

鼻音の音響特性は単に「鼻からも音が出る」ことだけではない。鼻腔管が口腔管の側枝となることで、**反共鳴（anti-formant）** が生成される。これは口腔側の閉鎖端付近に滞留する波エネルギーが特定周波数で位相反転して打ち消し合うことに起因する物理現象で、500-2500 Hz 帯にスペクトルディップ（谷）として現れる。鼻腔ホルマント (~250 Hz の低域共振) と組み合わさることで、人間の聴覚は /b/ と /m/、/d/ と /n/ を明確に区別できる。Phase 7 ではこの反共鳴を物理シミュレーションで再現することが本質的なゴールとなる。

実装手段としては、(a) 30 区間固定断面積の鼻腔管 `NasalTract` クラスを新規作成 (b) 口腔管の特定区間（軟口蓋に相当する位置）に 3 ポート散乱接合を導入し、口腔・鼻腔・咽頭の 3 経路に波エネルギーを分配 (c) 鼻孔端からの放射出力を口腔放射出力と加算してミックス、という 3 層構造で物理層を拡張する。Phase 6 の `consonant-presets.ts` には鼻音 /m/, /n/, /ɲ/ プリセットを追加する。

### 2.2 達成基準

- 鼻腔管（30 区間、長さ約 12 cm、固定断面積）が独立した波動方程式として動作する
- 口腔管の特定区間に 3 ポート Smith 接合が組み込まれ、エネルギー保存を満たす
- velum 全開時（`velopharyngealArea` ≥ 1.5 cm²）に鼻音 /m/, /n/, /ɲ/ がスペクトル上で識別可能に発声できる
- 鼻音発声時のスペクトルに、500-2500 Hz 帯の反共鳴（ディップ）が視認できる
- 母音発声時（`velopharyngealArea = 0`）に鼻腔管計算が完全にスキップされ、process() コストが Phase 6 と完全に同等
- velum 全開時の追加コストが要件 2.5 の上限内（鼻腔管 +87 ops + 3 ポート接合 +6 ops = +93 ops/sample）
- 母音→鼻音→母音の遷移がクリックノイズなく繋がる（Phase 6 の `scheduleTransition` を `velopharyngealArea` 補間にも拡張）
- process() 内のメモリアロケーションがゼロ（GC 安全）
- 既存の Phase 1-6 機能（母音プリセット、Auto Sing、子音発声、スペクトル表示、フォルマント計算）が退行なく動作する

### 2.3 完了条件

1. `NasalTract` クラスが 30 区間の散乱伝搬を Smith 1 乗算接合で実装している
2. 鼻腔管の典型的断面積プロファイル（鼻咽腔～鼻孔の解剖学的データ）がハードコードされている
3. 鼻孔端の放射フィルタ（口腔放射と同等の 1 次差分 HPF）が動作している
4. `VocalTract` の散乱ループに 3 ポート接合が組み込まれ、`velopharyngealArea > 0` のときのみ鼻腔管側に波が分岐する
5. `velopharyngealArea === 0` のとき、鼻腔管の `processSample` が呼ばれず（早期 return）、3 ポート接合も skip されて従来の 2 ポート Smith 接合と数値的に同一になる
6. `setNasalCoupling` メッセージで `velopharyngealArea` を 0.0〜2.0 cm² の範囲で動的に変更できる
7. `consonant-presets.ts` に /m/, /n/, /ɲ/ の 3 鼻音プリセットが追加されている
8. デモ UI に /m/, /n/, /ɲ/ の 3 ボタンが追加され、押下で発声できる
9. `nasal-tract.test.ts` の単体テストが全件通過する
10. `vocal-tract.test.ts` の既存テストが退行なく通過する
11. Chrome / Firefox / Edge の最新版で動作確認済み
12. ベンチマーク: velum 閉鎖時の process() コストが Phase 6 と ±2% 以内、velum 全開時の追加コストが +25% 以内

---

## 3. 実装する内容の詳細

### 3.1 NasalTract クラス（新規 src/models/nasal-tract.ts）

Phase 6 までの `VocalTract` クラスと同じ設計思想（GC-free、Float64Array バッファ事前確保、Smith 1 乗算散乱）に従い、独立した 30 区間の鼻腔管を実装する。

#### 3.1.1 区間数と物理パラメータ

```typescript
// src/types/index.ts に追加
export const NASAL_NUM_SECTIONS = 30;            // 鼻腔管区間数
export const NASAL_LENGTH = 11.4;                 // cm（鼻咽腔～鼻孔、成人男性平均）
export const NASAL_SECTION_LENGTH =
  NASAL_LENGTH / NASAL_NUM_SECTIONS;              // ≈ 0.38 cm/区間
```

区間数 30 の選択根拠: c/(2·fs) ≈ 0.397 cm/区間 という Kelly-Lochbaum の物理離散化条件を満たすには、鼻腔長 11.4 cm に対して区間数 30 がほぼピッタリの値となる（11.4 / 30 = 0.38 cm）。これは口腔管の 0.397 cm/区間と整合し、両者の波動伝搬速度を共通の `c = 35000 cm/s` で扱える。区間数を 44 と揃えても良いが、鼻腔は口腔より物理的に短いため、解剖学的長さに合わせて区間数を 30 に独立設定する方が無駄な計算を避けられる（追加 ops/sample が約 30%削減）。

#### 3.1.2 鼻腔管の典型的断面積プロファイル

鼻腔管は口腔管と異なり時間変化しない固定断面積として扱う（人間の鼻腔の形状は発声中はほぼ不変）。解剖学的データから、鼻咽腔（pharyngeal end, 口腔接合側）から鼻孔（nostril, 唇側に相当する出力端）に向かって以下のプロファイルを採用する。

```typescript
// src/models/nasal-tract.ts
// index 0 = 鼻孔端（出力側）, index N-1 = 鼻咽腔端（口腔との接合側）
const NASAL_AREA_PROFILE: readonly number[] = [
  // 鼻孔（前方、出力端）: 狭く始まる
  0.5, 0.7, 1.0, 1.4, 1.8, 2.2,
  // 中央部（広い）
  2.5, 2.8, 3.0, 3.0, 2.9, 2.7, 2.5, 2.4, 2.3,
  // 後方部（一旦狭まる）
  2.1, 1.9, 1.7, 1.5, 1.4, 1.3, 1.3, 1.4, 1.5,
  // 鼻咽腔接合部（広めに開く）
  1.8, 2.2, 2.5, 2.8, 3.0, 3.2,
];
```

このプロファイルは Dang & Honda (1994) の MRI ベースの鼻腔形状計測値を簡略化したもの。長さ 11.4 cm に対して 30 点で離散化している。鼻孔出口の狭さ（0.5 cm²）と中央部の広さ（3.0 cm²）が反共鳴の周波数を決定する最大要因で、この値を変えると鼻音らしさが失われるため、Phase 7 段階ではハードコードのまま動的変更を不可とする。Phase 9 以降で UI からの調整余地を残す場合は、`NASAL_AREA_PROFILE` の倍率係数 1 つ（`nasalScaleFactor`）を導入する設計余地がある。

#### 3.1.3 NasalTract クラスのインターフェース

```typescript
// src/models/nasal-tract.ts
export class NasalTract {
  private readonly n: number = NASAL_NUM_SECTIONS;
  private readonly forwardWave: Float64Array;       // 鼻咽腔 N-1 → 鼻孔 0 方向
  private readonly backwardWave: Float64Array;      // 鼻孔 0 → 鼻咽腔 N-1 方向
  private readonly scratchForward: Float64Array;
  private readonly scratchBackward: Float64Array;
  private readonly reflectionCoefficients: Float64Array; // 固定（断面積不変）
  private readonly areas: Float64Array;
  private prevNostrilInput: number = 0;

  constructor() {
    // 全 Float64Array を事前確保（GC-free）
    // areas に NASAL_AREA_PROFILE をコピー
    // computeReflectionCoefficients() で固定反射係数を計算（コンストラクタで 1 回のみ）
  }

  /**
   * 1 サンプル分の鼻腔管波動伝搬を計算し、鼻孔からの放射音圧を返す。
   * VocalTract と対称形で実装: 2 半ステップ × (旧値スクラッチ複製 → 散乱ループ
   * → 鼻咽腔端入力 (= pharyngealInput) → 鼻孔端反射) → 壁面損失 → ソフトクリップ → 放射 HPF。
   * @param pharyngealInput 3 ポート接合からの入射波（鼻咽腔端 N-1 への入力）
   */
  processSample(pharyngealInput: number): number { /* ... */ }

  /** 3 ポート接合の b_n に対応: 鼻咽腔端の現在の後退波 */
  getPharyngealBackwardWave(): number { return this.backwardWave[this.n - 1]!; }

  /** 3 ポート接合の A_n に対応: 鼻咽腔端の断面積 */
  getPharyngealArea(): number { return this.areas[this.n - 1]!; }

  reset(): void { /* バッファ全クリア */ }
}
```

#### 3.1.4 鼻孔端の放射フィルタ

口腔の唇放射と同じ 1 次差分 HPF (`output = f[0] - RADIATION_ALPHA * prev_f0`) を採用し、`RADIATION_ALPHA = 0.97` を流用する。鼻孔端反射係数も口腔の `LIP_REFLECTION = -0.85` を流用。実際には鼻孔の 2 つの小開口は口腔開口とは異なる放射インピーダンスを持つが、Phase 7 では簡略化を優先し、鼻音の「こもった」音色再現を目視・聴感テスト（6.2）で許容範囲か確認する。

### 3.2 VocalTract の 3 ポート接合実装

#### 3.2.1 接合点インデックスの選択

軟口蓋（velum）は人体解剖学的に口腔の咽頭側から見て約 9-10 cm の位置にある。44 区間モデルでは唇側 index 0 から 17.5 cm 離れた声門側 index 43 までが管全長で、軟口蓋位置 9.5 cm は声門側から逆算して `floor((17.5 - 9.5) / 0.397) ≈ 20` 番目の区間に相当する。すなわち `NASAL_JUNCTION_INDEX = 20` が口腔側の鼻腔接合点となる。

```typescript
// src/types/index.ts に追加
export const NASAL_JUNCTION_INDEX = 20; // 口腔 44 区間における鼻腔接合点（軟口蓋位置）
```

選択の根拠: (a) この位置で接合すると、唇側 0-19 区間（約 7.94 cm）が口腔前方、声門側 21-43 区間（約 9.13 cm）が口腔後方＋咽頭となり、解剖学的にバランスが取れる (b) /m/ の閉鎖位置（idx 0-1）、/n/（idx 6-9）、/ɲ/（idx 8-11）はすべて接合点 20 より唇側にあるため、3 ポート接合と独立に閉鎖が機能する (c) 整数値で固定することで分岐なしの定数最適化が可能。

ただし「軟口蓋の正確な位置は個人差が大きく、固定値 20 は近似に過ぎない」点は 6.3 で扱うレビュー項目とする。

#### 3.2.2 3 ポート Smith 散乱公式

通常の 2 ポート Smith 接合では、境界 k で 2 つの管（区間 k と区間 k+1）の前進波・後退波を散乱させる。3 ポート接合では、口腔前方ポート（pharyngeal 側、p）・口腔後方ポート（oral 側、o）・鼻腔ポート（nasal 側、n）の 3 つに分岐させる。

定常状態圧力一致条件と質量保存則から、3 ポート接合点の共通圧力 `k` は以下の重み付き平均で与えられる:

```
k = (A_p * f_p + A_o * b_o + A_n * b_n) / (A_p + A_o + A_n)
```

ここで:
- `f_p`: 口腔前方（声門側 21）から接合点に向かう前進波 ≈ `scratchForward[NASAL_JUNCTION_INDEX + 1]`
- `b_o`: 口腔後方（唇側 19）から接合点に向かう後退波 ≈ `scratchBackward[NASAL_JUNCTION_INDEX - 1]`（ただし符号と index の取り扱いは下記注釈参照）
- `b_n`: 鼻腔から接合点に向かう後退波 ≈ `nasalTract.getPharyngealBackwardWave()`
- `A_p, A_o, A_n`: 各ポートの断面積

接合点を通過した後の各ポートの新しい波は:

```
f[NASAL_JUNCTION_INDEX]   = 2k - sf[NASAL_JUNCTION_INDEX + 1]    // 口腔後方→前方の前進波
b[NASAL_JUNCTION_INDEX + 1] = 2k - sb[NASAL_JUNCTION_INDEX - 1]  // 口腔前方→後方の後退波（注: index 関係は下記）
nasal_pharyngeal_input   = 2k - nasal_b_pharyngeal              // 鼻腔への入射波
```

注意点: `vocal-tract.ts` の現行コードの規約は「index 0 = 唇側、N-1 = 声門側、前進波 = 声門→唇方向、後退波 = 唇→声門方向」。接合点 J = NASAL_JUNCTION_INDEX における 3 ポート接合は、通常の散乱ループの境界 `k = J - 1`（区間 J-1 と J の境界）の散乱を 3 ポート公式に置き換える形で実装する。

```typescript
// vocal-tract.ts processSample 内、散乱ループの中で分岐
const J = NASAL_JUNCTION_INDEX;
for (let k = 0; k < N - 1; k++) {
  if (k === J - 1 && this.velopharyngealArea > 0) {
    // 3 ポート Smith 接合
    const w_p = sf[k + 1]!;                       // 区間 J（咽頭側）→境界 の前進波
    const w_o = sb[k]!;                           // 区間 J-1（唇側）→境界 の後退波
    const w_n = this.nasalTract.getPharyngealBackwardWave();
    const A_p = this.areas[k + 1]!;
    const A_o = this.areas[k]!;
    const A_n = this.nasalTract.getPharyngealArea();
    const A_sum_inv = this.cachedNasalASumInv;    // 1/(A_p+A_o+A_n)、setNasalCoupling 時に事前計算
    const k_pressure = (A_p * w_p + A_o * w_o + A_n * w_n) * A_sum_inv;
    const two_k = 2 * k_pressure;
    f[k] = two_k - w_p;                            // 区間 J-1 の前進波（唇側へ）
    b[k + 1] = two_k - w_o;                        // 区間 J の後退波（声門側へ）
    this.nasalPharyngealInput = two_k - w_n;       // 鼻腔への入射波
  } else {
    // 通常の 2 ポート Smith 1 乗算接合（既存コード）
    const delta = r[k]! * (sf[k + 1]! - sb[k]!);
    f[k] = sf[k + 1]! + delta;
    b[k + 1] = sb[k]! + delta;
  }
}
```

A_n = 0 のとき `k = (A_p*w_p + A_o*w_o) / (A_p + A_o)` となり、2 ポート Smith 接合の `delta = r * (sf - sb)` 形式と数学的に等価。すなわち velum 閉鎖時に既存動作と完全一致することが式の上で保証される。

演算量: 3 乗算 + 2 加算 + 3 減算 + 1 乗算 (two_k) + 1 乗算 (k_pressure×A_sum_inv) ≈ 8 ops（A_sum_inv の事前キャッシュにより 1 除算を回避）。要件 2.5 の +6 ops/sample よりやや多いが、velum 開放時のみ動作する分岐のため許容範囲内とする。

#### 3.2.3 velum 閉鎖時の早期 return 最適化

`velopharyngealArea === 0` のとき、3 ポート接合の分岐に入らず、鼻腔管の `processSample` も呼ばない。これにより母音発声時のオーバーヘッドを完全にゼロにする。

```typescript
// vocal-tract.ts processSample の冒頭
if (this.velopharyngealArea === 0) {
  // Phase 6 完全互換のパスへ（鼻腔関連を一切実行しない）
  return this.processSampleOralOnly(glottalSample);
}
// 以下、3 ポート接合と nasalTract.processSample を含むパス
```

または、散乱ループ内の `if (k === J - 1 && this.velopharyngealArea > 0)` 分岐により毎サンプル判定する設計でも良い。前者（メソッド分割）は分岐予測ミスが少なく高速だが、コード重複が発生する。後者（ループ内分岐）はコード重複ゼロだが、44 区間のうち 1 区間で分岐が走る。Phase 7 では実装の見通しを優先して **後者（ループ内分岐）** を採用し、Phase 8 でベンチマーク後に必要なら前者へ切り替える。

ただし鼻腔管自体の `nasalTract.processSample(this.nasalPharyngealInput)` の呼び出しは必ずスキップする必要がある（鼻腔管の状態を動かさない）。これは `if (this.velopharyngealArea > 0)` 分岐 1 個でガードする。

```typescript
// vocal-tract.ts processSample 末尾、口腔散乱完了後
if (this.velopharyngealArea > 0) {
  this.nasalTract.processSample(this.nasalPharyngealInput);
}
```

### 3.3 Worklet 拡張（setNasalCoupling メッセージ）

#### 3.3.1 メッセージ型の追加

```typescript
// src/types/index.ts WorkletMessage に追加
| { type: 'setNasalCoupling'; velopharyngealArea: number }  // 0.0〜2.0 cm²
```

#### 3.3.2 Worklet 側ハンドラ

```typescript
// worklet-processor.ts onmessage 内
} else if (msg.type === 'setNasalCoupling') {
  if (Number.isFinite(msg.velopharyngealArea) && msg.velopharyngealArea >= 0) {
    this.vocalTract.setNasalCoupling(msg.velopharyngealArea);
  }
}
```

```typescript
// vocal-tract.ts に追加
setNasalCoupling(area: number): void {
  this.velopharyngealArea = area;
  if (area > 0) {
    // 鼻腔管の鼻咽腔端の有効断面積を口腔接合点に投影
    // （実装上は NasalTract 側の areas[N-1] を更新する形でも良いが、
    //  Phase 7 では velopharyngealArea を 3 ポート接合の A_n として直接使用する）
    this.cachedNasalASumInv = 1.0 /
      (this.areas[NASAL_JUNCTION_INDEX]! +
       this.areas[NASAL_JUNCTION_INDEX - 1]! +
       area);
  }
}
```

#### 3.3.3 Phase 6 の scheduleTransition との統合

Phase 6 で導入された `scheduleTransition` は口腔断面積（44 区間 Float64Array）の補間のみを扱っていた。Phase 7 では `velopharyngealArea` の補間も必要になる（鼻音の遷移時に velum を瞬間切替するとクリックノイズが発生するため）。

Phase 6 申し送り 8.1 の指示に従い、`scheduleTransition` メッセージ型を以下に拡張する:

```typescript
// 拡張前 (Phase 6)
| { type: 'scheduleTransition'; targetAreas: Float64Array; durationSamples: number }

// 拡張後 (Phase 7)
| { type: 'scheduleTransition';
    targetAreas: Float64Array;
    targetVelumArea?: number;          // optional, 未指定なら現在値を維持
    durationSamples: number }
```

`targetVelumArea` が指定された場合、`worklet-processor.ts` は補間状態に `transitionStartVelumArea` / `transitionTargetVelumArea` を追加して、44 区間断面積と同じ補間カーブで線形補間する。

### 3.4 鼻音プリセット（consonant-presets.ts 拡張）

Phase 6 の `consonant-presets.ts` には鼻音が含まれていない（Phase 6 スコープ外）。Phase 7 で以下 3 鼻音を追加する。

```typescript
// src/types/index.ts ConsonantId に追加
export type ConsonantId =
  | 's' | 'sh' | 'h' | 'hi' | 'fu' | 'z'
  | 'k' | 't' | 'p' | 'g' | 'd' | 'b'
  | 'ts' | 'tsh' | 'dz' | 'dzh'
  | 'r' | 'j' | 'w'
  | 'm' | 'n' | 'ny';                  // 追加: 鼻音 3 種

// ConsonantCategory に追加
export type ConsonantCategory =
  | 'plosive' | 'fricative' | 'affricate' | 'flap' | 'approximant'
  | 'nasal';                            // 追加

// ConsonantPreset に追加
export interface ConsonantPreset {
  // ... 既存フィールド
  velopharyngealArea?: number;          // 追加: 鼻音時の velum 開放面積 (cm²)
}
```

```typescript
// src/audio/consonant-presets.ts に追加
export const CONSONANT_PRESETS: Record<ConsonantId, ConsonantPreset> = {
  // ... 既存 19 音素

  m: {
    id: 'm', ipa: 'm', category: 'nasal', voiced: true,
    constrictionRange: { start: 0, end: 3 },     // 16点 idx 0-1 ≒ 44区間 idx 0-3 (両唇閉鎖)
    constrictionArea: 0.01,                       // MIN_AREA_PROGRAM (完全閉鎖)
    velopharyngealArea: 1.8,                     // velum 全開
    // 鼻音はノイズ不要（声門音源のみ）
  },

  n: {
    id: 'n', ipa: 'n', category: 'nasal', voiced: true,
    constrictionRange: { start: 6, end: 9 },     // 16点 idx 2-3 ≒ 44区間 idx 6-9 (歯茎閉鎖)
    constrictionArea: 0.01,
    velopharyngealArea: 1.8,
  },

  ny: {
    id: 'ny', ipa: 'ɲ', category: 'nasal', voiced: true,
    constrictionRange: { start: 8, end: 11 },    // 16点 idx 3-4 ≒ 44区間 idx 8-11 (硬口蓋閉鎖)
    constrictionArea: 0.01,
    velopharyngealArea: 1.8,
  },
};
```

velopharyngealArea = 1.8 の選択根拠: 要件定義 2.3 で「全開時 1.5-2.0 cm²」と指定されており、典型的な鼻音発声時の解剖学的計測値の中央値。この値で口腔閉鎖が起きた状態で声門音源が鼻腔側に十分流れ、反共鳴がスペクトル上で明瞭に確認できる。

### 3.5 出力ミキシング（口腔放射 + 鼻孔放射）

`VocalTract.processSample` の戻り値は従来「口腔放射のみ」だったが、Phase 7 では **口腔放射 + 鼻孔放射の合計** を返すように変更する。

```typescript
// vocal-tract.ts processSample 末尾
const oralOutput = currentLipInput - RADIATION_ALPHA * this.prevLipInput;
this.prevLipInput = currentLipInput;

// 鼻腔出力（velum 閉鎖時は 0）
let nasalOutput = 0;
if (this.velopharyngealArea > 0) {
  nasalOutput = this.nasalTract.processSample(this.nasalPharyngealInput);
}

return oralOutput + nasalOutput;
```

ミキシング比率は 1:1 とし、鼻音時は口腔閉鎖（constrictionArea = 0.01）により口腔出力がほぼゼロになるため、自然と鼻孔出力が支配的になる。/m/ で唇閉鎖がきちんと数値モデル化されていれば、口腔側からの音は壁面損失と狭窄区間の反射でほとんど外に出ない。

将来的に鼻音の音量バランスを調整したくなった場合は、`nasalGain` パラメータを追加できる設計余地を残す（Phase 7 ではハードコード 1.0 とする）。

---

## 4. 実装に必要なエージェントチーム

3 名構成。Phase 6 の audio-dsp / consonant-data / integration-test と並行的な責務分割で、Phase 6 の経験を活かせる構成にする。

### 4.1 nasal-model エージェント

| 項目 | 内容 |
|------|------|
| 担当ファイル | `src/models/nasal-tract.ts` (新規), `src/models/nasal-tract.test.ts` (新規), `src/types/index.ts` (定数追加) |
| 入力 | Phase 6 完成版の vocal-tract.ts、CONSONANT_RESEARCH.md 1.4、要件定義 2.3、Dang & Honda (1994) の鼻腔形状計測値 |
| 出力 | 30 区間鼻腔管 NasalTract クラス、鼻腔断面積プロファイル定数、鼻孔放射フィルタ、ユニットテスト |
| 完了条件 | NasalTract 単体テスト全件通過 + 自由振動シミュレーションで鼻腔形状の固有共振周波数 (~250 Hz nasal formant) が確認できる + GC-free |

具体的タスク:
- NasalTract クラスの実装（VocalTract の対称形、29 反射係数の事前計算）
- NASAL_AREA_PROFILE 定数の Dang & Honda 計測値からの抽出
- nasal-tract.test.ts でのユニットテスト作成（自由振動 + 反射係数値域 + 数値発散検証）
- 鼻孔放射フィルタの実装（口腔と同じ係数を流用）
- VocalTract から呼ばれるための `getPharyngealBackwardWave()` / `getPharyngealArea()` API 実装

### 4.2 audio-integration エージェント

| 項目 | 内容 |
|------|------|
| 担当ファイル | `src/models/vocal-tract.ts`, `src/audio/worklet-processor.ts`, `src/types/index.ts` (型・定数追加), `src/audio/engine.ts` |
| 入力 | nasal-model の NasalTract、Phase 6 の vocal-tract.ts と worklet-processor.ts、要件定義 2.3 / 2.5 |
| 出力 | 3 ポート Smith 接合実装、velum 制御、Worklet メッセージ拡張 (`setNasalCoupling`、`scheduleTransition` 拡張)、engine.ts 経由の API |
| 完了条件 | velum 閉鎖時に従来動作と完全一致 + velum 全開時に 3 ポート接合のエネルギー保存検証 + 既存 vocal-tract.test.ts 全件通過 |

具体的タスク:
- VocalTract に `nasalTract: NasalTract` メンバを追加（コンストラクタで `new`）
- VocalTract に `velopharyngealArea` / `nasalPharyngealInput` / `cachedNasalASumInv` などの状態を追加
- processSample の散乱ループに 3 ポート接合分岐を追加（NASAL_JUNCTION_INDEX = 20）
- velum 閉鎖時の早期 return / 早期 skip 実装
- setNasalCoupling メソッドの追加
- 出力ミキシング（口腔 + 鼻孔）
- worklet-processor.ts に `setNasalCoupling` メッセージハンドラ追加
- `scheduleTransition` の `targetVelumArea` 拡張対応
- engine.ts に `setNasalCoupling(area: number)` API 追加（main.ts から呼び出し可能に）

### 4.3 test エージェント

| 項目 | 内容 |
|------|------|
| 担当ファイル | `src/audio/consonant-presets.ts`, `src/main.ts` または `src/ui/controls.ts`, `index.html`, `src/models/vocal-tract.test.ts` (拡張) |
| 入力 | audio-integration の vocal-tract.ts と worklet-processor.ts、nasal-model の NasalTract |
| 出力 | 鼻音プリセット /m/, /n/, /ɲ/、デモ UI 3 ボタン、3 ポート接合の対称性検証テスト、反共鳴スペクトル検証 |
| 完了条件 | /m/, /n/, /ɲ/ がブラウザでクリック発声可能 + スペクトルで反共鳴が視認 + 既存テスト全件通過 + パフォーマンス計測 |

具体的タスク:
- consonant-presets.ts に /m/, /n/, /ɲ/ プリセット追加
- index.html に /m/, /n/, /ɲ/ 用デモボタン追加（Phase 6 の `.consonant-demo-buttons` 内）
- main.ts または controls.ts に鼻音発声ロジック（playConsonant の鼻音対応 + setNasalCoupling 呼び出し）
- vocal-tract.test.ts に 3 ポート接合テスト追加（A_n=0 で 2 ポートと一致、エネルギー保存）
- 反共鳴スペクトル E2E 検証（FFT 結果に 500-2500 Hz 帯のディップ確認）
- velum 閉鎖時のパフォーマンス計測（Chrome DevTools Performance）
- Firefox / Edge のクロスブラウザ確認

### 4.4 依存関係

```
       nasal-model ──────┐
                         │
                         ├──→ audio-integration ──→ test ──→ E2E検証
                         │
       (Phase 6 完成版) ─┘
```

nasal-model は単独で着手可能（VocalTract に依存しない独立クラス）。audio-integration は nasal-model の `NasalTract` 型と `getPharyngealBackwardWave` API が定まり次第着手する（インターフェース凍結後の並行化が可能）。test は両方の完了を待つ。

---

## 5. 提供範囲とテスト項目

### 5.1 スコープ内

- 30 区間固定断面積の鼻腔管 NasalTract クラス
- 鼻孔端の放射フィルタ（口腔と同等の 1 次差分 HPF）
- 口腔・鼻腔・咽頭の 3 ポート Smith 接合（NASAL_JUNCTION_INDEX = 20）
- velum 開閉制御（`setNasalCoupling(area)`、0.0〜2.0 cm²）
- velum 閉鎖時の鼻腔管計算スキップ最適化
- 鼻音プリセット /m/, /n/, /ɲ/
- `setNasalCoupling` Worklet メッセージ
- `scheduleTransition` の `targetVelumArea` 拡張
- デモ用 3 音素ボタン UI
- 鼻孔放射 + 口腔放射の出力ミキシング

### 5.2 スコープ外

- 撥音「ん」の異音切替（後続音素に応じた口腔閉鎖位置切替: [m]/[n]/[ŋ]/[ɴ]）→ Phase 8 の text-parser 側で実装
- 鼻腔副洞（paranasal sinus、上顎洞・前頭洞など）のモデル化 → 物理的精度向上の副次目標として除外
- 鼻腔断面積の動的変化（鼻づまりや鼻汁の影響など）→ 解剖学的に発声中はほぼ不変なので除外
- /ŋ/（軟口蓋鼻音）の独立プリセット → Phase 8 で撥音「ん」異音として実装
- 鼻腔内摩擦音（鼻からのフリクション）→ 日本語には存在しないため除外
- 鼻音時の声門音源パラメータ調整（鼻音は通常 OQ をやや小さくする）→ Phase 8 で強度テーブルと一緒に
- フルテキスト入力 UI（Phase 9）

### 5.3 ユニットテスト項目

`src/models/nasal-tract.test.ts` と `src/models/vocal-tract.test.ts` (拡張) に以下を追加する。

| テストID | 内容 | 期待動作 |
|---------|------|---------|
| UT-N01 | NasalTract 初期化 | コンストラクタで NASAL_NUM_SECTIONS 個の Float64Array が確保される、areas が NASAL_AREA_PROFILE と一致 |
| UT-N02 | NasalTract 反射係数の値域 | 全境界の反射係数の絶対値が 1.0 未満 |
| UT-N03 | NasalTract 自由振動 | 鼻咽腔端にインパルスを 1 サンプルだけ入力 → 鼻孔から減衰応答が出る、応答の自己相関ピークから固有共振周波数 ~250 Hz (nasal formant) が抽出できる ±50 Hz |
| UT-N04 | NasalTract GC 安全性 | processSample を 100 万回呼んで Heap allocation 増加なし |
| UT-N05 | NasalTract 数値発散 | 鼻咽腔端に 10 秒間ホワイトノイズを入力しても NaN/Inf が出ない、ピーク振幅 < 100 |
| UT-N06 | 3 ポート接合 A_n=0 で 2 ポートと一致 | velopharyngealArea = 0 で VocalTract.processSample の出力が Phase 6 の出力と完全一致（差分が浮動小数誤差以内） |
| UT-N07 | 3 ポート接合のエネルギー保存 | 3 ポート接合点で `A_p*(f_p²-f_p_out²) + A_o*(b_o²-b_o_out²) + A_n*(b_n²-b_n_out²) ≈ 0` （誤差 < 1e-10） |
| UT-N08 | 3 ポート接合の対称性 | A_p = A_o = A_n の特殊ケースで、3 ポートに均等に分配される (k = (w_p + w_o + w_n) / 3) |
| UT-N09 | velum 閉鎖時のスキップ動作 | velopharyngealArea = 0 のときに nasalTract.processSample が呼ばれない（モック注入で確認） |
| UT-N10 | velum 連続切替 | 0 → 1.8 → 0 → 1.8 を毎サンプル切り替えても発散しない（極端なテスト） |
| UT-N11 | scheduleTransition velum 補間 | targetVelumArea = 1.8、duration = 4410 サンプル(100ms) で線形補間が動作、t=0.5 時に 0.9 |
| UT-N12 | NasalTract reset | reset() 後に forwardWave / backwardWave / scratch / prevNostrilInput が全てゼロ |
| UT-N13 | 鼻音プリセット妥当性 | /m/, /n/, /ɲ/ の constrictionArea = 0.01、velopharyngealArea ≥ 1.5、constrictionRange in [0,43]、voiced = true、category = 'nasal' |
| UT-N14 | 反共鳴の理論値検証 | NasalTract に均一な定常入力を流した状態の口腔系全体の周波数応答 (FFT) で、500-2500 Hz 帯にディップ (谷、-10 dB 以上の落ち込み) が出現する |

### 5.4 E2E テスト項目

| テストID | 内容 | 期待動作 |
|---------|------|---------|
| E2E-N01 | /m/ 単独発声 | デモボタン押下 → 約 50 ms の鼻音、スペクトルに 250 Hz 付近の鼻音ホルマント + 500-1500 Hz 帯のディップ |
| E2E-N02 | /n/ 単独発声 | デモボタン押下 → 約 50 ms の鼻音、/m/ より高めのディップ位置（1000-2000 Hz） |
| E2E-N03 | /ɲ/ 単独発声 | デモボタン押下 → 約 50 ms の鼻音、/m/ /n/ よりさらに高めのディップ（1500-2500 Hz） |
| E2E-N04 | /b/ vs /m/ 区別 | スペクトル比較で /m/ にだけ鼻音ホルマント (~250 Hz) が現れることを目視確認 |
| E2E-N05 | 母音→鼻音→母音遷移 | /a/ → /m/ → /a/ の遷移をクリックノイズなく再生 (velum を scheduleTransition で補間) |
| E2E-N06 | 既存母音プリセット非退行 | /a/, /i/, /u/, /e/, /o/ の波形・スペクトルが Phase 6 と完全一致（velum=0 のため計算経路が同一） |
| E2E-N07 | Phase 6 子音非退行 | /s/, /k/, /t/, /p/ がデモボタンで Phase 6 と同じ波形を出力する |
| E2E-N08 | Auto Sing 非退行 | Auto Sing 起動 → 5 音素以上の母音遷移が Phase 6 と同等 |
| E2E-N09 | パフォーマンス (velum 閉鎖) | Chrome DevTools Performance で母音発声時の process() 実行時間が Phase 6 と ±2% 以内 |
| E2E-N10 | パフォーマンス (velum 全開) | 鼻音発声時の process() 実行時間が Phase 6 比 +25% 以内（要件 2.5） |
| E2E-N11 | クロスブラウザ | Firefox / Edge でも E2E-N01〜05 が同等動作 |
| E2E-N12 | 連続デモボタン押下 | /m/ → /n/ → /ɲ/ を 100 ms 間隔で押下、補間が崩れず音切れなし |

---

## 6. 実装に関する懸念事項とレビュー項目

### 6.1 3 ポート接合の数値安定性

Smith の 1 乗算接合（2 ポート版）は 30 年以上の使用実績がある安定アルゴリズムだが、3 ポート版は実装が複雑で、係数の符号や計算順序を間違えるとエネルギーが累積する発振モードに陥る。特に `A_n` が 0 から 1.8 に瞬間的に変化する場合（velum 切替時）、過渡的に大振幅のリンギングが起きやすい。

**チェック項目**
- [ ] 3 ポート接合公式 (k = (A_p*w_p + A_o*w_o + A_n*w_n) / A_sum) の導出を文献 (Maeda 1982 など) と照合し、符号規約が現行 vocal-tract.ts と整合することを確認
- [ ] エネルギー保存テスト UT-N07 を全パラメータ範囲で実施 (A_p, A_o, A_n を [0.01, 10.0] でランダム化)
- [ ] velum を 0 → 1.8 → 0 を 1 秒周期で振動させて 60 秒間連続シミュレート、波形が発散しない
- [ ] `cachedNasalASumInv` が `setNasalCoupling` 時にのみ更新され、velum が変化していないときは再計算されない（パフォーマンスと正確性の両立）
- [ ] ソフトクリッピング (SOFT_CLIP_THRESHOLD = 10.0) を 3 ポート接合経路でも適用する

### 6.2 反共鳴の可聴性（/m/ vs /b/ の区別）

物理モデルとしての鼻音は反共鳴を持つはずだが、実装が正しくても **聴感上の区別が曖昧** な場合がある。これは (a) 反共鳴の周波数が母音ホルマントとずれる (b) 反共鳴の深さ（dB ディップ量）が浅い (c) 鼻音ホルマント (~250 Hz) と母音 F1 (~700 Hz for /a/) が干渉する、などの理由による。

**チェック項目**
- [ ] /m/ 発声中の FFT スペクトログラムを画像保存し、500-1500 Hz 帯のディップが目視で確認できるか検証
- [ ] /b/（口腔のみ、velum=0）と /m/（velum=1.8）を交互に発声し、耳で聴いて区別できるか主観評価
- [ ] /m/ のディップが浅い場合、`NASAL_AREA_PROFILE` の鼻孔出口（index 0）を 0.5 → 0.3 まで狭めて反共鳴を強化する調整余地を試す
- [ ] /n/ と /d/ の区別、/ɲ/ と /j/ の区別も同様に検証
- [ ] 鼻音ホルマント (~250 Hz) が出ない場合、`NASAL_AREA_PROFILE` の中央部 (index 12-18) の断面積を増減して調整

### 6.3 鼻腔管断面積の文献値の妥当性

`NASAL_AREA_PROFILE` の 30 個の値は Dang & Honda (1994) や Maeda (1982) の MRI/X 線データを参照して決めるが、(a) 計測対象は成人男性平均で個人差を吸収していない (b) 性別・体格による補正係数が文献によって異なる (c) Phase 7 段階では NUM_CONTROL_POINTS = 16 のような UI からの調整手段を持たない、という問題がある。

**チェック項目**
- [ ] 採用した `NASAL_AREA_PROFILE` の出典を nasal-tract.ts のコメントに明記
- [ ] 区間長 0.38 cm × 30 区間 = 11.4 cm が成人男性鼻腔長の平均値と整合
- [ ] 鼻孔出口面積 0.5 cm² と中央部最大面積 3.0 cm² の比 6:1 が文献値（典型 5:1〜10:1）の範囲内
- [ ] Phase 7 では値の調整余地を残すため、`NASAL_AREA_PROFILE` を `as const readonly` にせず、`Float64Array` で初期化する（将来の動的調整を可能に）
- [ ] 鼻腔形状の個人差を扱うアプローチを Phase 9 以降の課題として明記

### 6.4 velum 切替時のスムージング

`setNasalCoupling(0)` から `setNasalCoupling(1.8)` を瞬間的に呼ぶと、3 ポート接合の係数が 1 サンプルで 0 → 0.32 ほどジャンプし、波動方程式に階段状の不連続が生じてクリックノイズになる。

**チェック項目**
- [ ] 鼻音発声開始時は `scheduleTransition` の `targetVelumArea` を使って 5-10 ms（220-440 サンプル）かけて 0 → 1.8 にランプアップする
- [ ] 鼻音終了時も同様に 5-10 ms かけて 1.8 → 0 にランプダウン
- [ ] ランプ時間が短すぎ（< 1 ms）/長すぎ（> 50 ms）の両方を試して、聴感上のクリックがない最小値を見つける
- [ ] Phase 6 の `scheduleTransition` 拡張（targetVelumArea 対応）を audio-integration エージェントが正しく実装しているか検証
- [ ] 補間中の `cachedNasalASumInv` 再計算をどの粒度で行うか (毎サンプル vs 16 サンプル毎) を実装方針として明確化

### 6.5 既存のジッター/シマーが鼻腔経路にも適用されるか

Phase 4 で導入されたジッター（F0 のランダム微変動）とシマー（振幅のランダム微変動）は声門音源側に適用される。声門音源は VocalTract の唯一の入力源なので、3 ポート接合経由で鼻腔管にも自動的に適用されるはず。

**チェック項目**
- [ ] /m/ 発声時にジッター/シマーをスライダーで上げ下げし、変調が鼻腔出力にも反映されるか
- [ ] 鼻音発声時に Auto Sing を起動して、鼻音→母音→鼻音の遷移にもジッターが乗るか
- [ ] 鼻音発声時のジッター量は母音時と同等で良いか、それとも調整が必要か（生理学的には鼻音は声帯振動が母音と同質なため同等で良いはず）
- [ ] worklet-processor.ts のジッター/シマー処理が 3 ポート接合の追加によって意図せず変わらないこと

### 6.6 NASAL_JUNCTION_INDEX = 20 の妥当性とテスト独立性（補足）

接合点を 20 に固定したが、解剖学的に軟口蓋位置は個人差が大きい（成人男性で 8.5-11 cm、44 区間で index 17-22）。Phase 7 では固定値で進め、Phase 9 以降で UI 調整可能化を検討する。あわせて NasalTract のテストは VocalTract 非依存で独立に検証できることを確認する。

**チェック項目**
- [ ] /m/ 発声で NASAL_JUNCTION_INDEX = 18, 20, 22 を試し、聴感とスペクトルで主観評価
- [ ] 接合点が定数 `NASAL_JUNCTION_INDEX` 経由で参照され、`if (k === J - 1)` のような分岐に裸の数値リテラルを書かない（マジックナンバー禁止）
- [ ] NasalTract が VocalTract を import せず、依存方向を VocalTract → NasalTract の片方向に保つ
- [ ] nasal-tract.test.ts は NasalTract への直接インパルス入力と鼻孔出力読み取りのみで完結
- [ ] 3 ポート接合のテストは VocalTract 側 (vocal-tract.test.ts) に置き、NasalTract のテストには持ち込まない

---

## 7. 一から作り直すとしたらどうするか

Phase 1 で「将来的に鼻腔管を含めた 2 本管モデル + 3 ポート接合まで考慮した設計」を据えていた場合、Phase 7 で必要となる改修コストの大半は不要だった。以下、再設計案を 7 つの観点から具体化する。

**1. AcousticTube 基底クラスの抽出**: 現行は `VocalTract` が具象クラス 1 個だけで、Phase 7 で `NasalTract` を新設すると Float64Array バッファ管理・反射係数計算・Smith 散乱ループ・壁面損失・ソフトクリッピング・放射フィルタの共通ロジックが両クラスにほぼコピーされる。再設計版なら Phase 1 から `AcousticTube` 抽象基底クラスに `forwardWave / backwardWave / scratch / areas / reflectionCoefficients` フィールドと `scatter() / applyWallLoss() / applySoftClip()` の共通実装を集約し、`processSample` だけを派生クラスで境界条件として実装する。`VocalTract extends AcousticTube` (唇端＋声門端) と `NasalTract extends AcousticTube` (鼻孔端＋鼻咽腔端) で同等のコードを共有でき、Phase 7 のコード量がほぼ半分に減る。テストも `AcousticTube` レベルで「数値発散」「自由振動」「エネルギー保存」の共通項目を 1 度書けば両派生に適用できる。

**2. VocalTract と NasalTract の責務分離**: 再設計版では VocalTract は「口腔のみ」を担当し、3 ポート接合と鼻腔管所有は別の `Articulator` クラスに分離する。Articulator は `oral: VocalTract`、`nasal: NasalTract`、`velopharyngealArea` を保持し、`processSample(glottal)` の中で velum=0 なら口腔単体、それ以外なら 3 ポート接合経由で両管を仲介する。これにより VocalTract は鼻腔を一切知らなくて済み、テストや単体動作の検証が容易になる。Phase 7 で必要となる「VocalTract に nasalTract メンバを生やす」という侵入的変更が不要になる。

**3. 接合点の固定 vs 可変**: 現行は NASAL_JUNCTION_INDEX = 20 で固定するが、解剖学的に個人差が大きいため、再設計版なら Phase 1 から `nasalJunctionIndex` を `Articulator` の状態として動的に変更可能にする。さらに index ではなく解剖学的長さ (cm) で表現する方が直感的（例: `nasalJunctionPosition_cm = 9.5`）。Phase 9 で UI から「軟口蓋位置調整スライダー」を追加するのが容易。トレードオフは `cachedNasalASumInv` 等のキャッシュ無効化が複雑化する点で、これは Articulator に `invalidateCache()` メソッドを持たせて対応する。

**4. velum 制御の実装場所**: 現行は VocalTract 内部にスカラーの `velopharyngealArea` を持たせるだけだが、再設計版なら独立した `VelopharyngealPort` クラスとして (a) 開閉面積 (b) 開閉スルーレート（生理学的に有限） (c) 完全閉鎖判定の閾値 (d) 補間カーブ を内包する。Phase 7 では velum の補間を `scheduleTransition` の拡張で扱うが、これは「汎用補間機構を velum に流用する」後付け感のある設計。`VelopharyngealPort` を Phase 1 から持っておけば、6.4 (切替クリック対策) はクラス内部の責務として隠蔽でき、player や Worklet 側の特別扱いが不要になる。

**5. 副鼻腔・咽頭腔の扱い**: 物理的精度を最大化するなら、上顎洞・前頭洞・梨状窩（piriform fossa, 4-5 kHz）など複数の側枝を持つ多分岐管モデルが正しい (Dang & Honda 1997)。しかし (a) 計算量が線形に増える (b) 個人差が極端 (c) 主観的音色への寄与が小さい、という理由で費用対効果が低い。再設計版でも Phase 7 段階では実装を見送り、Phase 10 以降の「物理的精度向上」フェーズで検討する。ただし `Articulator` に「任意個数の側枝 (`branches: Branch[]`) を `addBranch(tube, junctionIndex, port)` で追加可能」な API を Phase 1 から持たせておけば、後付けコストは低い。鼻腔も副鼻腔もこの API を通じて統一的に追加される。

**6. Worklet 側のアーキテクチャ: 単一管+分岐 vs 複数管の合成**: 現行は VocalTract が NasalTract を内部所有する「単一管+側枝」型だが、再設計版なら「複数独立管 + 接合グラフ」型が良い。`JunctionGraph` クラスが `tubes: AcousticTube[]` と `junctions: Junction[]` を保持し、各 Junction が関与する管の参照と接合点 index を持つ。`process()` では各 Junction の Smith 接合 → 各 Tube の散乱 を順次実行する。この設計なら Pink Trombone のような「2 本管モデル」を将来的に「3 本管 + N 接合点」に拡張する作業が「JunctionGraph に新しい Junction を 1 個追加するだけ」で済み、コア物理コードに手を入れる必要がなくなる。

**7. Phase 6 のノイズ注入機構との統合**: Phase 6 の `setConstrictionNoise(position, intensity, ...)` は口腔のみを対象とした。日本語に鼻腔内摩擦音は存在しないため Phase 7 の鼻腔管にノイズ注入は不要だが、英語のスナッフルや異常音響（鼻づまりの吹き出し音）を将来的にサポートする可能性はある。再設計版では `injectNoise(tubeId: 'oral' | 'nasal', position, intensity)` のように管 ID を引数にとる API にしておき、口腔・鼻腔のどちらにも同じインターフェースで注入できるようにする。Phase 7 では VocalTract のみが対象でも、API 設計はこの方向で揃えておく価値がある。Phase 7 段階で破壊的変更を加えるかは検討課題で、Phase 8/9 で必要になった時点で再考する選択肢もある。

**実装順序（再設計版）**: ①types/parameters → ②AcousticTube 基底 → ③Worklet 通信プロトコル (scheduleTransition + setNasalCoupling 含む) → ④turbulence-noise + VelopharyngealPort モジュール → ⑤VocalTract + NasalTract（同時実装） → ⑥Articulator (3 ポート接合含む) → ⑦声門音源 → ⑧プリセット (母音 + 子音 + 鼻音) → ⑨UI → ⑩Auto Sing → ⑪テキスト読み上げ。これで Phase 6 + 7 の後付け改修コストの大半が消える。ただし Phase 1 段階での設計検証時間が 2-3 日増えるため、「Phase 1-5 を母音楽器 MVP と割り切る」なら現行の単純設計の方が合理的で、Phase 6-9 の改修コスト（各 5 日程度）を「拡張時に支払う技術的負債」として受け入れるトレードオフも妥当な選択。

---

## 8. 後続タスクへの連絡事項

### 8.1 Phase 8 (テキスト→音素→発声) への申し送り

- **撥音「ん」の異音切替**: Phase 7 では /m/, /n/, /ɲ/ のみ実装。撥音 [ɴ]（口腔閉鎖なし、velum のみ全開）と [ŋ]（軟口蓋鼻音、`constrictionRange: { start: 14, end: 17 }, velopharyngealArea: 1.8`）は Phase 8 の text-parser 内で「後続音素を先読みして異音決定」するロジックと共に追加する。Phase 7 のプリセット形式 (`constrictionRange + velopharyngealArea`) を再利用できるよう、`ConsonantPreset` 型に異音バリアント機構（例: `variants?: { [followingPhoneme: string]: Partial<ConsonantPreset> }`）を追加することを検討。
- **NasalTract の setVelopharyngealArea API の安定化**: Phase 8 では phoneme-player が高頻度で velum を切り替える。Phase 7 で完成する `scheduleTransition` の `targetVelumArea` 拡張を前提に、player 側で「鼻音遷移は常に 5-10 ms ランプ」のラッパー関数を作る。
- **phoneme-player からの鼻音制御の流れ**: player は (a) 子音 ID から `consonant-presets.ts` を引いて `velopharyngealArea` を取得 (b) `scheduleTransition` で `targetAreas` と `targetVelumArea` を同時にスケジュール (c) 鼻音終了時も同様にランプダウン、の 3 ステップ。Phase 7 のデモ UI のロジックを player に流用する。
- **強度テーブル連動**: Phase 8 の強度テーブル（要件 3.3）で鼻音 = 0.55。Phase 7 では声門振幅を調整しないが、Phase 8 で `setGlottalAmplitude(level)` 追加時に鼻音発声で 0.55 を渡す。
- **Phase 6 申し送りとの整合**: Phase 6 → Phase 7 で「`scheduleTransition` 対象を velum まで拡張」を約束しているため、Phase 7 で確実に実装すること。未完成だと player 側で setNasalCoupling 直接呼びの workaround になり、クリックノイズの原因になる。

### 8.2 Phase 9 (テキスト読み上げ UI) への申し送り

- **鼻音の反共鳴をスペクトル表示で強調表示**: Phase 9 のスペクトル Canvas で、鼻音発声中（velum > 0）に反共鳴帯（500-2500 Hz）をハイライトする可能性。Phase 7 段階では engine.ts 側で「最後に送信した velopharyngealArea」を保持する方式で十分（worklet → メイン方向の通知メッセージは追加しない）。
- **声道エディタの軟口蓋位置マーカー**: Phase 9 の声道エディタに「接合点位置」マーカーを縦線描画する案がある。`NASAL_JUNCTION_INDEX = 20` を 16 制御点 index に逆換算すると `20 / (44/16) ≈ 7.27` で制御点 7-8 の中間。Phase 7 では実装しない。
- **velum 開閉の UI 表示**: 鼻音発声中の「鼻」アイコン点灯や velopharyngealArea 数値表示など。Phase 9 で必要になれば `engine.ts` に `getNasalCoupling()` ゲッターを追加する。
- **デモ UI の扱い**: Phase 7 の 3 ボタン (/m/, /n/, /ɲ/) は Phase 9 完成形 UI 投入時に Phase 6 の 4 ボタンと共に削除または debug モードへ。CSS クラス名は Phase 6 の `.consonant-demo-*` 接頭辞統一に従い、Phase 7 では `.consonant-demo-nasal-*` で揃える。
- **モード遷移時の鼻音再生停止**: Phase 9 の OperationMode 切替時に進行中の `setNasalCoupling` をキャンセルする必要。Phase 6 で導入される `cancelTransition()` メッセージで `targetVelumArea` 補間も同時にキャンセルされる設計にしておくこと。

---

## 9. 参考リンク

- [docs/REQUIREMENTS_CONSONANT_TTS.md](../REQUIREMENTS_CONSONANT_TTS.md) — 子音対応・テキスト読み上げ要件定義（2.3 鼻腔分岐管）
- [docs/CONSONANT_RESEARCH.md](../CONSONANT_RESEARCH.md) — 鼻音・3 ポート接合の技術調査（1.4 / 2.3）
- [docs/MILESTONES.md](../MILESTONES.md) — Phase 7 セクション
- [docs/tickets/PHASE6-001_consonant-foundation.md](./PHASE6-001_consonant-foundation.md) — Phase 6 子音基盤チケット（依存）
- [CLAUDE.md](../../CLAUDE.md) — 既存アーキテクチャと設計判断
- Maeda, S. (1982). "A digital simulation method of the vocal-tract system." *Speech Communication* 1(3-4), 199-229. — 3 ポート接合と鼻腔管の数値モデル化
- Dang, J., Honda, K., & Suzuki, H. (1994). "Morphological and acoustical analysis of the nasal and the paranasal cavities." *JASA* 96(4), 2088-2100. — 鼻腔形状の MRI 計測値
- Dang, J. & Honda, K. (1997). "Acoustic characteristics of the piriform fossa." *JASA* 101(1), 456-465. — 副鼻腔の音響特性（Phase 7 範囲外だが将来参照）
- Stevens, K.N. (1998). *Acoustic Phonetics*. MIT Press. — 鼻音の反共鳴の音響理論
- Story, B.H. (2005). "A parametric model of the vocal tract area function." *JASA* 117(5), 3231-3254. — 声道断面積関数のパラメトリックモデル
- Smith, J.O. (1992). "Physical modeling using digital waveguides." *Computer Music Journal* 16(4), 74-91. — Smith 1 乗算接合と多ポート散乱の理論
