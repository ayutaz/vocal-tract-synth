# マイルストーン

## 完了サマリー

Phase 1-9: 母音合成 + Auto Sing + 子音対応・テキスト読み上げが完成。

| Phase | タイトル | 状態 | チケット | コミット |
|-------|---------|------|---------|---------|
| 1 | 基本音声パイプライン | ✅ | -- | `af56b38` |
| 2 | 声門音源・母音プリセット | ✅ | -- | `0a47102` |
| 3 | 可視化・ピッチ制御 | ✅ | -- | `6c5afd7` |
| 4 | 自動歌唱モード | ✅ | -- | `37241f8` |
| 5 | 声質向上・UI改善 | ✅ | -- | `c972298` |
| 6 | 子音基盤（摩擦音・破裂音） | ✅ | [PHASE6-001](tickets/PHASE6-001_consonant-foundation.md) | `fcd04c2` (実装) + `ff18a84` (レビュー対応) + `27ae8d6` (Phase 1-7レビュー対応) |
| 7 | 鼻腔管モデル・鼻音 | ✅ | [PHASE7-001](tickets/PHASE7-001_nasal-tract-model.md) | `0607d88` (実装) + `27ae8d6` (レビュー対応) |
| 8 | テキスト→音素→発声 | ✅ | [PHASE8-001](tickets/PHASE8-001_text-to-speech.md) | `99a64f0` (実装) + `7265e1c` (レビュー対応) |
| 9 | テキスト読み上げUI完成 | ✅ | [PHASE9-001](tickets/PHASE9-001_text-ui-completion.md) | `3b4f1a1` (実装) + `805819d` (レビュー対応) |

### Phase 6-9 の依存関係

```
Phase 6 (子音基盤: ノイズ注入 + MIN_AREA二段化)
  → Phase 7 (鼻腔分岐管 + 3ポート接合)
    → Phase 8 (text-parser + phoneme-timeline + player)
      → Phase 9 (UI: テキスト入力 + タイムライン表示 + モード排他)
```

---

## REQUIREMENTS.md 機能要求との対応

| 機能要求 | Phase |
|---------|-------|
| 2.1 声道断面積エディタ（16制御点Canvas UI） | 1 |
| 2.2 音源 — 声門パルス（三角波→KLGLOTT88→LF） | 1→2→5 |
| 2.2 音源 — ピッチ制御（F0スライダー） | 3 |
| 2.2 音源 — ノイズ源・有声/無声切替 | 2 |
| 2.3 フィルタ（KL+壁面損失+放射フィルタ） | 1→2 |
| 2.4 母音プリセット（5母音+Flat） | 2 |
| 2.5 特殊モード（Flat / Noise） | 2 |
| 2.6 再生制御（Start/Stop・音量） | 1→3 |
| 2.7 自動歌唱モード（Auto Sing） | 4 |
| 2.8 スペクトル表示+フォルマント計算 | 3 |

---

## REQUIREMENTS_CONSONANT_TTS.md との対応

| 要件定義セクション | Phase |
|------------------|-------|
| 2.1 子音の声道断面積制御（破裂・摩擦・破擦） | 6 |
| 2.1 MIN_AREA 二段階制限（UI=0.3 / プログラム=0.01） | 6 |
| 2.2 狭窄ノイズ注入（Biquad BPF + frictionGain） | 6 |
| 2.3 鼻腔分岐管（30区間 + 3ポート接合 + velum制御） | 7 |
| 2.3 撥音「ん」異音規則 | 7→8 |
| 2.4 Worklet側サンプル精度補間（scheduleTransition） | 6 |
| 2.5 パフォーマンス要件（+25%以下、velum閉鎖時0コスト） | 6→7 |
| 3.1 ひらがな→音素変換（テーブル駆動・最長一致） | 8 |
| 3.2 音素の持続時間モデル（カテゴリ別 + 速度係数 + 文位置修正） | 8 |
| 3.3 韻律モデル（F0ルール・Declination・強度テーブル） | 8 |
| 3.4 音素タイムライン（PhonemeEvent + 再生制御） | 8 |
| 4.1 テキスト入力UI（textarea + 再生ボタン + 速度スライダー） | 9 |
| 4.2 音素タイムライン表示（横帯 + 狭窄位置マーカー） | 9 |
| 4.3 操作モード排他制御（manual / autoSing / textRead） | 9 |
| 6 非機能要件（process()予算・60fps描画・バンドルサイズ） | 6→7→8→9 |

---

## Phase 6: 子音基盤（摩擦音・破裂音）

**チケット**: [PHASE6-001_consonant-foundation.md](tickets/PHASE6-001_consonant-foundation.md)

**目標**: 声道内ノイズ注入と MIN_AREA 引き下げで摩擦音・破裂音が物理モデル経由で発声できるようにする。

