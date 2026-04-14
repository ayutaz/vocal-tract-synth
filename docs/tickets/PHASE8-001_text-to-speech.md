# PHASE8-001 テキスト→音素→発声

## 1. 概要

| 項目 | 内容 |
|------|------|
| チケットID | PHASE8-001 |
| フェーズ名 | Phase 8 — テキスト→音素→発声 |
| マイルストーン | [docs/MILESTONES.md `Phase 8` セクション](../MILESTONES.md) |
| 要件定義 | [docs/REQUIREMENTS_CONSONANT_TTS.md 3.1 / 3.2 / 3.3 / 3.4 / 2.3 撥音規則](../REQUIREMENTS_CONSONANT_TTS.md) |
| 状態 | 計画中（未着手） |
| 前提条件 | Phase 6 完了（[PHASE6-001](./PHASE6-001_consonant-foundation.md)）, Phase 7 完了（[PHASE7-001](./PHASE7-001_nasal-tract-model.md)）。MIN_AREA 二段化、`setConstrictionNoise`、`scheduleTransition`、19 子音プリセット、3 鼻音プリセット、3 ポート接合と velum 制御が動作中。 |
| 推定工数 | 4 名構成 × 約 6 営業日 |
| 優先度 | 高（Phase 9 UI 完成の前提。プログラマブル `play(text)` が成立しないと UI 実装の検証ができない） |
| 成果物（新規） | `src/text/text-parser.ts`, `src/text/text-parser.test.ts`, `src/text/phoneme-timeline.ts`, `src/text/phoneme-timeline.test.ts`, `src/text/phoneme-player.ts`, `src/text/phoneme-player.test.ts` |
| 成果物（変更） | `src/audio/consonant-presets.ts`, `src/types/index.ts`, `src/main.ts`, `src/audio/engine.ts` |

---

## 2. タスク目的とゴール

### 2.1 目的

Phase 6-7 で確立した子音発声基盤と鼻腔管モデルを「テキスト読み上げ可能な合成器」として連携させる。Phase 8 の最終形は `play("こんにちは")` という 1 行の API 呼び出しで、ひらがな文字列が音素列に分解され、音素タイムラインが生成され、AudioContext のクロックに同期して声道形状・声門パラメータ・ノイズ注入・velum 開閉が連続的に切り替わり、5 音素以上の連続発声が成立することである。Phase 9 で実装する UI は本フェーズで提供する `play()` API を呼ぶだけで動作する設計になることを保証する。

形態素解析・アクセント辞書・カタカナ漢字対応は意図的にスコープ外とする。本フェーズの目的は「最低限自然な読み上げ」であって「商用 TTS と同等の自然さ」ではない。テーブル駆動の最長一致パーサ（約 110 エントリ）と少数のルールベース韻律（平板型 F0、文末下降、Declination、疑問文）に絞ることで、(a) 実装規模を 4 名 × 6 日に収める (b) 形態素解析エンジン (kuromoji 等) のバンドルサイズ (~5 MB) を回避し GitHub Pages 静的配信を維持する (c) 後続フェーズ・後続プロジェクトでの差し替え余地を残す、という 3 点を達成する。

### 2.2 達成基準

- ひらがな全清音（46 字）+ 濁音（20 字）+ 半濁音（5 字）+ 拗音（36 組）+ 特殊拍（3 字）が音素 ID にマップされている
- 最長一致アルゴリズムが拗音「きゃ」を「き」+「ゃ」ではなく単一の `kja` として認識する
- 撥音「ん」が後続音素の調音点に応じて `[m]` / `[n]` / `[ŋ]` / `[ɴ]` のいずれかに切り替わる
- 句点「。」「、」がそれぞれ 300-500 ms / 150-250 ms のポーズに変換される
- 速度係数 0.5x〜2.0x で全音素の `duration` が比例変化する
- F0 が文頭で初頭昇降、文末で 140→80 Hz の下降、文中で `exp(-0.3 * t)` の Declination を示す
- 疑問符「？」が末尾検出された文で文末 F0 が +50 Hz 上昇する
- `play("こんにちは")` で 5 音素以上が連続発声される
- 子音→母音、母音→鼻音→母音などの遷移がすべて Phase 6 の `scheduleTransition` 経由でクリックノイズなく繋がる
- 既存の母音プリセット・Auto Sing が退行なく動作する（`OperationMode` の排他制御自体は Phase 9 で導入するが、Phase 8 では `play()` 呼び出し中の Auto Sing 起動は internal flag で防ぐ）

### 2.3 完了条件

1. `src/text/text-parser.ts` が `parseHiragana(text: string): PhonemeToken[]` を提供し、約 110 エントリのテーブルから最長一致で音素分解する
2. 撥音「ん」のトークンに後続音素の lookahead を反映した allophone（`m`/`n`/`ng`/`N`）が記録される
3. `src/text/phoneme-timeline.ts` が `generateTimeline(tokens: PhonemeToken[], opts: TimelineOptions): PhonemeEvent[]` を提供し、要件定義 3.2/3.3 の持続時間モデル・F0 韻律ルール・強度テーブルを実装する
4. `src/text/phoneme-player.ts` が `PhonemePlayer` クラスを提供し、`play() / pause() / stop() / seek()` の 4 API と `onPhonemeChange / onComplete` の 2 コールバックを公開する
5. `PhonemePlayer` は `AudioContext.currentTime` を基準クロックとして使用し、`scheduleTransition` を Worklet に送って区間遷移をサンプル精度で実行する
6. `consonant-presets.ts` に拗音派生音素（/kja/, /ɕu/, /tɕo/ など）と特殊拍（促音 /Q/, 長音 /R/, 撥音 /ɴ/）の補完プリセットが追加されている
7. `src/main.ts` が `play(text: string): Promise<void>` をモジュール export とグローバル `window.play` の両方で公開する
8. `play("こんにちは")` で /k,o,ɴ→n,n,i,tɕ,i,w,a/ が連続発声され、聴感テストで「こんにちは」と認識可能なレベル
9. `play("さくら")` で /s,a,k,u,ɾ,a/ が遷移クリックなく再生される
10. `play("ちょっと")` で促音の閉鎖と破擦音 /tɕ/ の連続が物理モデル経由で表現される
11. `play("にゃーん")` で拗音 + 長音 + 撥音語末 [ɴ] が再生される
12. `text-parser.test.ts` / `phoneme-timeline.test.ts` / `phoneme-player.test.ts` の単体テストが全件通過する
13. `play()` 呼び出しから初音発声までのレイテンシが 50 ms 以内（要件定義 6 非機能要件）
14. Chrome / Firefox / Edge の最新版で動作確認済み

