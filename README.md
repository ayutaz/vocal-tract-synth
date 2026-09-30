# 声道シンセサイザー（vocal-tract-synth）

声道の物理モデル（source-filter model）をブラウザ上でリアルタイムに操作して、人工音声を生成する「声の楽器」です。声門音源 + 声道フィルタ（44区間の連結管モデル / Kelly-Lochbaum アルゴリズム）で音を作り、声道の断面積をドラッグで変えると、その場で音色が変わります。

**Live Demo**: https://ayutaz.github.io/vocal-tract-synth/

## 使いかた

1. **Start** を押すと発音が始まります（ブラウザの自動再生ポリシーのため、AudioContext はこのクリックで生成します）。
2. 上のキャンバス（左 = 唇、右 = 声門）の16個の制御点をドラッグして、声道の断面積を変えます。
3. **あ / い / う / え / お** で母音プリセット、**Flat** で均一管に切り替えます。**Noise** で有声音（声門パルス）と無声音（ノイズ）を切り替えます。
4. スライダーで音源を調整します。

   | 操作 | 内容 |
   |------|------|
   | **F0** | 基本周波数（50–400 Hz、対数スケール） |
   | **Vol** | 音量 |
   | **Rd** | LF モデルの声質（0.3–2.7。Pressed / Modal / Breathy） |
   | **Asp** | 気息ノイズの混合量 |
   | 声門モデル | **LF** / **KLGLOTT88** の切替 |

5. **Auto Sing** を押すと、ペンタトニック旋律を自動生成して母音を歌い分けます（**BPM** 40–200）。Auto Sing 中は声道のドラッグと母音ボタンが無効になり、F0 スライダーは基準の高さとして合算されます。
6. 下段には出力のスペクトル（AnalyserNode の FFT）と、断面積から計算したフォルマント F1 / F2 / F3 を表示します。

## 仕組み

```text
[メインスレッド]                          [AudioWorklet スレッド]
16制御点 → 自然3次スプライン → 44区間の断面積
  → postMessage ─────────────────→ 声門音源（LF / KLGLOTT88、ジッター・シマー・気息ノイズ）
                                      → Kelly-Lochbaum 連結管（44区間、壁面損失 0.999）
                                      → 放射フィルタ → 出力
スペクトル表示 ← AnalyserNode（fftSize 2048）
フォルマント計算（伝達行列方式、512点 / 50–5000 Hz）
```

- 区間数 44 は、fs = 44100 Hz で声道長 17.5 cm を物理的に正しく離散化した値です（1サンプルあたり2半ステップ）。
- 音声処理は AudioWorklet で行い、`process()` 内ではメモリ確保をしません。
- 設計の詳細は [`CLAUDE.md`](./CLAUDE.md)、根拠は [`TECHNICAL_RESEARCH.md`](./TECHNICAL_RESEARCH.md) を参照してください。

## 動作環境

要求定義上の対象は Chrome / Firefox / Edge（AudioWorklet を含む Web Audio API 対応ブラウザ）です。サーバーは不要で、ビルド結果は静的ファイルだけです。

## ローカルで動かす

Node.js と npm が必要です（Vite 8 の要件により Node.js 20.19 以上 / 22.12 以上）。

```bash
npm ci
npm run dev        # 開発サーバー（Vite）
npm test           # 単体テスト（Vitest）
npm run build      # 型チェック（tsc）+ 本番ビルド（dist/）
npm run preview    # 本番ビルドの確認
```

## ディレクトリ構成

```text
src/
  main.ts            # エントリポイント（全モジュールの結線）
  audio/             # AudioContext 管理、AudioParam、AudioWorkletProcessor
  models/            # 声門音源（KLGLOTT88 / LF）、声道（Kelly-Lochbaum）、母音プリセット、フォルマント計算
  ui/                # 声道エディタ、各種コントロール、スペクトル表示
    auto-singer/     # 自動歌唱（旋律・リズム・表現・フレーズ・母音選択）
  types/             # 物理定数とメッセージ型
docs/MILESTONES.md   # フェーズごとの完了記録
REQUIREMENTS.md      # 要求定義
TECHNICAL_RESEARCH.md # 技術調査
```

テストは `src/**/*.test.ts`（声道、声門音源、フォルマント計算、声道エディタのスプライン補間）にあります。

## デプロイ

`main` への push で [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) がテストとビルドを行い、GitHub Pages へ公開します。Vite の `base` は相対パス（`./`）です。

## ライセンス

未定。
