# マイルストーン管理

## 進捗サマリー

| Phase | タイトル | 状態 | チケット | 目標 |
|-------|---------|------|---------|------|
| 1 | 基本音声パイプライン | 🔲 未着手 | [PHASE1-001](tickets/PHASE1-001_basic-audio-pipeline.md) | 音が出る |
| 2 | 声門音源・母音プリセット | 🔲 未着手 | [PHASE2-001](tickets/PHASE2-001_klglott88-vowel-presets.md) | 母音が聞こえる |
| 3 | 可視化・ピッチ制御 | 🔲 未着手 | [PHASE3-001](tickets/PHASE3-001_spectrum-formant-pitch.md) | 可視化完成 |
| 4 | 自動歌唱モード | 🔲 未着手 | [PHASE4-001](tickets/PHASE4-001_auto-singing-mode.md) | 歌える |
| 5 | 声質向上・UI改善 | 🔲 未着手 | [PHASE5-001](tickets/PHASE5-001_lf-model-quality.md) | 品質向上 |

---

## Phase 1: 基本音声パイプライン — 「音が出る」

**前提条件**: なし（初期フェーズ）
<!-- REVIEW: Phase間整合性レビューにて修正 — Phase 1 チケットのスコープ内に壁面損失(mu=0.999)が含まれているため成果物に追加 -->
**成果物**: パルス音源 + 44区間Kelly-Lochbaum + 壁面損失(mu=0.999) + 差分放射フィルタ + 基本Canvas UI
**完了条件**: ブラウザ上で声道断面積をドラッグ変更でき、リアルタイムに音が変化する

### 依存チケット
- [PHASE1-001](tickets/PHASE1-001_basic-audio-pipeline.md) 基本音声パイプライン構築

---

## Phase 2: 声門音源・母音プリセット — 「母音が聞こえる」

**前提条件**: Phase 1 完了
<!-- REVIEW: Phase間整合性レビューにて修正 — 壁面損失はPhase 1で導入済みのため、Phase 2の成果物から除外し、有声/無声切替を追加 -->
**成果物**: KLGLOTT88音源 + 改良放射フィルタ + 5母音プリセット + 有声/無声切替
**完了条件**: 5母音（あいうえお）のプリセットが正しい母音に聞こえる

### 依存チケット
- [PHASE2-001](tickets/PHASE2-001_klglott88-vowel-presets.md) KLGLOTT88声門音源・母音プリセット実装

---

## Phase 3: 可視化・ピッチ制御 — 「可視化完成」

**前提条件**: Phase 2 完了
<!-- REVIEW: Phase間整合性レビューにて修正 — Phase 1から引き継いだ音量スライダーを成果物に追加 -->
**成果物**: FFTスペクトル表示 + フォルマント直接計算 + F0スライダー + 音量スライダー
**完了条件**: スペクトル表示で母音ごとのフォルマント構造の違いが視認できる

### 依存チケット
- [PHASE3-001](tickets/PHASE3-001_spectrum-formant-pitch.md) スペクトル表示・フォルマント計算・ピッチ制御

---

## Phase 4: 自動歌唱モード — 「歌える」

**前提条件**: Phase 3 完了
**成果物**: Auto Sing モード + ビブラート + 揺らぎ + フレーズ構造
**完了条件**: 自動モードで母音とピッチがランダムに遷移し「歌っている」ように聞こえる

### 依存チケット
- [PHASE4-001](tickets/PHASE4-001_auto-singing-mode.md) 自動歌唱モード実装

---

## Phase 5: 声質向上・UI改善 — 「品質向上」

**前提条件**: Phase 4 完了
**成果物**: LF声門モデル + Rdパラメータ + 声質制御UI + 全体UIリファイン
**完了条件**: LFモデルによる自然な声質、Rdパラメータで声質が連続的に変化する

### 依存チケット
- [PHASE5-001](tickets/PHASE5-001_lf-model-quality.md) LF声門モデル・声質制御・UI改善

---

## クリティカルパス

```
Phase 1 (音が出る)
  → Phase 2 (母音が聞こえる)
    → Phase 3 (可視化完成)
      → Phase 4 (歌える)
        → Phase 5 (品質向上)
```

全フェーズは直列依存。各フェーズの完了条件を満たしてから次のフェーズに進む。

---

<!-- REVIEW: プロジェクト管理レビューにて追加 -->
## REQUIREMENTS.md 機能要求とPhaseの対応表