---

## 3. 実装する内容の詳細

### 3.1 text-parser.ts（ひらがな→音素変換）

#### 3.1.1 最長一致テーブルの設計

ひらがな文字列を先頭から走査し、毎位置で「2 文字優先 → 1 文字 fallback」の最長一致を試みる。2 文字を優先する理由は拗音（「きゃ」「しゅ」「ちょ」など 36 組）と濁音半濁音の組合せ（「ぎゃ」「ぴゅ」など）を分割せず単一トークンとして扱うため。

```typescript
// src/text/text-parser.ts
export interface PhonemeToken {
  source: string;          // 元のひらがな（例: "きゃ"）
  phonemes: string[];      // IPA 音素列（例: ["k", "j", "a"] または ["kj", "a"]）
  category: PhonemeCategory; // 母音 / 子音 / 拗音 / 特殊拍 / ポーズ
  isLast: boolean;         // 文末トークンか
  position: number;        // 元テキスト中の文字 index
}

export type PhonemeCategory =
  | 'vowel' | 'plosive' | 'fricative' | 'affricate'
  | 'nasal' | 'flap' | 'approximant'
  | 'palatalized'           // 拗音
  | 'sokuon' | 'choon' | 'hatsuon'  // 促音 / 長音 / 撥音
  | 'pause';                // 句読点・無音

const HIRAGANA_TO_PHONEME: Record<string, string[]> = {
  // 清音 46（一部抜粋）
  'あ': ['a'], 'か': ['k','a'], 'し': ['ɕ','i'], 'つ': ['ts','ɯ'],
  'に': ['ɲ','i'], 'ふ': ['ɸ','ɯ'], 'り': ['ɾ','i'], 'わ': ['w','a'],
  // 濁音 20（一部）: が→[g,a], じ→[dʑ,i], づ→[dz,ɯ], び→[b,i]
  // 半濁音 5: ぱ→[p,a], ぴ→[p,i], ぷ→[p,ɯ], ぺ→[p,e], ぽ→[p,o]
  // 拗音 36（2 文字）: きゃ→[kj,a], しゅ→[ɕ,ɯ], ちょ→[tɕ,o], ぎゃ→[gj,a],
  //                  じゅ→[dʑ,ɯ], ぴょ→[pj,o], にゃ→[ɲ,a], りゅ→[ɾj,ɯ] 等
  // 特殊拍 3
  'っ': ['Q'], // 促音（後続子音の閉鎖延長）
  'ー': ['R'], // 長音（直前母音の延長）
  'ん': ['N'], // 撥音（lookahead で [m]/[n]/[ŋ]/[ɴ] へ展開）
};
```

総エントリ数: 清音 46 + 濁音 20 + 半濁音 5 + 拗音 36 + 特殊拍 3 = **110**。実装時は全エントリを網羅し、`text-parser.test.ts` の `it.each` で全件を回す。

#### 3.1.2 パーサ本体のアルゴリズム

```
parseHiragana(text):
  tokens = []
  i = 0
  while i < text.length:
    if 句読点(text[i]):
      tokens.push(makePunctuationToken)
      i += 1; continue
    two = text.slice(i, i+2)
    if HIRAGANA_TO_PHONEME[two]:        # 拗音優先
      tokens.push(...); i += 2
    elif HIRAGANA_TO_PHONEME[text[i]]:  # 1 文字 fallback
      tokens.push(...); i += 1
    else:
      i += 1                             # 未知文字（カタカナ等）は無視
  tokens[last].isLast = true
  return tokens
```

#### 3.1.3 撥音「ん」の異音切替（lookahead）

`parseHiragana()` の後段処理 `resolveHatsuonAllophones(tokens)` で、「ん」トークン (`N`) の直後トークンの先頭音素を参照し、要件定義 2.3 表に従って allophone を確定する。

| 後続音素の先頭 | 撥音の allophone | 口腔閉鎖位置 |
|---------------|-----------------|-------------|
| `m` / `p` / `b` / `mj` / `bj` / `pj` | `[m]` | 両唇 (idx 0-2) |
| `n` / `t` / `d` / `ts` / `dz` / `ɲ` / `tɕ` / `dʑ` | `[n]` | 歯茎 (idx 6-9) |
| `k` / `g` / `kj` / `gj` | `[ŋ]` | 軟口蓋 (idx 14-17) |
| 母音 / `j` / `w` / `ɾ` / なし（語末） | `[ɴ]` | 口腔閉鎖なし、velum 全開 |

促音「っ」(`Q`) と長音「ー」(`R`) は phoneme-timeline.ts 側で展開する（前者は直後子音の閉鎖延長 80-120 ms、後者は直前母音の duration 延長）。

### 3.2 phoneme-timeline.ts（タイムライン生成）

#### 3.2.1 PhonemeEvent 型定義

要件定義 3.4 に従い、`PhonemeEvent` を `src/types/index.ts` に追加する。

