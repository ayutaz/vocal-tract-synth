// ============================================================================
// 音素タイムライン Canvas (PhonemeTimelineCanvas)
// ----------------------------------------------------------------------------
// Phase 9: テキスト読み上げ再生時に音素の進行をセル表示する Canvas UI。
//
// - 静的レイヤー (render で 1 回描画) と動的レイヤー (highlightAt で毎回上書き)
//   の 2 層構造にして 60fps 維持
// - 配色は音素カテゴリ別 (母音/破裂/摩擦/鼻音/弾音半母音/ポーズ/無音)
// - phoneme-player の onPhonemeChange から highlightAt、onComplete から clear
// - 高DPI対応 (devicePixelRatio + ResizeObserver)
//
// 設計上のポイント:
//   * 静的レイヤーは `document.createElement('canvas')` で作成する通常の
//     `HTMLCanvasElement` を利用。OffscreenCanvas は互換性のため不採用。
//   * 時刻 → セル変換は線形探索。音素数は通常 < 100 なので O(N) で問題ない。
//   * render が呼ばれるまでは "テキスト読み上げで音素タイムラインを表示" の
//     プレースホルダ文言を描画する。
// ============================================================================

import type { PhonemeEvent } from '../types/index';

// ===== 配色（音素カテゴリ別） =====
// Phase 9 要件 3.2.2 に従ったカテゴリ配色。破擦/拗音は中間色を使う。

/** 音素カテゴリ別のセル背景色 */
const CATEGORY_COLORS: Record<string, string> = {
  vowel: '#9ECCE8',       // 薄青
  plosive: '#F0A050',     // オレンジ
  fricative: '#F0D050',   // 黄
  affricate: '#F0B070',   // 黄橙
  nasal: '#B090E0',       // 紫
  hatsuon: '#9070C0',     // 濃紫 (撥音 ɴ)
  flap: '#80D080',        // 緑
  approximant: '#90D8A0', // 薄緑
  palatalized: '#A0E090', // 薄緑 (拗音)
  sokuon: '#808080',      // 灰 (促音)
  pause: '#B0B0B0',       // 薄灰 (句読点ポーズ)
  silence: '#606060',     // 暗灰 (無音区間)
};

// ===== レイアウト定数 =====

const CELL_MARGIN_Y = 4;           // セル上下のマージン [px]
const CELL_BORDER_COLOR = '#1a1a2e';
const HIGHLIGHT_FILL = 'rgba(255, 255, 255, 0.35)';
const HIGHLIGHT_STROKE = '#fff';
const PROGRESS_LINE_COLOR = '#4cc9f0';
const BACKGROUND_COLOR = '#0e1628';
const PLACEHOLDER_COLOR = '#6a7fa8';
const PLACEHOLDER_TEXT = 'テキスト読み上げで音素タイムラインを表示';

/**
 * PhonemeEvent → カテゴリ名判定。
 *
 * PhonemeEvent.sourceType と phoneme 文字列から CATEGORY_COLORS のキーを返す。
 * 未知の音素は 'vowel' にフォールバック。
 */
function categorize(event: PhonemeEvent): string {
  // 無音 (silence) は sourceType が 'silence' 固定
  if (event.sourceType === 'silence') return 'silence';

  // ポーズ系の特殊トークン (text-parser 側で PAUSE_* として出力される)
  if (
    event.phoneme === 'PAUSE_LONG' ||
    event.phoneme === 'PAUSE_SHORT' ||
    event.phoneme === 'PAUSE_MID'
  ) {
    return 'pause';
  }

  // 促音 Q
  if (event.phoneme === 'Q') return 'sokuon';

  // 母音 (日本語 5 母音 + 中舌母音 ɯ)
  if (['a', 'i', 'ɯ', 'e', 'o'].includes(event.phoneme)) return 'vowel';

  // 鼻音 (ɴ は撥音 ん、それ以外は通常の鼻音)
  if (['m', 'n', 'ɲ', 'ŋ', 'ɴ'].includes(event.phoneme)) {
    return event.phoneme === 'ɴ' ? 'hatsuon' : 'nasal';
  }

  // 破裂音 (拗音含む)
  if (['k', 't', 'p', 'g', 'd', 'b', 'kj', 'gj', 'bj', 'pj'].includes(event.phoneme)) {
    return 'plosive';
  }

  // 摩擦音
  if (['s', 'ɕ', 'h', 'ç', 'ɸ', 'z'].includes(event.phoneme)) {
    return 'fricative';
  }

  // 破擦音
  if (['ts', 'tɕ', 'dz', 'dʑ'].includes(event.phoneme)) {
    return 'affricate';
  }

  // 弾音 (ラ行)
  if (['ɾ', 'ɾj'].includes(event.phoneme)) return 'flap';

  // 半母音
  if (['j', 'w'].includes(event.phoneme)) return 'approximant';

  // フォールバック
  return 'vowel';
}

