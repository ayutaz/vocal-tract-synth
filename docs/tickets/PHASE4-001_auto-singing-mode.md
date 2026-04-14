# PHASE4-001: 自動歌唱モード実装

**フェーズ**: Phase 4 — 歌える
**マイルストーン**: [Phase 4](../MILESTONES.md#phase-4-自動歌唱モード--歌える)
**状態**: ✅ 完了
**前提条件**: Phase 3 完了（[PHASE3-001](PHASE3-001_spectrum-formant-pitch.md)）
**成果物**: Auto Sing モード + ビブラート + 揺らぎ + フレーズ構造

---

## 1. タスク目的とゴール

<!-- REVIEW: プロジェクト管理レビューにて修正 — 誤字修正「聞こせる」→「聞こえさせる」 -->
自動的に母音とピッチを遷移させて「歌っている」ように聞こえさせるモードを実装する。

Phase 3 までに構築された声道合成パイプライン（44区間Kelly-Lochbaum + KLGLOTT88音源 + スペクトル/フォルマント表示 + F0制御）の上に、メロディ生成・母音遷移・表現パラメータ（ビブラート、ポルタメント、ジッター、シマー）・リズム/フレーズ構造を統合し、ユーザーが「Auto Sing」ボタンを押すだけで音楽的に自然な自動歌唱が鳴り続ける状態にする。

### 完了条件

- Auto Singボタンをオンにすると、母音が自動で遷移しピッチが音階上を移動する
- ビブラート・ポルタメントが聴覚的に確認できる
- フレーズ間に自然な休符（ブレス）が入る
- 速度スライダーでBPMを変更でき、リアルタイムに反映される
- Auto Singをオフにすると即座に自動遷移が停止し、手動操作に復帰する
- 全体として「歌っている」ように聞こえる（成功基準: REQUIREMENTS.md 8項）

---

## 2. 実装する内容の詳細

### 2.1 母音遷移エンジン

| 項目 | 仕様 |
|------|------|
<!-- REVIEW: Phase間整合性レビューにて注記追加 — Phase 2 の TransitionManager（コサイン補間、transitionTo API）を再利用。遷移時間の動的計算のみ Phase 4 で追加 -->
| 補間方式 | Phase 2 の TransitionManager を利用（コサイン補間 実装済み） |
| 遷移時間 | 80-200ms（母音間のF1-F2距離に比例）— `TransitionManager.transitionTo(id, durationMs)` で指定 |
| 対象 | 16制御点の断面積値を母音プリセット間で補間 |
| 母音選択 | 5母音（あいうえお）からランダム選択（連続同母音を回避） |

遷移時間の計算式:

```
distance = sqrt((F1_target - F1_current)^2 + (F2_target - F2_current)^2)
max_distance = sqrt((800-300)^2 + (2300-800)^2)  // /a/→/i/ 間の距離
transition_ms = 80 + (200 - 80) * (distance / max_distance)
```

補間中は16制御点の断面積を個別にコサイン補間し、44区間へスプライン補間してpostMessageで送信する。

<!-- REVIEW: アーキテクチャレビューにて修正 — 母音遷移中の postMessage 送信頻度とボトルネックリスクを明記。 -->
**postMessage 送信頻度の制御**: 母音遷移中、rAF (60fps) ごとに断面積配列 (Float64Array(44) = 352bytes) を postMessage で送信する。構造化クローンのコストは微小だが、Phase 5 のパフォーマンス最適化セクションで定義された throttle (最大60回/秒) と整合させる。遷移が完了した（断面積が変化していない）フレームでは送信をスキップする dirty フラグチェックを実装すること。これにより、遷移完了後の不要な postMessage を排除する。

### 2.2 ピッチ生成

| 項目 | 仕様 |
|------|------|
| 音階 | ペンタトニック（デフォルト: C4ベース、C-D-E-G-A） |
| 音域 | 1-1.5オクターブ（C3-G4 付近、基準F0 = 130-392Hz） |
| F0制御 | AudioParam (k-rate) 経由 |
| 補間空間 | 対数空間（知覚的に均一な遷移） |

ペンタトニック音階のMIDIノート番号テーブル（1.5オクターブ分）:

```typescript
const PENTATONIC_NOTES = [
  48, 50, 52, 55, 57,  // C3, D3, E3, G3, A3
  60, 62, 64, 67, 69,  // C4, D4, E4, G4, A4
  72, 74, 76            // C5, D5, E5
];
```

### 2.3 メロディ生成（1次マルコフ連鎖 + 音楽理論ルール）

**マルコフ連鎖**: 現在の音高から次の音高への遷移確率テーブルを使用。

**音楽理論ルール制約**:

| ルール | 制約内容 |
|--------|---------|
| 跳躍幅制限 | 最大完全5度（7半音）。それを超える遷移確率を0にする |
| 大跳躍後反進行 | 4半音以上の跳躍後、次の遷移は跳躍と逆方向に制限 |
| フレーズ末収束 | フレーズ最後の1-2音は主音（ペンタのルート）または5度音に収束 |
| 順次進行優先 | 2度進行（隣接音）の確率を高く設定（50-60%） |

遷移確率の調整:

```typescript
// 基本確率テーブル（半音差に基づく）
const BASE_PROBABILITY: Record<number, number> = {
  0: 0.05,   // 同音反復
  1: 0.15,   // 短2度 (半音)
  2: 0.25,   // 長2度 (ペンタでは主要な順次進行)
  3: 0.20,   // 短3度
  4: 0.10,   // 長3度
  5: 0.10,   // 完全4度
  7: 0.10,   // 完全5度
  // 7半音超: 0.00 (禁止)
};
```

### 2.4 ビブラート

| パラメータ | 値 |
|-----------|-----|
| 周波数 | 5.5Hz（正弦波） |
| 深さ | +-30cent（半音の約1/3） |
| 波形 | 正弦波 (`sin(2 * pi * 5.5 * t)`) |
| ディレイ | ノート開始から200ms後に開始（急に揺れない自然さ） |
| エンベロープ | ディレイ後100msでフェードイン |

F0への適用:

```
vibrato_factor = depth_cent * sin(2 * pi * rate * t)
F0_with_vibrato = F0_base * 2^(vibrato_factor / 1200)
```

### 2.5 ポルタメント

| パラメータ | 値 |
|-----------|-----|
| 遷移時間 | 50-200ms（跳躍幅に比例） |
| 適用確率 | 60-70%（残りはピッチ即時切替） |
| 補間 | 対数空間でのコサイン補間 |

ポルタメント時間の計算:

```
semitone_distance = abs(midi_target - midi_current)
portamento_ms = 50 + (200 - 50) * (semitone_distance / 7)
```

### 2.6 リズム生成

| パラメータ | 値 |
|-----------|-----|
| BPM範囲 | 40-200 BPM（スライダーで調整） |
| デフォルトBPM | 120 BPM |

**音符長の確率分布**:

| 音符 | 確率 | 拍数(4/4) |
|------|------|----------|
| 8分音符 | 40% | 0.5拍 |
| 4分音符 | 30% | 1.0拍 |
| 付点8分音符 | 15% | 0.75拍 |
| 16分音符 | 10% | 0.25拍 |
| 2分音符 | 5% | 2.0拍 |

**マイクロタイミング**: 各ノートの発音タイミングに+-5-15msのランダム揺らぎを加算。揺らぎ量はBPMに連動しない固定値。

### 2.7 フレーズ構造

| パラメータ | 値 |
|-----------|-----|
| フレーズ長 | 4-8拍（ランダム、偶数拍やや優先） |
| フレーズ間休符 | 0.5-1拍 |
| ブレスシミュレーション | 100-300ms（休符冒頭にF0を急降下させ、声門振幅を0にフェードアウト） |

ブレスのシーケンス:

```
1. フレーズ末: 50ms で振幅フェードアウト
2. 休符開始: 声門振幅 = 0 (無音)
3. 休符末 100-300ms前: ブレスノイズ (AN を微小に)
4. 次フレーズ開始: 30ms で振幅フェードイン
```

### 2.8 音量制御

**ノート単位 ADSR**:

| パラメータ | 値 |
|-----------|-----|
| Attack | 20-40ms |
| Decay | 50-100ms |
| Sustain | 0.7-0.85 |
| Release | 30-60ms |

**フレーズ単位アーチ型カーブ**: フレーズ全体にかかる緩やかなダイナミクスカーブ。フレーズの60-70%地点でピーク、フレーズ末に向かって減衰。

```
phrase_envelope = sin(pi * phrase_progress)^0.7
```

### 2.9 ジッター / シマー

| パラメータ | 範囲 | 適用先 |
|-----------|------|--------|
| ジッター | F0に0.5-1.5%のランダム変動 | 毎周期のF0 |
| シマー | 振幅に0.5-2.0%のランダム変動 | 毎周期の声門振幅 |

ジッター/シマーはAudioWorklet内（`worklet-processor.ts`）の声門音源生成部分で適用する。Phase 3 までの実装でジッター/シマーの枠が未実装であれば、このフェーズでAudioWorkletに追加パラメータとして組み込む。

```
F0_jittered = F0 * (1 + jitter_amount * (Math.random() * 2 - 1))
amplitude_shimmered = amplitude * (1 + shimmer_amount * (Math.random() * 2 - 1))
```

### 2.10 UI要素

| UI要素 | タイプ | 仕様 |
|--------|-------|------|
| Auto Singボタン | トグルボタン | ON/OFF切替、ON時に視覚的フィードバック（色変化） |
| 速度スライダー | `<input type="range">` | 40-200 BPM、デフォルト120、リアルタイム反映 |

ボタン/スライダーは既存の操作パネル領域（REQUIREMENTS.md 4項の画面構成に準拠）に配置:

```
[Start/Stop]  [Auto Sing]  速度: [=========>]  ピッチ: [=========>]
```

Auto Sing中も手動のピッチスライダーは無効化せず、Autoの基準F0として機能する。

<!-- REVIEW: アーキテクチャレビューにて修正 — Auto Sing 中の手動操作との競合解決ルールを明示。 -->
**Auto Sing中の手動操作との競合解決ルール**:
- **ピッチスライダー**: Auto Sing はスライダーの値を基準F0とし、メロディの音程差を加算する。スライダー操作は即座に反映される（競合なし、合算方式）。
- **声道ドラッグ**: Auto Sing 中は制御点のドラッグを **無効化する**。理由: Auto Singer が母音遷移で断面積配列を毎フレーム上書きするため、手動操作の結果が即座に上書きされてユーザーの操作感が破綻する。Canvas上の制御点はAuto遷移に連動してアニメーションするが、ドラッグ不可の視覚的フィードバック（カーソル変更、制御点の色変更等）を提供する。
- **母音プリセットボタン**: Auto Sing 中は無効化する（Auto Singer が母音選択を管理するため）。
- **Auto Sing 停止時**: 最後にAutoが設定した断面積配列をそのまま保持し、手動操作可能状態に復帰する。

---

## 3. 実装に必要なエージェントチームの役割と人数

6エージェント体制で実装する。各エージェントは独立したモジュールを担当し、明確なインターフェースで接続する。

### 3.1 melody-generator（メロディ生成エージェント）

**担当ファイル**: `src/ui/auto-singer/melody-generator.ts`

**責務**:
- ペンタトニック音階テーブルの定義
- 1次マルコフ連鎖遷移確率テーブルの構築
- 音楽理論ルール制約の実装（跳躍幅制限、大跳躍後反進行、フレーズ末収束）
- 次の音高（MIDIノート番号）を生成するAPI

**出力インターフェース**:
```typescript
interface MelodyEvent {
  midiNote: number;       // MIDIノート番号
  frequency: number;      // Hz
  intervalFromPrev: number; // 前の音からの半音数（符号付き）
}
```

### 3.2 vowel-sequencer（母音遷移エージェント）

**担当ファイル**: `src/ui/auto-singer/vowel-sequencer.ts`

<!-- REVIEW: Phase間整合性レビューにて修正 — Phase 2 セクション7.3 で TransitionManager API（transitionTo/transitionToCustom/isTransitioning/getCurrentControlPoints）が Phase 4 向けに公開されている。vowel-sequencer はコサイン補間を再実装するのではなく、Phase 2 の TransitionManager を利用すべき -->
**責務**:
- 次の母音をランダム選択（連続同母音回避）
- F1-F2距離に基づく遷移時間の計算
- Phase 2 の `TransitionManager.transitionTo(targetPresetId, durationMs)` を呼び出して母音遷移を実行
- `TransitionManager.isTransitioning()` で遷移完了を監視

**出力インターフェース**:
```typescript
interface VowelTransition {
  targetVowel: VowelType;           // 'a' | 'i' | 'u' | 'e' | 'o'
  controlPoints: Float64Array;      // 16要素
  transitionProgress: number;       // 0.0-1.0
  transitionDurationMs: number;
}
```

### 3.3 expression-engine（表現エンジンエージェント）

**担当ファイル**: `src/ui/auto-singer/expression-engine.ts`

**責務**:
- ビブラート生成（5.5Hz / +-30cent / 200msディレイ / フェードイン）
- ポルタメント制御（50-200ms / 60-70%確率）
- ジッターパラメータ計算（0.5-1.5%）
- シマーパラメータ計算（0.5-2.0%）
- 上記を合算した最終F0と振幅の算出

**出力インターフェース**:
```typescript
interface ExpressionOutput {
  f0Modifier: number;       // F0に乗算する係数（ビブラート + ポルタメント）
  amplitudeModifier: number; // 振幅に乗算する係数
  jitterAmount: number;      // AudioWorkletに送るジッター量
  shimmerAmount: number;     // AudioWorkletに送るシマー量
}
```

### 3.4 rhythm-engine（リズムエンジンエージェント）

**担当ファイル**: `src/ui/auto-singer/rhythm-engine.ts`

**責務**:
- BPMから拍の時間長を計算
- 音符長の確率分布に基づく次のノート長の決定
- マイクロタイミング揺らぎの計算（+-5-15ms）
- 次のノートの発音タイミングをスケジューリング

**出力インターフェース**:
```typescript
interface RhythmEvent {
  durationMs: number;         // 音符の長さ (ms)
  durationBeats: number;      // 音符の長さ (拍)
  microTimingOffsetMs: number; // マイクロタイミング揺らぎ (ms)
  noteType: string;           // '16th' | '8th' | 'dotted8th' | 'quarter' | 'half'
}
```

### 3.5 phrase-manager（フレーズ管理エージェント）

**担当ファイル**: `src/ui/auto-singer/phrase-manager.ts`

**責務**:
- フレーズ長の決定（4-8拍）
- フレーズ内の拍位置の追跡
- フレーズ間休符の挿入（0.5-1拍）
- ブレスシミュレーション（100-300ms）
- ノート単位ADSR計算
- フレーズ単位アーチ型音量カーブ計算
- 他エンジンへの「フレーズ末接近」通知（melody-generatorのフレーズ末収束に使用）

**出力インターフェース**:
```typescript
interface PhraseState {
  isResting: boolean;           // 休符中か
  phraseProgress: number;       // フレーズ内の進行度 (0.0-1.0)
  noteEnvelope: number;         // ノート単位ADSRの現在値 (0.0-1.0)
  phraseEnvelope: number;       // フレーズ単位カーブの現在値 (0.0-1.0)
  isApproachingPhraseEnd: boolean; // フレーズ末2音以内か
  breathProgress: number;       // ブレス進行度 (0.0-1.0, 非ブレス時は0)
}
```

### 3.6 ui-auto（UI制御エージェント）

**担当ファイル**: `src/ui/auto-singer/ui-controls.ts` + `src/ui/auto-singer/index.ts`（統合コーディネータ）

**責務**:
- Auto Singトグルボタンの実装（DOM生成、イベントリスナー）
- 速度スライダーの実装（40-200 BPM）
- 自動歌唱ループの起動/停止制御
- 各エンジンの統合コーディネーション（`index.ts`）
- メインスレッドのタイミングループ管理
- 既存UIとの統合（`src/ui/controls.ts` との連携）

**統合コーディネータ (`index.ts`) の責務**:

<!-- REVIEW: アーキテクチャレビューにて修正 — タイミング管理を lookahead scheduling 方式に変更。
rAF のみでは 16.7ms 精度であり、16分音符@200BPM=75ms に対して約 22% のジッターが生じる。
また rAF はバックグラウンドタブで停止するため、タブ切替時に暴走・大量イベント一括発火のリスクがある。
Chris Wilson "A Tale of Two Clocks" パターンに基づき、以下の 2 系統構成に変更:
  1. setInterval(25ms) + AudioContext.currentTime ベースの lookahead (100ms先まで) でノートイベントをスケジュール
  2. rAF は描画更新（母音補間アニメーション、Canvas同期）のみに使用
F0 のポルタメント/ビブラートは AudioParam.setValueAtTime / linearRampToValueAtTime を
lookahead 窓内で発行し、メインスレッドのタイミングジッターの影響を受けないようにする。 -->

```typescript
// 自動歌唱ループ: 2系統構成の疑似コード

// 系統1: タイミングスケジューラ (setInterval 25ms)
// ノートイベントの発行とAudioParam操作を担当
const LOOKAHEAD_SEC = 0.1;  // 100ms先までスケジュール
const INTERVAL_MS = 25;

function schedulerTick() {
  if (!isAutoSingActive) return;
  const currentTime = audioContext.currentTime;
  const scheduleUntil = currentTime + LOOKAHEAD_SEC;

  while (nextNoteTime < scheduleUntil) {
    const phraseState = phraseManager.update(nextNoteTime);

    if (phraseState.isResting) {
      applyBreath(phraseState, nextNoteTime);
    } else {
      const rhythm = rhythmEngine.nextNote(bpm);
      const melody = melodyGenerator.nextNote(phraseState);
      const vowel = vowelSequencer.nextVowel();

      // AudioParam に正確なタイムスタンプでスケジュール
      scheduleNote(melody, rhythm, vowel, nextNoteTime);
    }

    nextNoteTime += rhythm.durationMs / 1000;
  }
}

let schedulerInterval: number | null = null;
function startScheduler() {
  schedulerInterval = setInterval(schedulerTick, INTERVAL_MS);
}
function stopScheduler() {
  if (schedulerInterval !== null) clearInterval(schedulerInterval);
  schedulerInterval = null;
}

// 系統2: 描画更新 (rAF)
// 母音補間アニメーション、Canvas同期を担当
function renderLoop(timestamp: number) {
  if (!isAutoSingActive) return;

  const expression = expressionEngine.update(deltaTime, currentNote);
  applyExpression(expression);
  vowelSequencer.updateInterpolation(deltaTime);

  requestAnimationFrame(renderLoop);
}
```

> **注意**: `scheduleNote()` 内で F0 のポルタメント/ビブラートは `AudioParam.linearRampToValueAtTime(value, nextNoteTime)` で発行する。断面積配列の postMessage はスケジュール時刻と紐付けて送信し、AudioWorklet 側で `currentTime` に基づいてバッファ切替を行う。

---

## 4. 提供範囲とテスト項目

### 4.1 スコープ内

- 母音遷移エンジン（コサイン補間、5母音プリセット間の自動遷移）
- ペンタトニック音階ベースのメロディ生成（マルコフ連鎖 + 音楽理論制約）
- ビブラート（5.5Hz / +-30cent / ディレイ付き）
- ポルタメント（確率的適用）
- リズム生成（BPMベース、音符長確率分布、マイクロタイミング）
- フレーズ構造（4-8拍、休符、ブレスシミュレーション）
- ノート単位ADSR + フレーズ単位音量カーブ
- ジッター / シマー（AudioWorkletへのパラメータ追加含む）
- Auto Singトグルボタン + 速度スライダーUI
- 既存のStart/Stop、ピッチスライダー、母音プリセットボタンとの共存

### 4.2 スコープ外

- 歌詞テキスト入力からの音素列生成（Phase 5以降の拡張検討事項）
- 子音の生成（ノイズバースト等）
- 外部MIDI/OSC入力による制御（将来拡張として設計は考慮）
- ペンタトニック以外の音階選択UI（内部的には拡張可能に設計するが、UIは出さない）
- 録音/エクスポート機能
- ユーザーによるマルコフ遷移確率のカスタマイズUI
- 複数声部（ポリフォニー）

### 4.3 ユニットテスト

<!-- REVIEW: テスト戦略レビューにて修正 — 乱数シード固定テスト方針・BPM境界値テスト・ポルタメント計算テスト・ADSR値域テスト・パフォーマンステストを追加、成功基準トレーサビリティを付与 -->

#### テスト方針: 確率的モジュールの決定的テスト
- 乱数を使用するモジュール（マルコフ連鎖、リズム、ポルタメント確率）は、乱数生成器を注入可能な設計（Dependency Injection）にし、テスト時はシード固定の擬似乱数を使用して再現性を確保する
- 統計的テスト（出現頻度、確率分布）は十分な試行回数（1000回以上）で検証

#### マルコフ連鎖の制約テスト

```
- [ ] 生成される全ての音高がペンタトニック音階上にある
- [ ] 連続する2音の間隔が7半音（完全5度）を超えない
- [ ] 4半音以上の跳躍の直後、次の遷移が跳躍と逆方向である
- [ ] フレーズ末フラグが立った状態で生成される音がルートまたは5度音である
- [ ] 遷移確率の合計が1.0になる（正規化の検証）
- [ ] 1000回生成して各音高の出現頻度が偏りすぎない（カイ二乗検定的な確認）
- [ ] 全ての遷移確率が0.0以上1.0以下であること（境界値）
- [ ] 遷移確率テーブルの行和が1.0±1e-10であること
```

#### コサイン補間の値域テスト

```
- [ ] t=0.0 のとき補間結果が開始値と一致する
- [ ] t=1.0 のとき補間結果が終了値と一致する
- [ ] 0 < t < 1 のとき補間結果が開始値と終了値の間にある
- [ ] 16制御点全てが断面積の有効範囲内（0.3-10.0 cm²）に収まる
- [ ] 遷移時間がF1-F2距離に比例して80-200msの範囲内である
```

#### ビブラートのテスト

```
- [ ] ビブラート周波数が5.5Hz（許容誤差+-0.1Hz）
- [ ] ビブラート深さが+-30cent以内
- [ ] ノート開始から200ms以内はビブラートが0
- [ ] 200ms以降100msかけてフェードインする
- [ ] ビブラートのF0変調係数が理論値と一致する (2^(cent/1200))
```

#### リズムエンジンのテスト

```
- [ ] 音符長確率分布が指定通り（8分40%/4分30%/付点8分15%/16分10%/2分5%）
- [ ] BPM変更時に音符の実時間長が正しく変化する
- [ ] マイクロタイミング揺らぎが+-15ms以内
- [ ] BPM=40（最小値）で音符の実時間長が正しいこと（4分音符=1500ms）
- [ ] BPM=200（最大値）で音符の実時間長が正しいこと（4分音符=300ms）
- [ ] BPMを0以下に設定した場合のガード処理（クランプまたはエラー）
```

#### ポルタメントのテスト

```
- [ ] ポルタメント時間が50-200msの範囲内であること
- [ ] 半音距離に比例してポルタメント時間が増加すること
- [ ] ポルタメント中のF0が対数空間で補間されていること（知覚的に均一）
- [ ] 適用確率が60-70%付近であること（1000回試行で統計的に検証）
```

#### フレーズ構造のテスト

```
- [ ] フレーズ長が4-8拍の範囲内
- [ ] フレーズ間に0.5-1拍の休符が挿入される
- [ ] ADSR各段階の時間が仕様範囲内
- [ ] フレーズアーチカーブの最大値が0.6-0.7地点付近にある
- [ ] ADSRエンベロープの出力が常に0.0-1.0の範囲内であること（境界値）
- [ ] ノート単位ADSRとフレーズ単位カーブの乗算結果が0.0-1.0の範囲内であること
```

#### パフォーマンステスト — メインスレッド負荷

```
- [ ] 自動歌唱ループ1フレームの計算時間がp95で2ms以下であること
      （母音補間 + メロディ生成 + リズム計算 + ビブラート + ポルタメント + ADSR + スプライン補間）
- [ ] 16.7ms（60fps予算）内に描画更新 + パラメータ送信が完了すること
成功基準カバレッジ: → REQUIREMENTS.md 8項「低レイテンシに動作する」
```

### 4.4 E2Eテスト

<!-- REVIEW: テスト戦略レビューにて修正 — 自動化可能/手動確認の分離、「歌っているように聞こえる」の客観的検証方法を追記、リグレッションチェック追加 -->

#### テスト自動化方針
- **「歌っている」の客観的検証**: F0の時系列データを記録し、(1)ペンタトニック音階上の離散的な値に近い定常区間がある、(2)定常区間間にポルタメント的な連続変化区間がある、(3)定常区間内にビブラート的な周期変動がある、を数値的に検証する。「歌っているように聞こえる」を「音楽的パラメータが仕様通り動作している」に分解する
- **断面積配列の時間変化**: page.evaluate() 内で postMessage の送信内容をフック/記録し、断面積配列が5母音のプリセットパターンの間で遷移していることを検証

#### 自動化可能なテスト（Playwright）
```
- [ ] Auto Singボタンを押す → 3秒間でF0の値が複数回変化する（page.evaluate内でAudioParamの値を定期取得）
- [ ] Auto Sing中 → F0の定常区間値がペンタトニック音階の周波数に近い（±5%以内）
- [ ] Auto Sing中 → F0にビブラート的な周期変動がある（FFTで5-6Hz付近にピーク）
- [ ] 速度スライダーをpage.fill()で40BPMに設定 → ノート間隔が1秒以上
- [ ] 速度スライダーをpage.fill()で200BPMに設定 → ノート間隔が0.3秒以下
- [ ] Auto Singボタンをオフにする → F0の変化が停止する
- [ ] Auto Sing停止後 → 母音プリセットボタンのクリックが正常に機能する
- [ ] Start/Stop → Auto Sing → Start/Stop の順で操作してもクラッシュしない
- [ ] Auto Sing 30秒間連続動作でメモリ使用量が単調増加しないこと（GCリークなし）
```
- **成功基準カバレッジ**: → REQUIREMENTS.md 8項「自動モードで母音とピッチがランダムに遷移し『歌っている』ように聞こえる」

#### 手動確認チェックリスト（聴覚・主観評価が必要な項目）
```
- [ ] Auto Sing中 → ビブラートが聞こえる（知覚確認）
- [ ] Auto Sing中 → フレーズ間で自然な休符（ブレス）が聞こえる
- [ ] Auto Sing中 → スペクトル表示が自動遷移に追従している（視覚確認）
- [ ] 全体として「歌っている」ように聞こえる（30秒以上の連続再生で評価）
- [ ] メロディが単調すぎないか、無秩序すぎないかの主観評価
```

#### Phase 1-3 リグレッションチェック
- **Phase 1-3 の全ユニットテストがPhase 4コード統合後もパスすること**
- **Auto Sing OFF状態での手動操作（ドラッグ、プリセット、F0スライダー）がPhase 3と同等に機能すること**
- **スペクトル表示・フォルマント計算がAutoモード中も正常に動作すること**

---

## 5. 実装に関する懸念事項とレビュー項目

### 5.1 メインスレッドのタイミング精度

**懸念**: 自動歌唱のタイミング制御にrequestAnimationFrame（rAF）を使う場合、16.7ms（60fps）の精度であり、16分音符 @ 200BPM = 75msに対して約22%の誤差が生じうる。またタブがバックグラウンドに回るとrAFが停止する。

<!-- REVIEW: アーキテクチャレビューにて修正 — 対策を「案」から確定設計に昇格。セクション3.6の疑似コードと整合。 -->
**確定設計: lookahead scheduling (2系統構成)**:
- **系統1 (タイミング)**: `setInterval(25ms)` + `AudioContext.currentTime` ベースの lookahead (100ms先まで) でノートイベントをスケジュール。F0 のポルタメント/ビブラートは `AudioParam.setValueAtTime` / `linearRampToValueAtTime` を lookahead 窓内で発行し、メインスレッドのジッターを吸収する。
- **系統2 (描画)**: `requestAnimationFrame` は描画更新（母音補間アニメーション、Canvas同期）のみに使用。
- **バックグラウンドタブ**: rAF は停止するが setInterval はスロットリングされる（Chrome では最低 1 秒間隔）。タブ復帰時にスケジューラが一括でイベントを発行しないよう、`nextNoteTime < currentTime` の場合はスキップして現在時刻にリセットする。

**レビュー項目**:
- [ ] タイミングのジッターが音楽的に許容範囲か（録音して波形確認）
- [ ] setInterval のコールバック内でオブジェクト生成を最小化しているか
- [ ] バックグラウンドタブからの復帰時に nextNoteTime のリセットが正しく動作するか
- [ ] lookahead 窓 (100ms) が postMessage のレイテンシ (~3ms) に対して十分か

### 5.2 音楽的な自然さ

**懸念**: マルコフ連鎖のパラメータ調整は試行錯誤が必要。遷移確率テーブルの値次第で「機械的」「単調」「無秩序」のどこかに偏る。

**対策案**:
- 遷移確率テーブルを定数として外部に切り出し、調整しやすくする
- 複数のプリセットテーブル（「穏やか」「活発」「シンプル」等）を用意する
- console.log で生成されたメロディを出力し、デバッグ時に確認できるようにする

**レビュー項目**:
- [ ] 30秒以上連続再生して不自然なパターンの繰り返しが起きないか
- [ ] フレーズ末の収束が音楽的に自然に聞こえるか
- [ ] ビブラートの深さ/速度が過剰/不足でないか（実際に聴いて確認）

### 5.3 CPU負荷

**懸念**: メインスレッドで同時に動作する計算が多い。母音補間 + メロディ生成 + リズム計算 + ビブラート + ポルタメント + ADSR + フレーズカーブ + コサイン補間 + スプライン補間（16→44点）。

**対策案**:
- ビブラート・ポルタメントの計算は軽量（sin計算 + 乗算のみ）
- 重い処理（マルコフ選択、母音選択）はノート切替時のみ（数百ms-数秒に1回）
- 毎フレームの処理は補間の進捗更新とパラメータ送信のみに限定する
- プロファイリングで16.7msの描画予算を超えないことを確認

**レビュー項目**:
- [ ] Chrome DevTools Performanceで自動歌唱中のフレーム落ちがないか
- [ ] AudioWorkletのprocess()内に新たなアロケーションを追加していないか
- [ ] postMessageの送信頻度が適切か（毎フレーム送信 vs 変更時のみ送信）

### 5.4 母音遷移と音声合成のタイミング同期

**懸念**: メインスレッドの母音遷移（postMessage送信）とAudioWorkletの音声生成の間にはレイテンシがある。ノート開始時のピッチ変化（AudioParam）と母音変化（postMessage）がずれると不自然に聞こえる。

**対策案**:
- F0変更（AudioParam.setTargetAtTime）と断面積変更（postMessage）をなるべく同一フレーム内で発行する
- postMessageの遅延はレンダリングクォンタム（2.9ms）程度なので実用上は許容範囲
- 遷移開始時の同期をpostMessageのタイムスタンプで検証する

**レビュー項目**:
- [ ] ピッチ変化と母音変化のタイミングずれが知覚できないレベルか
- [ ] ポルタメント中に母音遷移が同時進行したとき音が破綻しないか
- [ ] 高速BPM（200BPM）でも同期が保たれるか

---

## 6. 一から作り直すとしたら

### 6.1 Phase 1-4 統合設計

Phase 1-3 は「手動操作」前提で設計されており、Phase 4 で「自動制御」を後付けする形になる。統合設計するなら、Phase 1 の時点で以下を考慮すべきだった:

- **イベント駆動アーキテクチャ**: 手動/自動を問わず「次のノートを発音」「母音を遷移」「ピッチを変更」を統一イベントとして発行する設計
- **パラメータの優先度/合成ルール**: 手動ピッチ + 自動ビブラート + ジッターの合算方法を最初から定義
- **タイムライン概念**: 各パラメータの時間的な変化を管理する抽象レイヤー

### 6.2 自動歌唱を最初から考慮したイベントシステム設計

```typescript
// 理想的な統一イベントインターフェース
interface SynthEvent {
  type: 'noteOn' | 'noteOff' | 'pitchBend' | 'vowelChange' | 'paramChange';
  time: number;          // AudioContextのcurrentTimeベース
  source: 'manual' | 'auto' | 'midi';
  params: Record<string, number>;
}

class EventScheduler {
  schedule(event: SynthEvent): void;
  cancel(source: string): void;  // 特定ソースのイベントを一括取消
}
```

このような設計であれば、Auto Sing は単にイベントを生成するソースの一つとして追加でき、将来のMIDI対応でも同じインターフェースを使える。

**Phase 3 F0制御APIとの接続**: EventScheduler は Phase 3 の `AudioEngine.setF0()` / `rampF0()` / `getF0AudioParam()` を内部で呼び出す形で統合する。`SynthEvent.time` を `AudioParam.setValueAtTime()` の時刻引数にそのまま渡せるため、AudioContext.currentTime ベースのスケジューリングと自然に整合する。

**source の拡張性について**: `'manual' | 'auto' | 'midi'` で Phase 5 までのユースケースはカバーできる。将来 OSC 対応を追加する場合は `'osc'` を追加すればよい。ただし source を string literal union ではなく string 型にしておけば、拡張時に型定義の変更が不要になる。

### 6.3 各エンジンの分離度

現在の設計では各エンジン（melody, rhythm, expression, phrase）は独立モジュールだが、統合コーディネータ（`index.ts`）が全ての調整を担う。一から設計するなら:

- **パイプラインパターン**: phrase → rhythm → melody → expression → output のチェーン型にして、各段が前段の出力を入力とする

> **⚠ YAGNI警告**: リアクティブストリーム（Observable）は、本プロジェクトの規模（エンジン4-5個、Vanilla TS、フレームワークなし）では過度な抽象化。RxJS無しでObservableパターンを自作すると、テスト・デバッグコストが実益を上回る。統合コーディネータの直接呼び出しで十分であり、パイプラインパターンも単純な関数チェーンで実現可能。

### 6.4 AudioWorklet側でのタイミング管理

現在はメインスレッドがタイミングを管理し、postMessageでAudioWorkletに指示を送る設計。一から設計するなら:

- **AudioWorklet内にシーケンサーを配置**: process() のサンプルカウントベースで正確なタイミング管理。rAF/setIntervalの精度問題を根本解決
- **メインスレッドは「次のフレーズ」をまとめてpostMessage**: AudioWorkletが内部でサンプル精度のスケジューリングを行う
- **トレードオフ**: AudioWorklet内のコード複雑化、デバッグ困難、process()内でのメモリ制約（新規オブジェクト生成不可のためイベントキューを固定長リングバッファで実装する必要がある）

**中間案（lookahead scheduling）**: メインスレッドで `setInterval(25ms)` + `AudioContext.currentTime` に基づくlookahead（100ms先まで）でイベントをスケジュールする方式。Web Audio APIの `setValueAtTime` / `linearRampToValueAtTime` をlookahead窓内で発行することで、メインスレッドのタイミングジッターを吸収しつつ、AudioWorkletの複雑化を回避できる。Chris Wilson の "A Tale of Two Clocks" パターン。本プロジェクトではこの中間案が最も実用的。

### 6.5 MIDIメッセージ的な統一イベントフォーマットの導入

> **⚠ YAGNI警告**: MIDIバイナリフォーマット（0x90等のステータスバイト、7bit値域0-127）をWebアプリ内部のメッセージングに採用するのは不適切。MIDIの7bit制限（0-127）はF0やRdの精度が不足する（F0: 50-400Hzを128段階 ≈ 2.7Hz刻みではポルタメントが階段状になる）。また `data1`/`data2` という命名はセマンティクスが不明瞭で可読性が低い。MIDI入力対応が必要になった時点で Web MIDI API → SynthEvent への変換レイヤーを書けば十分。

6.2節の SynthEvent 形式が内部表現として適切であり、VocalMessage は不要:

```typescript
// MIDIライクな統一フォーマット（参考: 将来のMIDI対応時に検討）
interface VocalMessage {
  // MIDIに準拠したメッセージタイプ
  status: number;       // 0x90 noteOn, 0x80 noteOff, 0xE0 pitchBend, ...
  channel: number;      // 0: manual, 1: auto, 2: midi-in
  data1: number;        // MIDIノート番号 or パラメータID
  data2: number;        // ベロシティ or 値
  // 独自拡張
  vowel?: VowelType;    // 母音指定
  areaFunction?: Float64Array;  // 直接断面積指定
  timestamp: number;    // AudioContext.currentTime
}
```

この設計なら:
- Phase 4 の Auto Sing は VocalMessage を生成するだけ
- 将来の MIDI 入力は Web MIDI API → VocalMessage 変換のみ
- OSC 対応も同様に変換レイヤーのみ追加
- 手動操作も VocalMessage に変換して統一パスを通る

**推奨**: Phase 4 では SynthEvent（6.2節）で実装し、MIDI対応が具体化した時点で VocalMessage への変換レイヤーを追加する方が堅実。

### 6.6 補足: レビューによる追加事項

#### Auto Sing 停止→再開時の状態復元戦略

Auto Sing を停止して手動操作に切り替え、再度 Auto Sing を開始する場合の状態をどう扱うか。以下の方針が必要:

- **停止時**: 現在のフレーズ進行度、最後のMIDIノート、最後の母音を保持する
- **再開時**: 「前回の状態から継続」ではなく「新しいフレーズを開始」が自然。手動操作中に声道形状が変わっている可能性があるため、現在の声道形状から最も近い母音を検出し、そこから遷移を開始する
- **F0の扱い**: 再開時の基準F0は、停止直前の値ではなく、現在のF0スライダー値を使用する（手動で変更されている可能性があるため）

#### マルコフ連鎖の遷移確率テーブルのチューニング方法

2.3節の `BASE_PROBABILITY` テーブルの数値は理論的な初期値であり、実際の音楽的自然さは聴取テストでチューニングする必要がある。具体的な方法:

1. **A/Bテスト用ユーティリティ**: 遷移確率テーブルをJSON形式で外部ファイル化し、ブラウザの開発者コンソールから `window.__setMarkovTable(json)` で差し替え可能にする
2. **メロディログ出力**: 生成されたノートシーケンスを `console.table()` で出力し、跳躍分布・音域使用率を視覚的に確認する
3. **段階的調整**: 順次進行率（50-60%）を先に固定し、その後跳躍パターンのバランスを調整する。フレーズ末収束は最後に微調整する
4. **評価基準**: 30秒間の生成メロディにおいて、同一パターンの3回以上連続反復がないこと、音域の上半分/下半分の使用率が30-70%の範囲にあること

#### パフォーマンスプロファイリングの具体的方法

5.3節のCPU負荷懸念に対して、以下の具体的な計測手順を推奨:

1. **Chrome DevTools Performance タブ**: Auto Sing 動作中に5秒間記録し、Main スレッドの Long Task（50ms超）がゼロであることを確認
2. **process() 内部計測**: `performance.now()` は AudioWorklet 内で使用可能。process() の冒頭と末尾で計測し、128サンプルの予算（2.9ms）の50%以下であることを確認。計測結果は postMessage でメインスレッドに送り、開発ビルド時のみコンソールに出力
3. **メモリ**: DevTools Memory タブで Allocation Timeline を記録し、Auto Sing 動作中にヒープの単調増加がないことを確認（3分間で安定すること）
4. **postMessage 頻度**: DevTools の Performance タブの Bottom-Up ビューで `postMessage` の呼び出し回数を確認し、60回/秒以下であることを確認

---

## 7. 後続タスクへの連絡事項

### 7.1 Phase 5（LFモデル・声質制御）との統合

Phase 5 で KLGLOTT88 から LF (Rd パラメータ) に声門モデルが移行する際、Auto Sing モードでも声質変化を自動制御する必要がある:

- **Rdパラメータの自動変調**: フレーズ内での声質変化（フレーズ冒頭はやや息混じり → 中盤でクリア → フレーズ末で再び息混じり）
- **ピッチ連動**: 高音域では Rd を小さく（緊張した声）、低音域では Rd を大きく（リラックスした声）する自動マッピング
- **expression-engine の拡張**: ビブラート/ポルタメントと同列に Rd 変調を追加する設計にしておく
- **AudioWorkletへの通信**: ジッター/シマーと同じpostMessage経路でRdパラメータを送信する設計を想定

### 7.2 Phase 5 UI改善に向けたAutoモード関連コントロール配置

Phase 5 のUI改善で以下の追加コントロールが必要になる可能性がある:

- **音階選択ドロップダウン**: ペンタトニック以外（メジャー、マイナー、全音階等）の選択
- **ビブラート深さ/速度スライダー**: 現在は固定値だが、ユーザー調整可能にする余地
- **メロディの「性格」プリセット**: マルコフ遷移確率テーブルのプリセット切替
- **Rdスライダー**: Auto Sing中の声質自動変調のベース値設定

Phase 4 の UI 実装では、これらの拡張スペースを確保したレイアウトにしておくこと。具体的には:
- コントロールパネルを折りたたみ可能なセクション構成にする
- Auto Sing関連コントロールを一つのグループとしてまとめておく

### 7.3 将来のMIDI/OSC対応に向けたイベントインターフェース設計

Phase 4 の実装では、将来のMIDI/OSC対応を見据えて以下の設計を心がける:

- **イベントの発行元（source）をタグ付け**: Auto Sing が生成するイベントに `source: 'auto'` を付与し、将来 `source: 'midi'` と区別できるようにする
- **パラメータ変更を関数呼び出しではなくイベントオブジェクト経由にする**: `setF0(440)` ではなく `emit({ type: 'pitchChange', value: 440, source: 'auto' })` の形にする
- **Auto Singの停止 = イベント発行の停止**: Auto Sing停止時に `source: 'auto'` のイベントを一括キャンセルする仕組みを入れておく
- **ベロシティ/ボリュームの0-127正規化**: MIDI互換のために内部値を0-127に正規化するユーティリティを用意しておく

これにより Phase 5 以降で Web MIDI API を接続する際、Auto Sing のイベントパイプラインをそのままMIDI入力のパイプラインとして再利用できる。

---

## 付録: ファイル構成案

```
src/
├── ui/
│   ├── auto-singer/
│   │   ├── index.ts                 # 統合コーディネータ（ループ管理）
│   │   ├── melody-generator.ts      # マルコフ連鎖メロディ生成
│   │   ├── vowel-sequencer.ts       # 母音遷移エンジン
│   │   ├── expression-engine.ts     # ビブラート・ポルタメント・ジッター・シマー
│   │   ├── rhythm-engine.ts         # リズム生成・マイクロタイミング
│   │   ├── phrase-manager.ts        # フレーズ構造・休符・ADSR・音量カーブ
│   │   └── ui-controls.ts           # Auto Singボタン・速度スライダー
│   └── controls.ts                  # 既存コントロール（変更あり: Auto UI統合）
├── audio/
│   └── worklet-processor.ts         # 変更あり: ジッター/シマーパラメータ受信追加
└── types/
    └── index.ts                     # 変更あり: AutoSing関連の型定義追加
```

---

## 参考情報

- TECHNICAL_RESEARCH.md 7章: 自動歌唱モード (Auto Sing) の仕様
- REQUIREMENTS.md 2.7: 自動モード（Auto Sing）の機能要求
- REQUIREMENTS.md 8項: 成功基準「自動モードで母音とピッチがランダムに遷移し『歌っている』ように聞こえる」
- CLAUDE.md: スレッド分離、通信方式、AudioWorkletの制約