```typescript
// src/types/index.ts
export interface PhonemeEvent {
  phoneme: string;          // IPA 表記（例: 'a', 's', 'tɕ', 'ɴ'）
  startTime: number;        // 秒（タイムライン先頭からの絶対時刻）
  duration: number;         // 秒
  tractAreas: Float64Array; // 16 制御点の声道形状
  f0Start: number;          // 区間開始 F0 (Hz)
  f0End: number;            // 区間終了 F0 (Hz)
  sourceType: 'voiced' | 'noise' | 'voiced+noise' | 'silence';
  amplitude: number;        // 相対振幅 (0.0 - 1.0)
  nasalCoupling: number;    // 鼻腔結合面積 (0=閉鎖, 1.5-2.0=開放)
  constrictionNoise?: {     // 摩擦・破裂のノイズ注入
    position: number;       // 44 区間 index
    centerFreq: number;
    bandwidth: number;
    intensity: number;
  };
  transitionMs: number;     // 直前イベントからこのイベントへの遷移時間（5-20ms）
}
```

#### 3.2.2 持続時間モデル

| カテゴリ | 基本値 (ms) |
|---------|------------|
| vowel | 100 |
| plosive | 30（閉鎖は別カウント） |
| fricative | 70 |
| affricate | 90 |
| nasal | 50 |
| flap | 25 |
| approximant | 40 |
| palatalized（拗音） | 90 |
| sokuon（促音） | 100（直後子音の閉鎖延長） |
| choon（長音） | 100（直前母音の延長） |
| hatsuon（撥音） | 70 |

```
duration = baseMs * positionMul / rate / 1000   // 秒
positionMul: 文頭=1.2 / 文末=1.5 / 読点前=1.3 / それ以外=1.0
```

句読点ポーズは別ロジック・速度係数非依存: 句点 400 ms / 読点 200 ms / 疑問符・感嘆符 350 ms。

#### 3.2.3 F0 韻律ルール

```typescript
interface ProsodyOptions {
  basePitch: number;       // Hz、デフォルト 110
  highPitch: number;       // Hz、デフォルト 140
  finalLowPitch: number;   // Hz、デフォルト 80
  questionBoost: number;   // Hz、デフォルト 50
  declinationRate: number; // デフォルト 0.3 (1/秒)
}
```

`computeF0(events, isQuestion, opts)` が以下を順に適用:

1. **平板型基準**: 1 モーラ目 = `basePitch`、2 モーラ目以降 = `highPitch`
2. **Declination**: 各イベントで `f0 *= exp(-declinationRate * startTime)`
3. **文末下降**（疑問文以外）: 最終 2-3 モーラで `lerp(highPitch, finalLowPitch, ratio)`
4. **疑問文末尾上昇**: 末尾検出時に最終 2 モーラを `+questionBoost` Hz
5. **微下降**: 各イベント区間内で `f0End = f0Start * 0.98`

#### 3.2.4 強度テーブル

要件定義 3.3 の表をそのまま実装。母音 /a/ = 1.0、/e,o/ = 0.85、/i,ɯ/ = 0.7、鼻音 = 0.55、摩擦 = 0.3、破裂バースト = 0.4、閉鎖区間 = 0.0。`sourceType` は同じく要件定義の表を参照（vowel/nasal = `voiced`, fricative = `noise`, plosive のバースト = `noise`, voiced plosive = `voiced+noise`, 閉鎖 = `silence`）。

#### 3.2.5 generateTimeline のフロー

```
generateTimeline(tokens, opts):
  expanded = expandTokens(tokens)         // 拗音 / 促音 / 長音 / 撥音を音素列に展開
  events = []
  t = 0
  for i, phone in enumerate(expanded):
    pos = decidePosition(i, expanded.length, beforeComma?)
    dur = computeDuration(phone, opts.rate, pos)
    tractAreas = lookupConsonantPreset(phone) || interpolateVowelShape(phone)
    events.push({
      phoneme, startTime=t, duration=dur, tractAreas,
      sourceType=lookupSourceType(phone),
      amplitude=lookupAmplitude(phone),
      nasalCoupling = (phone.category == nasal) ? 1.8 : 0,
      constrictionNoise = lookupNoise(phone),
      transitionMs = decideTransitionMs(prev, phone),  // 5-20ms
    })
    t += dur
  computeF0(events, opts.isQuestion, opts.prosody)     // F0 を 5 ステップで埋める
  return events
```

`TimelineOptions = { rate: number; prosody: ProsodyOptions; isQuestion: boolean }`。

### 3.3 phoneme-player.ts（再生エンジン）

#### 3.3.1 クラス設計

```typescript
// src/text/phoneme-player.ts
export interface PhonemePlayerOptions { engine: Engine; tractEditor: TractEditor; }

export class PhonemePlayer {
  constructor(opts: PhonemePlayerOptions);
  load(events: PhonemeEvent[]): void;
  play(): void;
  pause(): void;
  stop(): void;
  seek(timeSeconds: number): void;
  onPhonemeChange(cb: (event: PhonemeEvent, index: number) => void): void;
  onComplete(cb: () => void): void;
}
```

内部状態: `events[]`, `startContextTime`, `state ('idle'|'playing'|'paused'|'stopped')`, `currentEventIndex`, `scheduledTimeoutIds[]`。

#### 3.3.2 AudioContext.currentTime 基準クロック

`setTimeout` のタイマー精度は ±15 ms 程度で、5-20 ms 子音遷移には不足。本実装では `AudioContext.currentTime` を絶対時刻基準とし、`setTimeout` は「次の fireEvent 発火直前のおおよそのタイミング」を作るためだけに使う。実際の遷移はサンプル精度の `scheduleTransition`（Phase 6 で Worklet 側に追加済み）が担当するため、メインスレッドのタイミング誤差 ±10 ms は Worklet 側の補間で吸収される。

`play()` の処理:

