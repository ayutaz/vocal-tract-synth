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
**成果物**: パルス音源 + 44区間Kelly-Lochbaum + 差分放射フィルタ + 基本Canvas UI
**完了条件**: ブラウザ上で声道断面積をドラッグ変更でき、リアルタイムに音が変化する

### 依存チケット
- [PHASE1-001](tickets/PHASE1-001_basic-audio-pipeline.md) 基本音声パイプライン構築

---

## Phase 2: 声門音源・母音プリセット — 「母音が聞こえる」

**前提条件**: Phase 1 完了
**成果物**: KLGLOTT88音源 + 壁面損失 + 改良放射フィルタ + 5母音プリセット
**完了条件**: 5母音（あいうえお）のプリセットが正しい母音に聞こえる

### 依存チケット
- [PHASE2-001](tickets/PHASE2-001_klglott88-vowel-presets.md) KLGLOTT88声門音源・母音プリセット実装

---

## Phase 3: 可視化・ピッチ制御 — 「可視化完成」

**前提条件**: Phase 2 完了
**成果物**: FFTスペクトル表示 + フォルマント直接計算 + F0スライダー
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