### 前提条件

- Phase 5 完了（Kelly-Lochbaum 44区間モデル、KLGLOTT88/LF声門音源、壁面損失が動作中）

### 成果物

**新規ファイル**
- `src/audio/consonant-presets.ts` — 子音プリセット定義（破裂/摩擦/破擦の閉鎖位置・狭窄面積・ノイズパラメータ）

**変更ファイル**
- `src/audio/vocal-tract.ts` — 散乱ループ内で狭窄区間にバンドパスノイズ注入を追加（`f[k] += frictionGain * bandpassNoise`）。MIN_AREA を二段化（UI=0.3 / プログラム制御=0.01）。
- `src/audio/worklet-processor.ts` — 新メッセージ型 `setConstrictionNoise`（位置・強度・BPFパラメータ）と `scheduleTransition`（targetAreas + durationSamples）に対応。Worklet側で線形補間を実行。
- `src/main.ts` または `src/ui/controls.ts` — 子音手動トリガー用デモUI（/s/, /k/, /t/, /p/ ボタン）。

### 完了条件

1. /s/, /k/, /t/, /p/ の4音素を手動トリガーで発声できる
2. スペクトル表示で /s/ の高域ノイズ（5-7kHz集中）が視認できる
3. 破裂音（/k/, /t/, /p/）で閉鎖→開放の遷移がクリックノイズなしで再生される
4. process() の追加コストが要件定義 2.5 の上限内（ノイズ注入 +8 ops/sample）
5. 既存の母音プリセット・Auto Sing が退行なく動作する

### エージェントチーム

3名構成:
- **audio-dsp** — vocal-tract.ts のノイズ注入実装、Biquad BPF、MIN_AREA 二段化
- **consonant-data** — consonant-presets.ts の音素データ整備（破裂・摩擦・破擦の閉鎖位置/面積/BPFパラメータ）
- **integration-test** — worklet メッセージ拡張、scheduleTransition 補間、デモUI、スペクトル検証

### スコープ

**含むもの**
- 破裂音 /k/, /t/, /p/ + その有声版 /g/, /d/, /b/
- 摩擦音 /s/, /ɕ/, /h/, /ç/, /ɸ/ + その有声版 /z/, /dʑ/
- 破擦音 /tɕ/, /ts/, /dʑ/, /dz/
- 弾音 /ɾ/, 半母音 /j/, /w/
- Worklet 側サンプル精度線形補間

**含まないもの**
- 鼻音 /m/, /n/, /ɲ/（Phase 7）
- ひらがな→音素変換（Phase 8）
- UI 完成形（Phase 9）

### 要件定義との対応

REQUIREMENTS_CONSONANT_TTS.md のセクション:
- **2.1 子音の声道断面積制御** — 子音音素一覧表とMIN_AREA二段階制限
- **2.2 狭窄ノイズ注入** — Biquad BPF パラメータ表と GC-free 制約
- **2.4 Worklet側サンプル精度補間** — scheduleTransition メッセージ仕様
- **2.5 パフォーマンス要件** — ノイズ注入 +8 ops/sample 上限

---

## Phase 7: 鼻腔管モデル・鼻音

**チケット**: [PHASE7-001_nasal-tract-model.md](tickets/PHASE7-001_nasal-tract-model.md)

**目標**: 30区間鼻腔管 + 3ポート接合 + 口蓋帆制御を実装し、鼻音 /m/, /n/, /ɲ/ が反共鳴を含めて鳴るようにする。

### 前提条件

- Phase 6 完了（子音基盤・ノイズ注入・scheduleTransition が動作中）

### 成果物

**新規ファイル**
- `src/audio/nasal-tract.ts` — 30区間固定断面積の鼻腔管（鼻孔放射ハイパスフィルタを含む）

**変更ファイル**
- `src/audio/vocal-tract.ts` — 3ポート接合 `k = (A_p*f_p + A_o*b_o + A_n*b_n) / A_sum` を口腔・鼻腔・咽頭の合流点に追加。velum 閉鎖時は鼻腔管計算をスキップ。
- `src/audio/worklet-processor.ts` — 新メッセージ型 `setNasalCoupling`（velopharyngealArea 0.0〜2.0 cm²）に対応。
- `src/audio/consonant-presets.ts` — 鼻音 /m/, /n/, /ɲ/ プリセット追加（口腔閉鎖位置 + velum開放）。

### 完了条件

1. /m/, /n/, /ɲ/ が手動トリガーで発声できる
2. スペクトル表示で鼻音特有の反共鳴（anti-formant、500-2500Hz帯のディップ）が視認できる
3. 母音発声時（velum 閉鎖、velopharyngealArea = 0）で鼻腔管計算がスキップされ、process() コストが Phase 6 と同等
4. velum 全開時（鼻音発声中）の追加コストが要件定義 2.5 の上限内（鼻腔管 +87 ops + 3ポート接合 +6 ops = +93 ops/sample）
5. 母音→鼻音→母音の遷移がクリックノイズなく繋がる