1. `startContextTime = audioContext.currentTime` を記録
2. 各イベント `e[i]` について、`fireAtMs = e.startTime * 1000 - 5` で `setTimeout(() => fireEvent(i), fireAtMs)` を予約
3. 全イベント終了予定時刻 + 50 ms 後に `onComplete` を発火する setTimeout を最後に予約

`fireEvent(i)` の処理（Engine ラッパ経由）:

| 順 | API 呼び出し | 内容 |
|----|-------------|------|
| a | `engine.scheduleTransition(areas44, durationSamples)` | 16→44 変換後、サンプル精度補間で声道形状遷移 |
| b | `engine.setSourceType(e.sourceType)` | 声門音源タイプ切替 |
| c | `engine.setAmplitude(e.amplitude)` | 振幅切替 |
| d | `engine.setF0Ramp(e.f0Start, e.f0End, e.duration)` | F0 線形ランプ |
| e | `engine.setNasalCoupling(e.nasalCoupling)` | velum 開閉 |
| f | `engine.setConstrictionNoise(...)` または `(-1, 0, 0, 0)` | 摩擦/破裂のノイズ注入オン/オフ |
| g | `onPhonemeChangeCb?.(e, i)` | UI 通知 |

#### 3.3.3 stop / pause / seek

`stop()` は全 `setTimeout` をキャンセルし、声道形状を中性母音（/ə/ 相当）にソフトリセット（300 ms かけて scheduleTransition）し、velum を閉鎖、ノイズ注入を停止、F0 を 110 Hz に戻す。

`pause()` は `AudioContext.suspend()` ではなく、`setTimeout` のキャンセル + 現在の `currentEventIndex` 保存に留める。Engine の suspend は Auto Sing と共有しているため pause は使わない設計とする。

`seek(t)` は `stop()` 相当で全タイマーキャンセル後、`startContextTime = ctx.currentTime - t` で再計算し、t 以降の各イベントを再スケジュール。

### 3.4 撥音「ん」の異音切替ロジック（再掲・補足）

text-parser 側 (3.1.3) で allophone を `m` / `n` / `ŋ` / `ɴ` に展開した後、phoneme-timeline.ts 側で対応する声道形状とパラメータを割り当てる:

| allophone | 口腔閉鎖位置 (44 区間 idx) | velum (cm²) | constrictionNoise |
|-----------|----------------------------|-------------|-------------------|
| m | 0-2（両唇） | 1.8 | なし |
| n | 6-9（歯茎） | 1.8 | なし |
| ŋ | 14-17（軟口蓋） | 1.8 | なし |
| ɴ | 口腔閉鎖なし、舌位置中性 | 2.0（全開） | なし |

`consonant-presets.ts` の鼻音プリセット（Phase 7 で /m/, /n/, /ɲ/ を追加済み）に /ŋ/ と /ɴ/ を補完する形で実装する。

### 3.5 consonant-presets.ts の補完

Phase 6/7 で追加済みの 22 音素（破裂 6 + 摩擦 7 + 破擦 4 + 弾音 1 + 半母音 2 + 鼻音 3 = 23、但し /h/ と /ç/ の重複等を吟味）に加え、以下を Phase 8 で補完する:

- 拗音派生子音: `kj`, `gj`, `mj`, `ɾj`, `bj`, `pj`（口蓋化された破裂・鼻・弾音・両唇音）
- 撥音異音: `ŋ`, `ɴ`
- 特殊拍ヘルパ: 促音 `Q`（直前子音の閉鎖を 80-120 ms 延長するフラグ用ダミーエントリ）、長音 `R`（直前母音の duration を 80-120 ms 延長するフラグ用ダミーエントリ）

これらは「単独で発声するエントリ」ではなく「タイムライン展開時に直前/直後のエントリを変形するルール」として扱い、`consonant-presets.ts` には情報源として記録する。

### 3.6 play(text) API

`src/main.ts` に追加するシグネチャ:

```typescript
export async function play(
  text: string,
  opts?: { rate?: number; basePitch?: number },
): Promise<void>;

(window as any).play = play;   // DevTools / Phase 9 UI 両用
```

処理フロー:

1. `engine.state !== 'running'` なら `throw` (Start 前)
2. `autoSinger.isPlaying()` なら `throw` (Phase 9 で `OperationMode` に統合予定)
3. `tokens = parseHiragana(text)` → `resolveHatsuonAllophones(tokens)`
4. `isQuestion = text.endsWith('？' | '?')`
5. `events = generateTimeline(tokens, { rate, prosody, isQuestion })`
6. `phonemePlayer.load(events); phonemePlayer.play()`
7. `Promise<void>` を返す（`onComplete` で resolve）

エラーは throw、呼び出し側は try/catch で受ける。

---

## 4. 実装に必要なエージェントチーム

### 4.1 構成

4 名構成。各エージェントは独立したファイル群を担当し、契約面（型定義・関数シグネチャ）のみで結合する。

### 4.2 text-parser エージェント

| 項目 | 内容 |
|------|------|
| 担当ファイル | `src/text/text-parser.ts`, `src/text/text-parser.test.ts` |
| 入力 | `text: string`（ひらがな + 句読点 + 疑問符） |
| 出力 | `PhonemeToken[]`（撥音 lookahead 解決済み） |
| 完了条件 | 110 エントリ全件のテーブルが定義され、`parseHiragana("こんにちは")` が `["k","o","ɴ→n","tɕ","i","w","a"]` 相当のトークン列を返す。撥音 4 種すべてが lookahead 切替テストに合格。 |

### 4.3 timeline エージェント

| 項目 | 内容 |
|------|------|
| 担当ファイル | `src/text/phoneme-timeline.ts`, `src/text/phoneme-timeline.test.ts`, `src/types/index.ts` への `PhonemeEvent` 追加 |
| 入力 | `PhonemeToken[]`, `TimelineOptions`（速度係数・韻律パラメータ・疑問文フラグ） |
| 出力 | `PhonemeEvent[]`（startTime / duration / f0Start / f0End / tractAreas 等が全て埋まっている） |
| 完了条件 | 速度係数 0.5x / 1.0x / 2.0x で総 duration が比例変化する。文末下降 / Declination / 疑問文末尾上昇のユニットテストが通る。`generateTimeline` の処理時間が 1 文（20 音素）あたり 5 ms 以内。 |