| REQUIREMENTS.md 機能要求 | 対応Phase | 対応チケット | 備考 |
|-------------------------|-----------|-------------|------|
| 2.1 声道断面積エディタ（メインUI） | Phase 1 | [PHASE1-001](tickets/PHASE1-001_basic-audio-pipeline.md) | 16制御点Canvas UI、スプライン補間、ドラッグ操作 |
| 2.2 音源（Source）— 声門パルス | Phase 1→2→5 | [PHASE1-001](tickets/PHASE1-001_basic-audio-pipeline.md)→[PHASE2-001](tickets/PHASE2-001_klglott88-vowel-presets.md)→[PHASE5-001](tickets/PHASE5-001_lf-model-quality.md) | Phase 1: 三角波パルス、Phase 2: KLGLOTT88、Phase 5: LFモデル |
| 2.2 音源（Source）— ピッチ制御 | Phase 3 | [PHASE3-001](tickets/PHASE3-001_spectrum-formant-pitch.md) | F0スライダー（50-400Hz、対数スケール） |
| 2.2 音源（Source）— ノイズ源・音源切替 | Phase 2 | [PHASE2-001](tickets/PHASE2-001_klglott88-vowel-presets.md) | 有声/無声切替、クロスフェード付き |
<!-- REVIEW: Phase間整合性レビューにて修正 — 壁面損失はPhase 1のスコープ -->
| 2.3 フィルタ（声道モデル） | Phase 1→2 | [PHASE1-001](tickets/PHASE1-001_basic-audio-pipeline.md)→[PHASE2-001](tickets/PHASE2-001_klglott88-vowel-presets.md) | Phase 1: 基本KL+壁面損失(mu=0.999)+差分放射、Phase 2: 改良放射フィルタ(1次IIR) |
| 2.4 母音プリセット | Phase 2 | [PHASE2-001](tickets/PHASE2-001_klglott88-vowel-presets.md) | 5母音+Flat、コサイン補間遷移 |
| 2.5 特殊モード — フラット | Phase 2 | [PHASE2-001](tickets/PHASE2-001_klglott88-vowel-presets.md) | Flatボタン（均一管4.0cm²） |
| 2.5 特殊モード — ノイズ | Phase 2 | [PHASE2-001](tickets/PHASE2-001_klglott88-vowel-presets.md) | Noiseボタン（有声/無声トグル） |
| 2.6 再生制御 — 開始/停止 | Phase 1 | [PHASE1-001](tickets/PHASE1-001_basic-audio-pipeline.md) | Start/Stopボタン |
<!-- REVIEW: Phase間整合性レビューにて修正 — 音量スライダーUIはPhase 3のスコープに追加済み -->
| 2.6 再生制御 — 音量 | Phase 1→3 | [PHASE1-001](tickets/PHASE1-001_basic-audio-pipeline.md)→[PHASE3-001](tickets/PHASE3-001_spectrum-formant-pitch.md) | Phase 1: GainNode配置、Phase 3: 音量スライダーUI |
| 2.7 自動モード（Auto Sing） | Phase 4 | [PHASE4-001](tickets/PHASE4-001_auto-singing-mode.md) | メロディ生成、母音遷移、ビブラート、フレーズ構造 |
| 2.8 スペクトル表示 | Phase 3 | [PHASE3-001](tickets/PHASE3-001_spectrum-formant-pitch.md) | FFTスペクトル+フォルマント直接計算+マーカー表示 |

---

<!-- REVIEW: プロジェクト管理レビューにて追加 -->
## エージェントチーム構成サマリー

### Phase別エージェント数

| Phase | エージェント数 | エージェント名 |
|-------|-------------|--------------|
| Phase 1 | 4名 | build-config, audio-engine, ui-canvas, integration |
| Phase 2 | 5名 | glottal-model, wall-loss-radiation, vowel-presets, ui-presets, integration-test |
<!-- REVIEW: Phase間整合性レビューにて修正 — pitch-control を pitch-volume-control に改名（音量スライダー責務追加のため） -->
| Phase 3 | 4名 | spectrum-renderer, formant-calculator, pitch-volume-control, canvas-optimizer |
| Phase 4 | 6名 | melody-generator, vowel-sequencer, expression-engine, rhythm-engine, phrase-manager, ui-auto |
| Phase 5 | 5名 | lf-model, voice-quality, ui-refinement, performance, qa-integration |
| **合計** | **延べ24名** | |

### スキルセット横断分析

| スキルセット | 関連エージェント（Phase） | 備考 |
|------------|----------------------|------|
| DSP / 音声信号処理 | audio-engine(P1), glottal-model(P2), wall-loss-radiation(P2), lf-model(P5), voice-quality(P5) | 最多。5Phase中4Phaseにまたがる中核スキル |
| Canvas描画 / UI | ui-canvas(P1), ui-presets(P2), spectrum-renderer(P3), canvas-optimizer(P3), ui-auto(P4), ui-refinement(P5) | 全Phaseにまたがる |
| 数学 / 数値計算 | audio-engine(P1), formant-calculator(P3), lf-model(P5) | KL, QR法, Newton-Raphson |
| テスト / 品質保証 | integration(P1), integration-test(P2), qa-integration(P5) | Phase 3, 4に専任テストエージェントなし |
| 音楽理論 / 作曲 | melody-generator(P4), rhythm-engine(P4), expression-engine(P4), phrase-manager(P4) | Phase 4に集中 |
| ビルド / 設定 | build-config(P1), performance(P5) | Phase 1と5のみ |

### 作業量バランスの評価

- **Phase 4（6名）が最大**: 自動歌唱は独立したサブシステム（メロディ、リズム、表現、フレーズ、母音遷移、UI）を含むため妥当
- **Phase 1（4名）**: 基盤構築フェーズとして適正。ビルド設定+音声エンジン+UI+統合の分離は合理的
- **Phase 3（4名）**: スペクトル描画、フォルマント計算、ピッチ制御、Canvas最適化で適正
- **Phase 2, 5（各5名）**: Phase 2は音源+フィルタ+プリセット+UI+テスト、Phase 5はLFモデル+声質+UI+性能+テストで適正