### エージェントチーム

3名構成:
- **nasal-model** — nasal-tract.ts の30区間鼻腔管 + 鼻孔放射フィルタ実装
- **audio-integration** — vocal-tract.ts の3ポート接合実装、velum 制御、Worklet メッセージ拡張
- **test** — 鼻音プリセット追加、反共鳴スペクトル検証、velum閉鎖時パフォーマンス計測

### スコープ

**含むもの**
- 30区間固定断面積鼻腔管（長さ約12cm、ハードコード）
- 鼻孔放射ハイパスフィルタ（口腔放射と同等）
- 口腔・鼻腔・咽頭の3ポート接合
- 口蓋帆（velum）開閉制御
- 鼻音プリセット /m/, /n/, /ɲ/

**含まないもの**
- 撥音「ん」の異音切替ロジック（Phase 8 の text-parser 側で実装）
- 鼻腔副洞のモデル化
- 鼻腔断面積の動的変化

### 要件定義との対応

REQUIREMENTS_CONSONANT_TTS.md のセクション:
- **2.3 鼻腔分岐管** — 30区間 + 3ポート接合 + velum 制御テーブル
- **2.5 パフォーマンス要件** — 鼻腔管 +87 ops/sample、3ポート接合 +6 ops/sample、velum閉鎖時0コスト

---

## Phase 8: テキスト→音素→発声

**チケット**: [PHASE8-001_text-to-speech.md](tickets/PHASE8-001_text-to-speech.md)

**目標**: ひらがなテキストを音素列に変換し、音素タイムラインを生成して声道制御パイプラインに流し込むことで、プログラマブルにテキスト読み上げを実行できるようにする。

### 前提条件

- Phase 6 完了（子音基盤）
- Phase 7 完了（鼻腔管・鼻音）

### 成果物

**新規ファイル**
- `src/text/text-parser.ts` — ひらがな→音素変換テーブル（約110エントリ）+ 最長一致パーサー（2文字優先→1文字fallback）
- `src/text/phoneme-timeline.ts` — `PhonemeEvent[]` ジェネレータ（音素持続時間モデル + 韻律F0ルール + 強度テーブル + 文位置修正）
- `src/text/phoneme-player.ts` — AudioContext.currentTime 基準のクロックで PhonemeEvent を順次再生（声道形状の scheduleTransition、声門パラメータ更新、ノイズ注入、velum 制御を協調）

**変更ファイル**
- `src/audio/consonant-presets.ts` — Phase 6/7 で未追加だった補完音素（拗音派生、特殊拍 /Q/, /ɴ/ など）を追加
- `src/main.ts` — `play(text: string)` のプログラマブル呼び出し口を追加（UI は Phase 9）

### 完了条件

1. `play("こんにちは")` で /k,o,ɴ,n,i,tɕ,i,w,a/ が連続発声される
2. `play("さくら")` で /s,a,k,u,ɾ,a/ が遷移クリックなしで再生される
3. 撥音「ん」が後続音素に応じて [m]/[n]/[ŋ]/[ɴ] に切り替わる
4. 文末下降（最終2-3モーラで F0 が 140→80Hz に下降）が動作する
5. 速度係数 0.5x〜2.0x で全音素の持続時間が比例変化する
6. 句点・読点でポーズが挿入される

### エージェントチーム

4名構成:
- **text-parser** — ひらがな→音素変換テーブル + 最長一致パーサー + 拗音/濁音/半濁音/特殊拍対応
- **timeline** — PhonemeEvent ジェネレータ、持続時間モデル、F0 韻律ルール（Declination含む）、強度テーブル
- **player** — AudioContext クロックベース再生エンジン、scheduleTransition 協調、声門パラメータ・velum・ノイズ更新
- **integration** — consonant-presets.ts 補完、`play()` API、5音素以上の連続発声検証

### スコープ

**含むもの**
- 全ひらがな（清音46字 + 濁音20字 + 半濁音5字 + 拗音36組 + 特殊拍3字）
- ひらがな→音素変換（テーブル駆動・最長一致）
- 音素持続時間モデル + 速度係数 + 文位置修正
- F0 韻律（平板型ルール + 文末下降 + Declination + 疑問文）
- 強度テーブル
- PhonemeEvent タイムライン + 再生/停止/一時停止/シーク
- 撥音「ん」異音切替

**含まないもの**
- カタカナ・漢字対応
- 形態素解析・アクセント辞書
- 多様なアクセント型（頭高型・中高型・尾高型）
- UI（Phase 9）

### 要件定義との対応