### 4.4 player エージェント

| 項目 | 内容 |
|------|------|
| 担当ファイル | `src/text/phoneme-player.ts`, `src/text/phoneme-player.test.ts` |
| 入力 | `PhonemeEvent[]`, `Engine`, `TractEditor` |
| 出力 | 副作用として Engine への `scheduleTransition` / `setNasalCoupling` / `setConstrictionNoise` / `setF0Ramp` 呼び出し、`onPhonemeChange` コールバック、`onComplete` resolve |
| 完了条件 | `play() / pause() / stop() / seek()` の 4 API が全てユニットテストで動作。fake AudioContext を使った `currentTime` ベースのスケジューリングで、各 fireEvent が想定時刻 ±10 ms 以内に発火する。stop 時に声道がソフトリセットされる。 |

### 4.5 integration エージェント

| 項目 | 内容 |
|------|------|
| 担当ファイル | `src/audio/consonant-presets.ts`（補完）, `src/main.ts`（`play()` API 追加）, `src/audio/engine.ts`（`scheduleTransition`/`setNasalCoupling`/`setConstrictionNoise`/`setF0Ramp` のラッパ） |
| 入力 | 上記 3 エージェントの成果物 |
| 出力 | `play("こんにちは")` 等の E2E 動作 |
| 完了条件 | 5.4 の E2E テスト 6 ケース全件パス、レイテンシ 50 ms 以内、Auto Sing との競合エラーが正しく throw される。|

### 4.6 エージェント間の依存関係

```
text-parser  ─┐
              ├──→ integration ──→ play("...")
timeline ────┤
              │
player ──────┘
```

text-parser, timeline, player は契約面（型定義）が確定すれば並行作業可能。integration は 3 エージェントの成果物が揃った時点で着手し、E2E 検証を担当する。型定義 (`PhonemeToken`, `PhonemeEvent`, `TimelineOptions`) は本チケットの 3.1.1 / 3.2.1 / 3.2.5 で先行確定させる。

---

## 5. 提供範囲とテスト項目

### 5.1 スコープ内

- ひらがな全清音 46 字 / 濁音 20 字 / 半濁音 5 字 / 拗音 36 組 / 特殊拍 3 字 = 計 110 文字
- 最長一致パーサ（2 文字優先 → 1 文字 fallback）
- 撥音「ん」の 4 種異音切替（[m] / [n] / [ŋ] / [ɴ]）
- 促音「っ」と長音「ー」の展開
- 持続時間モデル（カテゴリ別基本値 + 速度係数 0.5x-2.0x + 文位置修正）
- F0 韻律ルール（平板型 + 初頭昇降 + 文末下降 + 疑問文 + Declination）
- 強度テーブルと sourceType の音素別割当
- PhonemeEvent タイムラインの再生（play / pause / stop / seek）
- 句読点ポーズ（句点 400 ms / 読点 200 ms）
- `play(text)` プログラマブル API（モジュール export + `window.play`）

### 5.2 スコープ外

- カタカナ・漢字対応（Phase 8 ではひらがなのみ）
- 形態素解析（kuromoji 等のバンドル組み込み）
- アクセント辞書（NHK アクセント辞典等の参照）
- 多様なアクセント型（頭高型・中高型・尾高型）— 平板型のみ
- 韻律パラメータの UI 編集（Phase 9 でも編集 UI は出さない）
- 録音 / wav エクスポート
- UI 側のテキスト入力 textarea / 再生ボタン / タイムライン表示（Phase 9）

### 5.3 ユニットテスト

#### 5.3.1 text-parser.test.ts

- 全清音 46 字の 1 文字テーブル展開を `it.each` で確認
- 全濁音 20 字 / 半濁音 5 字の 1 文字テーブル展開
- 全拗音 36 組の 2 文字最長一致（「きゃ」が「き」+「ゃ」に分解されないこと）
- 撥音「ん」の 4 種 lookahead 切替:
  - 「さんま」→ /s,a,m,m,a/（[m] への切替）
  - 「さんた」→ /s,a,n,t,a/（[n] への切替）
  - 「さんか」→ /s,a,ŋ,k,a/（[ŋ] への切替）
  - 「さん」→ /s,a,ɴ/（語末 [ɴ]）
  - 「さんあ」→ /s,a,ɴ,a/（母音前 [ɴ]）
- 促音「っ」の存在検出（「ちょっと」のトークン化）
- 長音「ー」の存在検出（「にゃーん」のトークン化）
- 句点「。」/ 読点「、」/ 疑問符「？」のポーズトークン生成
- 未知文字（カタカナ・漢字・記号）の無視

#### 5.3.2 phoneme-timeline.test.ts

- 速度係数 0.5x で総 duration が 1.0x の 2 倍、2.0x で 0.5 倍になる
- 文頭の母音が x1.2、文末の母音が x1.5 延伸される
- 読点前のトークンが x1.3 延伸 + 200 ms ポーズが挿入される
- 平板型 F0 ルール: 1 モーラ目が 110 Hz、2 モーラ目以降が 140 Hz から開始
- 文末下降: 最終 3 イベントで F0 が 140 → 80 Hz に補間される
- Declination: 1 秒経過時に F0 が `exp(-0.3) ≈ 0.74` 倍に減衰する
- 疑問文（末尾「？」）で文末 F0 が +50 Hz 上昇する
- 強度テーブル: /a/ → 1.0, /i/ → 0.7, /m/ → 0.55, /s/ → 0.3
- sourceType 割当: /a/ → 'voiced', /s/ → 'noise', /b/ → 'voiced+noise', 閉鎖区間 → 'silence'
- nasalCoupling: 鼻音で 1.8、母音で 0