// ============================================================================
// PhonemeTimelineCanvas クラス
// ============================================================================

export class PhonemeTimelineCanvas {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;

  /** 現在描画中の音素イベント列 (source of truth は render() 経由) */
  private events: PhonemeEvent[] = [];
  /** 全体の尺 [秒] = 最後の event.startTime + event.duration */
  private totalDuration: number = 0;

  /** CSS ピクセル単位の Canvas サイズ */
  private cssWidth: number = 0;
  private cssHeight: number = 60;

  /** 現在ハイライト中の再生時刻 [秒] (-1 は未ハイライト) */
  private currentTime: number = -1;

  /**
   * 静的レイヤー: render() で 1 回描画し、highlightAt() ごとに drawImage で転写する。
   * OffscreenCanvas 未使用（ブラウザ互換性優先）。通常の HTMLCanvasElement を内部で生成。
   */
  private staticLayer: HTMLCanvasElement | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('PhonemeTimelineCanvas: 2D context が取得できません');
    }
    this.ctx = ctx;

    // リサイズ追従 (style 変更や window リサイズに連動)
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(canvas);

    // 初回レイアウト: プレースホルダ描画
    this.handleResize();
  }

  // ==========================================================================
  // 公開 API
  // ==========================================================================

  /**
   * 全音素イベントを 1 回描画する（再生開始時に呼ぶ）。
   *
   * 静的レイヤー（セル + IPA ラベル）をオフスクリーン Canvas にキャッシュし、
   * 以降の highlightAt() 呼び出しでは drawImage + ハイライト矩形のみを描く。
   */
  render(events: PhonemeEvent[]): void {
    this.events = events;
    this.currentTime = -1;

    if (events.length === 0) {
      this.totalDuration = 0;
      this.staticLayer = null;
      this.drawEmpty();
      return;
    }

    // 総尺の計算 (末尾音素の終了時刻)
    const last = events[events.length - 1]!;
    this.totalDuration = last.startTime + last.duration;
    if (this.totalDuration <= 0) this.totalDuration = 1;

    this.drawStaticLayer();
    this.drawCurrentFrame();
  }

  /**
   * 現在の再生位置をハイライトする（phonemePlayer.onPhonemeChange から呼ぶ）。
   *
   * @param timeSec 先頭からの絶対時刻 [秒]
   */
  highlightAt(timeSec: number): void {
    this.currentTime = timeSec;
    this.drawCurrentFrame();
  }

  /**
   * タイムラインをクリアする（再生停止 / onComplete 時）。
   */
  clear(): void {
    this.events = [];
    this.totalDuration = 0;
    this.currentTime = -1;
    this.staticLayer = null;
    this.drawEmpty();
  }

  /** リソース解放 (ResizeObserver 解除) */
  destroy(): void {
    this.resizeObserver.disconnect();
  }

  // ==========================================================================
  // 内部: リサイズ・高DPI対応
  // ==========================================================================

  private handleResize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

    this.cssWidth = cssW;
    this.cssHeight = cssH;

    // バックバッファは物理ピクセル
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);

    // 描画は CSS ピクセル空間で扱う
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 既存イベントがあれば静的レイヤーを再生成
    if (this.events.length > 0 && this.totalDuration > 0) {
      this.drawStaticLayer();
    }
    this.drawCurrentFrame();
  }

  // ==========================================================================
  // 内部: 描画
  // ==========================================================================

  /**
   * 静的レイヤー (セル + ラベル) を生成する。
   *
   * メイン Canvas と同じ物理サイズで HTMLCanvasElement を作り、
   * 以降の drawImage() ソースとして使う。render() と handleResize() から呼ばれる。
   */
  private drawStaticLayer(): void {
    if (this.events.length === 0 || this.totalDuration <= 0) {
      this.staticLayer = null;
      return;
    }

    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const layer = document.createElement('canvas');
    layer.width = Math.round(this.cssWidth * dpr);
    layer.height = Math.round(this.cssHeight * dpr);
    const lctx = layer.getContext('2d');
    if (!lctx) {
      this.staticLayer = null;
      return;
    }
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // --- 背景 ---
    lctx.fillStyle = BACKGROUND_COLOR;
    lctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    // --- 各音素のセル ---
    const cellTop = CELL_MARGIN_Y;
    const cellH = Math.max(1, this.cssHeight - CELL_MARGIN_Y * 2);

    for (const e of this.events) {
      const x = (e.startTime / this.totalDuration) * this.cssWidth;
      const w = Math.max(1, (e.duration / this.totalDuration) * this.cssWidth);
      const cat = categorize(e);
      const color = CATEGORY_COLORS[cat] ?? '#888';

      // 背景矩形
      lctx.fillStyle = color;
      lctx.fillRect(x, cellTop, w, cellH);

      // 区切り線
      lctx.strokeStyle = CELL_BORDER_COLOR;
      lctx.lineWidth = 1;
      lctx.strokeRect(x, cellTop, w, cellH);

      // IPA ラベル (セル幅が十分な場合のみ)
      if (w >= 14) {
        lctx.fillStyle = CELL_BORDER_COLOR;
        // 幅に応じてフォントサイズを 10〜14 px で動的調整
        const fontSize = Math.min(14, Math.max(10, Math.floor(w * 0.6)));
        lctx.font = `${fontSize}px system-ui, sans-serif`;
        lctx.textAlign = 'center';
        lctx.textBaseline = 'middle';
        // PAUSE_* は中黒点で表示して可読性を維持
        const label = e.phoneme.startsWith('PAUSE') ? '·' : e.phoneme;
        lctx.fillText(label, x + w / 2, this.cssHeight / 2);
      }
    }

    this.staticLayer = layer;
  }

  /**
   * メイン Canvas に動的レイヤー（静的レイヤー転写 + ハイライト）を描画する。
   *
   * - staticLayer が null の場合はプレースホルダを描画
   * - currentTime が有効なら該当セルをハイライト + 進行位置縦線
   */
  private drawCurrentFrame(): void {
    this.ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);

    if (!this.staticLayer) {
      this.drawEmpty();
      return;
    }

    // 静的レイヤーをそのまま転写 (dpr スケールは setTransform 済みなので CSS ピクセル指定)
    this.ctx.drawImage(this.staticLayer, 0, 0, this.cssWidth, this.cssHeight);

    // ハイライト描画
    if (this.currentTime >= 0 && this.totalDuration > 0) {
      // 現在時刻を含む event を探す (音素数は通常 < 100 なので線形探索で十分)
      let activeEvent: PhonemeEvent | null = null;
      for (const e of this.events) {
        if (this.currentTime >= e.startTime && this.currentTime < e.startTime + e.duration) {
          activeEvent = e;
          break;
        }
      }

      const cellTop = CELL_MARGIN_Y;
      const cellH = Math.max(1, this.cssHeight - CELL_MARGIN_Y * 2);

      if (activeEvent) {
        const x = (activeEvent.startTime / this.totalDuration) * this.cssWidth;
        const w = Math.max(1, (activeEvent.duration / this.totalDuration) * this.cssWidth);
        // 半透明白でハイライト + 枠線
        this.ctx.fillStyle = HIGHLIGHT_FILL;
        this.ctx.fillRect(x, cellTop, w, cellH);
        this.ctx.strokeStyle = HIGHLIGHT_STROKE;
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(x, cellTop, w, cellH);
      }

      // 進行位置の縦線 (current time の比率で Canvas 全体を縦断)
      const px = (this.currentTime / this.totalDuration) * this.cssWidth;
      this.ctx.strokeStyle = PROGRESS_LINE_COLOR;
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(px, 0);
      this.ctx.lineTo(px, this.cssHeight);
      this.ctx.stroke();
    }
  }

  /**
   * 空状態 (events なし) のプレースホルダを描画する。
   */
  private drawEmpty(): void {
    this.ctx.fillStyle = BACKGROUND_COLOR;
    this.ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    this.ctx.fillStyle = PLACEHOLDER_COLOR;
    this.ctx.font = '12px system-ui, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(PLACEHOLDER_TEXT, this.cssWidth / 2, this.cssHeight / 2);
  }
}