REQUIREMENTS_CONSONANT_TTS.md のセクション:
- **3.1 ひらがな→音素変換** — テーブル駆動、最長一致、変換例
- **3.2 音素の持続時間モデル** — カテゴリ別持続時間 + 速度係数 + 文位置修正
- **3.3 韻律モデル** — F0制御ルール、強度テーブル、Declination
- **3.4 音素タイムライン** — PhonemeEvent インタフェース、再生制御
- **2.3 撥音「ん」異音規則** — 後続音素に応じた [m]/[n]/[ŋ]/[ɴ] 切替

---

## Phase 9: テキスト読み上げUI完成

**チケット**: [PHASE9-001_text-ui-completion.md](tickets/PHASE9-001_text-ui-completion.md)

**目標**: ひらがなテキスト入力 → 再生ボタン → タイムライン表示 → 声道エディタ自動アニメーションの完成形 UI を実装し、3つの操作モードを排他制御する。

### 前提条件

- Phase 6 完了（子音基盤）
- Phase 7 完了（鼻腔管・鼻音）
- Phase 8 完了（text-parser + phoneme-timeline + player）

### 成果物

**変更ファイル**
- `index.html` — テキスト入力 textarea (`#text-input`)、再生ボタン (`#text-read-btn`)、速度スライダー (`#speech-rate-slider`)、音素タイムライン Canvas (`#phoneme-timeline-canvas`) を追加
- `src/style.css` — テキスト読み上げUI セクションのスタイル（textarea, タイムライン横帯, ハイライト, 狭窄位置マーカー）
- `src/ui/controls.ts` — `OperationMode` 状態（`'manual' | 'autoSing' | 'textRead'`）導入、3モードの排他制御ロジック、テキスト読み上げ中の声道ドラッグ/母音プリセット/F0スライダー無効化、Auto Sing と textRead の相互排他
- `src/main.ts` — phoneme-player のイベントハンドラから声道エディタを自動アニメーション、タイムライン Canvas を再描画、テキスト再生の状態管理を engine.ts と統合
- `src/ui/timeline-canvas.ts`（新規） — 音素持続時間比例の横帯描画、再生中音素のハイライト、声道エディタ上の狭窄位置マーカー描画

### 完了条件

1. textarea にひらがなを入力 → 再生ボタンで読み上げが開始される
2. 再生中、音素タイムラインで現在の音素がハイライトされる
3. 再生中、声道エディタが音素タイムラインに従って自動アニメーションする
4. 子音発声時、声道エディタ上に狭窄位置マーカーが表示される
5. 速度スライダー (0.5x-2.0x) で再生速度が変化する
6. 3モード排他制御:
   - manual モードで Auto Sing 起動 → 母音プリセット・声道ドラッグ無効化
   - manual モードでテキスト再生 → Auto Sing ボタン・F0/Vol/Rd スライダー無効化
   - textRead と autoSing は同時起動不可
7. テキスト再生中に「停止」ボタンで即座に発声停止
8. 既存の母音プリセット・Auto Sing が退行なく動作する
9. テキスト再生開始→発声のレイテンシ < 50ms（要件定義 6）
10. メインスレッドの Canvas + タイムライン更新が 16ms (60fps) 以内

### エージェントチーム

4名構成:
- **ui** — index.html / style.css / timeline-canvas.ts、テキスト入力UI、タイムライン横帯描画、狭窄位置マーカー
- **state-management** — controls.ts の OperationMode 導入、3モード排他制御、UI要素の enable/disable ロジック
- **integration** — main.ts での phoneme-player と声道エディタ・タイムライン Canvas の連携、engine.ts との状態統合
- **test** — 全ひらがな発声検証、3モード遷移テスト、レイテンシ計測、60fps 描画検証

### スコープ

**含むもの**
- テキスト入力 UI（textarea + 再生ボタン + 速度スライダー）
- 音素タイムライン表示（横帯 + 再生中ハイライト）
- 声道エディタ上の狭窄位置マーカー
- 再生中の声道エディタ自動アニメーション
- OperationMode 排他制御（manual / autoSing / textRead）
- テキスト読み上げ開始/停止 UI

**含まないもの**
- カタカナ・漢字入力 UI
- 韻律パラメータの UI 編集（アクセント型選択など）
- 録音・エクスポート機能
- 音素タイムラインの手動編集（クリック→音素挿入など）

### 要件定義との対応

REQUIREMENTS_CONSONANT_TTS.md のセクション:
- **4.1 テキスト入力UI** — textarea / 再生ボタン / 速度スライダー の DOM 仕様
- **4.2 音素タイムライン表示** — 横帯 + ハイライト + 狭窄位置マーカー
- **4.3 操作モードの排他制御** — OperationMode 型と UI 要素 enable/disable 表
- **6 非機能要件** — process() 予算、60fps 描画、レイテンシ < 50ms、既存非退行