#### 5.3.3 phoneme-player.test.ts

- fake AudioContext (currentTime を制御可能) を使用して fireEvent タイミングを検証
- 各イベントが想定時刻 ±10 ms 以内に発火する
- stop() 後に全 setTimeout がキャンセルされ、scheduleTransition がソフトリセット形状を 1 回呼ぶ
- pause() 後に play() で再開できる（途中の状態保存）
- seek(t) で t 以降のイベントが再スケジュールされる
- onPhonemeChange コールバックが各 fireEvent で呼ばれる
- onComplete コールバックが最終イベント終了後に呼ばれる
- play() 中に再度 play() 呼び出しは no-op

### 5.4 E2E テスト

実 AudioContext + 実 Worklet を使用。手動聴感確認 + スペクトル / 波形の自動検証。

| ID | 入力 | 期待出力 | 検証方法 |
|----|------|---------|---------|
| E1 | `play("さくら")` | /s,a,k,u,ɾ,a/ の 6 音素が 600-900 ms で連続発声 | 波形長確認 + 高域ノイズ（/s/ で 5-7 kHz）視認 |
| E2 | `play("こんにちは")` | /k,o,ɴ→n,tɕ,i,w,a/、撥音が後続「に」の前で [n] に切替 | スペクトログラムで撥音区間の 250 Hz 鼻腔ホルマント視認 |
| E3 | `play("ちょっと")` | /tɕ,o,Q→t,t,o/、促音区間で 80-120 ms の閉鎖（無音）+ 破擦音再生 | 波形の振幅が促音区間で 0 に近い、その後破裂バースト視認 |
| E4 | `play("にゃーん")` | /ɲ,a,a,ɴ/、拗音 + 長音 + 語末 [ɴ] | duration が「にゃ」x1 + 長音延長 + 「ん」x1 で計算通り |
| E5 | `play("こんにちは。")` で文末下降検証 | 最終 3 音素で F0 が 140 → 80 Hz 補間 | F0 時系列ログ取得 + 単調減少確認 |
| E6 | `play("こんにちは")` を rate=0.5 / 2.0 で実行 | 総 duration が 2 倍 / 0.5 倍 | AudioContext.currentTime 計測 |
| E7 | 母音→子音→母音の遷移 | クリックノイズなし | スペクトログラムの 8 kHz 以上に瞬間的なバースト無し |
| E8 | `play("こんにちは")` レイテンシ | play 呼び出しから初音発声まで ≤ 50 ms | performance.now() 差分 |

### 5.5 既存非退行テスト

- 母音プリセット 5 種が正常動作
- Auto Sing が正常動作（`play()` 中の Auto Sing 起動は throw されることを確認）
- スペクトル表示・フォルマント計算が正常動作
- Phase 6 のデモ子音ボタン（/s/, /k/, /t/, /p/）が単独で発声可能
- Phase 7 の鼻音ボタン（/m/, /n/, /ɲ/）が単独で発声可能

---

## 6. 実装に関する懸念事項とレビュー項目

### 6.1 最長一致アルゴリズムの正確性

**懸念**: 拗音テーブルと清音テーブルの優先順を間違えると、「きゃ」が「き」+「ゃ」（小書き「ゃ」単独）に分解される可能性がある。小書き「ゃ」「ゅ」「ょ」を 1 文字テーブルに含めるべきか。

**対策**: 1 文字テーブルには小書きを含めず、必ず 2 文字最長一致で消費されるようにする。万一 2 文字一致しなかった場合（直前文字が「い段」以外）は、未知文字として無視する。`text-parser.test.ts` で「ゃゅょ」単独の入力を edge case として明示的にテストする。

### 6.2 撥音「ん」の lookahead が語末/文末の場合

**懸念**: 「さん」のように撥音が末尾に来る場合、`tokens[i+1]` が undefined になる。要件定義 2.3 では「語末/母音前」は [ɴ] (口蓋垂鼻音、口腔閉鎖なし、velum 全開) と定義されているが、母音前と語末を同一視して良いか。

**対策**: 母音前 [ɴ] と語末 [ɴ] は調音的にほぼ同一であるため、Phase 8 では同一実装とする。両者の差異（語末の弛緩）は Phase 9 以降の改善余地として記録。`resolveHatsuonAllophones` の実装で `next === undefined` と `next.phonemes[0] === vowel` の両方を [ɴ] にマップ。

### 6.3 promise chain vs setTimeout でのタイミング精度

**懸念**: メインスレッドの `setTimeout` 精度は ±15 ms 程度。これを基準にすると 5-20 ms の子音遷移には不適。

**対策**: メインスレッドの `setTimeout` は「次のイベントが発火する直前のおおよそのタイミング」を作るためだけに使用し、実際の遷移は Worklet 側の `scheduleTransition`（サンプル精度）が担当する。`setTimeout` の精度誤差は Worklet 側の補間が吸収する。fireEvent 時刻が想定より ±20 ms 以内にあれば許容範囲とする。

### 6.4 AudioContext.currentTime と setTimeout の同期

**懸念**: ブラウザがバックグラウンドタブに移行すると `setTimeout` が throttle され、`AudioContext.currentTime` だけが進む。これにより想定時刻と実時刻にズレが生じる。

**対策**: Phase 8 の段階では「タブがフォアグラウンドである」前提とする。Phase 9 の UI 完成時に `document.visibilitychange` イベントを監視して、バックグラウンド移行時には `pause()` を自動呼び出しする処理を追加する（後続フェーズ申し送り 8.2 に記載）。

### 6.5 phoneme-player 停止時の声道形状の保存

**懸念**: `stop()` で声道を中性形状にソフトリセットすると、ユーザがその後手動操作した場合の起点が不自然になる。元の形状（`tractEditor` の現在の手動形状）に戻すべきか。

**対策**: Phase 8 では「中性母音 /ə/ 形状にソフトリセット」を採用する（300 ms かけて補間）。理由は (a) Auto Sing も停止時に同様の挙動 (b) ユーザが `play()` 後に手動操作する想定は薄い (c) 完全な状態保存は Phase 9 の `OperationMode` 統合時に検討。レビュー時に挙動を確認し、不自然なら `tractEditor.snapshot()` で開始時形状を保存して復元する案へ切替可能とする。

### 6.6 既存の Auto Sing とのリソース競合

**懸念**: `engine` / `tractEditor` / `transitionManager`（Phase 6 で Worklet 側に追加）はシングルトンとして共有される。Auto Sing と PhonemePlayer が同時実行されると、`scheduleTransition` の引数が両側から書き換えられて競合する。

**対策**: Phase 8 の `play()` 関数の冒頭で `if (autoSinger.isPlaying()) throw new Error(...)` を実行し、相互排他を強制する。Phase 9 で `OperationMode` 状態機械（`'manual' | 'autoSing' | 'textRead'`）を controls.ts に導入し、UI レベルで boutton disable も追加する。Phase 8 段階では internal flag のみで対応。

### 6.7 韻律の自然さ（聴覚評価）

**懸念**: ルールベース F0 のみでは「機械的・棒読み」になりがち。日本語話者にとって自然と感じられるレベルか不透明。

**対策**: Phase 8 の達成基準は「最低限自然」であり、本格的な自然性は Phase 9 以降の改善余地とする。レビュー段階で 5 名程度の被験者に E1-E4 を聴かせ、「『さくら』『こんにちは』『ちょっと』『にゃーん』として認識可能か」「機械的だが意味は伝わるか」の 2 軸で 5 段階評価を取得し、平均 3.0 以上を Phase 8 完了の聴覚側基準とする。

### 6.8 2 文字最長一致と「ょ」を含む 3 文字シーケンス

**懸念**: 「しょっと」のように拗音 + 促音 + 子音のような 3 文字以上のシーケンスを正しく扱えるか。

**対策**: 最長一致は 2 文字までに固定する。「しょっと」は「しょ」(2文字) + 「っ」(1文字) + 「と」(1文字) と分解され、後段の促音処理で「っ」が「と」の閉鎖延長フラグに変換される。3 文字以上の特殊シーケンスは Phase 8 では取り扱わない。

### 6.9 PhonemeEvent.tractAreas を 16 制御点 vs 44 区間どちらで持つか

**懸念**: 既存の `tractEditor` は 16 制御点、Worklet は 44 区間で管理。`PhonemeEvent` がどちらを持つかで変換ロジックの場所が変わる。

**対策**: `PhonemeEvent.tractAreas` は **16 制御点** で持つ。理由は (a) `consonant-presets.ts` のプリセットも 16 制御点ベース (b) 44 区間への変換は既存の `interpolateAreas()` 関数を再利用するだけ (c) 16 制御点で持っておけば後で UI に表示する際の変換コストが減る。`PhonemePlayer.fireEvent` 内で 16→44 変換を行ってから `scheduleTransition` に渡す。

---

## 7. 一から作り直すとしたらどうするか

Phase 1 から本プロジェクトを作り直すなら、Phase 8 で痛感する「層の散乱」を回避するために、第 1 フェーズの段階で「**時刻 - パラメータ組のタイムライン**」という抽象を中核データ構造として導入する。母音遷移、Auto Sing、テキスト読み上げ、将来のオフラインレンダリング、すべてを「タイムラインの再生」として統一する設計である。

具体的には、Phase 1 で `PhonemeEvent` 相当の型を `Frame` または `TimelineEntry` という名前で定義する。フィールドは現在の `PhonemeEvent` とほぼ同等で、`startTime` / `duration` / `tractAreas` / `f0` / `sourceType` / `amplitude` / `nasalCoupling` / `noiseParams`。これを「単一サンプル分の合成パラメータ」ではなく「時刻区間に対するパラメータ束」として扱う。あらゆる発声操作は最終的に `Frame[]` を生成し、それを共通の `FrameSequencer` クラスが AudioContext クロックで再生する、という単一の再生経路にする。

この設計を Phase 1 から採用していたら、Phase 4 (Auto Sing) の実装は劇的に変わっていた。現在の auto-singer/ ディレクトリには `melody-generator.ts` / `vowel-sequencer.ts` / `rhythm-engine.ts` / `expression-engine.ts` / `phrase-manager.ts` の 5 ファイルがあり、それぞれが独自のタイミング管理を持っている。`FrameSequencer` 抽象が最初からあれば、`melody-generator` は単に `Frame[]` を生成するだけのモジュールになり、`vowel-sequencer` / `rhythm-engine` は不要になる（Frame 配列の生成ルールに統合される）。Phase 8 の `phoneme-player.ts` も `FrameSequencer` の薄いラッパとして 50 行程度で書ける。

`scheduleTransition` API も Phase 1 から存在しているべきだった。現在は Phase 6 で Worklet 側に追加する設計だが、母音→母音の遷移 (Phase 1) ですらサンプル精度補間があれば音質は改善する。ブラウザの `AudioParam.linearRampToValueAtTime` に相当する API を `tractAreas` に対しても用意する、という発想を最初から持っていれば、メインスレッドからの postMessage 頻度を 1/4 に減らせる。

韻律パラメータの統一管理も、Phase 1 で `Prosody` 名前空間を作っておくべきだった。現在は F0 がスライダー直接、Auto Sing は phrase-manager の中、Phase 8 では phoneme-timeline の中、と 3 箇所に分散している。Phase 1 で `Prosody.compute(frames, options)` という関数を 1 つだけ用意し、F0 / 強度 / 持続時間の計算を全フェーズで再利用する設計にすれば、Phase 8 の F0 ルールは Phase 4 と共通化できた。

ファイル配置については、`src/text/` よりも `src/prosody/` の方が後々の拡張に有利だったかもしれない。`text-parser.ts` は確かに「テキスト処理」だが、`phoneme-timeline.ts` と `phoneme-player.ts` は「韻律処理」と「再生」であり、テキストとは独立した抽象として扱える。Phase 9 以降で MIDI 入力からの旋律生成や、JSON タイムラインの直接読み込みを加える場合、`src/text/` 配下では収まりが悪い。ベストは `src/prosody/` に `frame.ts` / `frame-sequencer.ts` / `prosody.ts` を置き、`src/text/` には `text-parser.ts` だけを置く 2 層構造である。

オフラインレンダリング（OfflineAudioContext で wav エクスポート）への拡張性も、Phase 1 から `FrameSequencer` を `AudioContext` に依存させず、`AbstractClock` インターフェース（`getCurrentTime() / scheduleAt(time, fn)`）に依存させていれば、`OfflineClock` 実装を 1 つ追加するだけで wav エクスポートが実現する。現在の設計では Phase 8 の `phoneme-player.ts` が `setTimeout` をハードコードしているため、オフラインレンダリングには大幅な書き換えが必要になる。

最後に、現在の Phase 6-9 計画が「子音 → 鼻腔 → テキスト → UI」と物理層から積み上げる方針なのは正しいが、もし Phase 1 で `Frame` 抽象があれば、Phase 8 の text-parser を Phase 2 と並行して開発できた（音素列 → Frame 配列変換は物理層と独立）。これは結果論だが、「ユーザに見える機能 = テキスト読み上げ」を早い段階で動かしておくと、物理層の改善優先度が明確になる。プロジェクト全体のフェーズ分割は妥当だが、データ構造の早期統一は価値が高い、というのが Phase 8 設計時点での最大の教訓である。

---

## 8. 後続タスクへの連絡事項

### 8.1 Phase 9（UI 完成）への申し送り

- `play(text)` は `Promise<void>` を返す API として確定。UI 再生ボタンの onclick から `await play(textareaValue)` で呼び出せる。
- `PhonemePlayer.onPhonemeChange(cb)` コールバックを使用すれば、現在再生中の音素と index を UI 側に通知できる。タイムライン Canvas のハイライトはこのコールバックから駆動する。
- `PhonemePlayer.onComplete(cb)` で再生完了通知。UI の再生ボタンを「停止」→「再生」表示に戻すフックとして使用。
- 停止ボタン → `phonemePlayer.stop()` → 声道形状の中性母音ソフトリセット（300 ms）が動作する。Phase 9 では UI スナップショットからの完全復元を検討。
- テキスト再生中の声道エディタ自動アニメーションは、`onPhonemeChange` から `tractEditor.setControlPoints(event.tractAreas)` を呼ぶことで実現可能。アニメーション自体は Worklet 側の補間と並行して動くため、目視上は連続的に変化する。
- `OperationMode` 排他制御（`manual` / `autoSing` / `textRead`）は Phase 9 で controls.ts に導入。Phase 8 では `play()` 内の throw による暫定対応のみ。
- 速度スライダー（`#speech-rate-slider`、0.5x-2.0x）は Phase 9 で追加。`play(text)` の第 2 引数として `{ rate: number }` を受け取れるよう、Phase 8 でシグネチャ拡張: `play(text: string, opts?: { rate?: number; basePitch?: number })`。

### 8.2 Phase 10 以降（将来拡張）への申し送り

- カタカナ・漢字対応: text-parser.ts の入力前段にカタカナ→ひらがな変換テーブルと、kuromoji.js による漢字→ひらがな変換を追加する形で拡張可能。テーブルは現状の 110 エントリで完結しているため、変換層を増やすだけで本体に手を入れる必要はない。
- アクセント辞書: `phoneme-timeline.ts` の F0 計算ルールを差し替え可能にする。`computeF0` を `prosody.compute` のような外部注入パターンに変更しておくと、NHK アクセント辞典ベースのモジュールを差し替え可能。
- バックグラウンドタブ throttle 対応: `document.visibilitychange` イベントで `pause()` 自動発火。
- オフラインレンダリング: `AbstractClock` インタフェース化（6 章後半参照）+ `OfflineAudioContext` 経路の追加。
- 韻律編集 UI: アクセント型ラジオボタン、F0 曲線エディタ等は Phase 11 以降の機能拡張として記録。
- 多言語対応（英語等）: text-parser を多言語対応にする場合、`Tokenizer` インタフェースを定義して言語別実装を切替可能にする。

### 8.3 Phase 6/7 への遡及修正の有無

Phase 8 着手時に以下の遡及修正が必要になる可能性:

- `consonant-presets.ts` に拗音派生（`kj`, `gj` 等）を Phase 6 段階で定義しておけば Phase 8 の補完作業が減る。Phase 6 のチケットには「Phase 8 で補完予定」と注記済みなので、Phase 8 着手時に先行追加してもよい。
- `engine.ts` に `setF0Ramp(start, end, durationSec)` ヘルパが必要。Phase 1-5 では F0 は AudioParam の `linearRampToValueAtTime` 直接呼び出しだったが、Phase 8 では PhonemePlayer から呼ぶラッパが欲しい。`Engine` クラスに薄いラッパメソッドを追加する程度で済む。
- `engine.ts` に `setNasalCoupling(area)` ヘルパが Phase 7 で追加されているはずだが、未追加なら Phase 8 integration エージェントが追加する。
- `Engine.sampleRate` プロパティが Phase 1-5 で公開されていない場合、Phase 8 の player から参照するために getter を追加する必要がある。

これらは全て小規模変更であり、Phase 6/7 のスコープ拡大ではなく Phase 8 の前準備として扱う。
