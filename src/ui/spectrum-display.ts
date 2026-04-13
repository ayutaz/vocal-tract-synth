// ============================================================================
// スペクトル表示 (SpectrumDisplay)
// ----------------------------------------------------------------------------
// AnalyserNode の FFT データを対数周波数スケールで Canvas に描画し、
// フォルマントマーカーをオーバーレイする。
//
// 2層 Canvas 構造:
//   - 下層 (spectrumCanvas): スペクトル曲線を 60fps で描画
//   - 上層 (overlayCanvas):  フォルマントマーカーを更新時のみ描画
//
// 高DPI対応: devicePixelRatio + ResizeObserver で両 Canvas をリサイズ追従。
// ============================================================================

// ===== 定数 =====

/** 表示する周波数範囲 [Hz] */
const MIN_FREQ = 50;
const MAX_FREQ = 5000;

/** 対数周波数の事前計算 */
const LOG_MIN_FREQ = Math.log(MIN_FREQ);
const LOG_MAX_FREQ = Math.log(MAX_FREQ);

/** 振幅表示範囲 [dB]（AnalyserNode 出力はそのまま dB） */
const MIN_DB = -100;
const MAX_DB = -20;

/** 描画マージン（px）— グリッドラベル用の余白 */
const MARGIN_LEFT = 40;
const MARGIN_RIGHT = 12;
const MARGIN_TOP = 16;
const MARGIN_BOTTOM = 24;

/** 周波数グリッド線を引く周波数 */
const GRID_FREQUENCIES = [100, 200, 500, 1000, 2000, 5000];

/** グリッドラベルの表示テキスト */
const GRID_LABELS: Record<number, string> = {
  100: '100',
  200: '200',
  500: '500',
  1000: '1k',
  2000: '2k',
  5000: '5k',
};

// ===== 配色 =====

const COLOR_BACKGROUND = '#0e1628';
const COLOR_GRID = '#1c2a46';
const COLOR_GRID_LABEL = '#4a5f82';
const COLOR_SPECTRUM_STROKE = '#4cc9f0';
const COLOR_SPECTRUM_FILL = 'rgba(76, 201, 240, 0.12)';
const COLOR_F1 = '#ff6b6b';
const COLOR_F2 = '#ffd166';
const COLOR_F3 = '#72efdd';

// ============================================================================
// SpectrumDisplay クラス
// ============================================================================

export class SpectrumDisplay {
  // --- DOM ---
  private readonly spectrumCanvas: HTMLCanvasElement;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly spectrumCtx: CanvasRenderingContext2D;
  private readonly overlayCtx: CanvasRenderingContext2D;
  private readonly formantEls: { f1: HTMLElement; f2: HTMLElement; f3: HTMLElement };

  // --- 高DPI・サイズ ---
  private readonly resizeObserver: ResizeObserver;
  private cssWidth = 0;
  private cssHeight = 0;

  // --- AnalyserNode ---
  private analyser: AnalyserNode | null = null;
  private dataArray: Float32Array<ArrayBuffer> | null = null;
  /** analyser.frequencyBinCount から算出したビン幅 [Hz] */
  private binHz = 0;

  // --- フォルマント ---
  private formants: [number, number, number] = [0, 0, 0];
  private formantsDirty = true; // 初回描画のため true

  // --- rAF ループ ---
  private rafId: number | null = null;

  constructor(
    spectrumCanvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
    formantElements: { f1: HTMLElement; f2: HTMLElement; f3: HTMLElement },
  ) {
    this.spectrumCanvas = spectrumCanvas;
    this.overlayCanvas = overlayCanvas;
    this.formantEls = formantElements;

    // 下層: alpha: false で高速化（不透明背景）
    const sCtx = spectrumCanvas.getContext('2d', { alpha: false });
    if (!sCtx) {
      throw new Error('SpectrumDisplay: spectrum canvas 2D context を取得できませんでした');
    }
    this.spectrumCtx = sCtx;

    // 上層: alpha: true で透明背景（マーカーのみ描画）
    const oCtx = overlayCanvas.getContext('2d', { alpha: true });
    if (!oCtx) {
      throw new Error('SpectrumDisplay: overlay canvas 2D context を取得できませんでした');
    }
    this.overlayCtx = oCtx;

    // ResizeObserver で両 Canvas のリサイズ追従
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(spectrumCanvas);

    // 初回レイアウト
    this.handleResize();
  }

  // ==========================================================================
  // 公開 API
  // ==========================================================================

  /**
   * AnalyserNode を設定する（engine.start 後に呼ばれる）。
   * fftSize はデフォルト (2048) を想定。
   */
  setAnalyser(analyser: AnalyserNode): void {
    this.analyser = analyser;
    this.dataArray = new Float32Array(analyser.frequencyBinCount) as Float32Array<ArrayBuffer>;
    // ビン幅 = sampleRate / fftSize
    this.binHz = analyser.context.sampleRate / analyser.fftSize;
  }

  /** rAF ループを開始する。 */
  start(): void {
    if (this.rafId !== null) return;
    this.tick();
  }

  /** rAF ループを停止する。 */
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * フォルマント値を更新する（formant-calculator から呼ばれる、10-15fps）。
   * EMA 平滑化は呼び出し元で済んでいる前提。
   */
  updateFormants(f1: number, f2: number, f3: number): void {
    this.formants[0] = f1;
    this.formants[1] = f2;
    this.formants[2] = f3;
    this.formantsDirty = true;

    // 数値表示を更新
    this.formantEls.f1.textContent = `F1: ${Math.round(f1)} Hz`;
    this.formantEls.f2.textContent = `F2: ${Math.round(f2)} Hz`;
    this.formantEls.f3.textContent = `F3: ${Math.round(f3)} Hz`;
  }

  /** リソース解放（オブザーバ・rAF を停止） */
  destroy(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.analyser = null;
    this.dataArray = null;
  }

  // ==========================================================================
  // rAF ループ
  // ==========================================================================

  private tick = (): void => {
    this.drawSpectrum();

    // フォルマントマーカーは値が更新された時だけ再描画
    if (this.formantsDirty) {
      this.drawOverlay();
      this.formantsDirty = false;
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  // ==========================================================================
  // 下層描画: スペクトル（60fps）
  // ==========================================================================

  private drawSpectrum(): void {
    const ctx = this.spectrumCtx;
    const w = this.cssWidth;
    const h = this.cssHeight;
    const plotW = w - MARGIN_LEFT - MARGIN_RIGHT;
    const plotH = h - MARGIN_TOP - MARGIN_BOTTOM;

    // --- 背景クリア ---
    ctx.fillStyle = COLOR_BACKGROUND;
    ctx.fillRect(0, 0, w, h);

    // --- グリッド ---
    this.drawGrid(ctx, w, h, plotW, plotH);

    // --- スペクトル曲線 ---
    if (this.analyser === null || this.dataArray === null) return;

    this.analyser.getFloatFrequencyData(this.dataArray);

    const data = this.dataArray;
    const binHz = this.binHz;

    // スペクトル曲線のパスを構築
    ctx.beginPath();
    let firstPoint = true;

    for (let i = 0; i < data.length; i++) {
      const freq = i * binHz;
      if (freq < MIN_FREQ || freq > MAX_FREQ) continue;

      const x = this.freqToX(freq);
      const db = data[i]!;
      const y = this.dbToY(db, plotH);

      if (firstPoint) {
        ctx.moveTo(x, y);
        firstPoint = false;
      } else {
        ctx.lineTo(x, y);
      }
    }

    // 半透明フィル（ベースラインまで閉じる）
    if (!firstPoint) {
      const baseY = MARGIN_TOP + plotH; // MIN_DB の y 座標

      // 現在のパスの最後から右下→左下→閉じて塗る
      ctx.save();
      // 右端→下端
      const lastFreq = Math.min((data.length - 1) * binHz, MAX_FREQ);
      ctx.lineTo(this.freqToX(lastFreq), baseY);
      // 左端→下端
      ctx.lineTo(this.freqToX(MIN_FREQ), baseY);
      ctx.closePath();
      ctx.fillStyle = COLOR_SPECTRUM_FILL;
      ctx.fill();
      ctx.restore();

      // 線だけ上書き描画
      ctx.beginPath();
      firstPoint = true;
      for (let i = 0; i < data.length; i++) {
        const freq = i * binHz;
        if (freq < MIN_FREQ || freq > MAX_FREQ) continue;

        const x = this.freqToX(freq);
        const db = data[i]!;
        const y = this.dbToY(db, plotH);

        if (firstPoint) {
          ctx.moveTo(x, y);
          firstPoint = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = COLOR_SPECTRUM_STROKE;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  /**
   * 周波数グリッドを描画する。
   */
  private drawGrid(
    ctx: CanvasRenderingContext2D,
    _w: number,
    _h: number,
    plotW: number,
    plotH: number,
  ): void {
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();

    // 垂直グリッド（対数周波数）
    for (const freq of GRID_FREQUENCIES) {
      const x = this.freqToX(freq);
      ctx.moveTo(x, MARGIN_TOP);
      ctx.lineTo(x, MARGIN_TOP + plotH);
    }

    // 水平グリッド（dB: -90, -80, -70, -60, -50, -40, -30, -20）
    for (let db = -90; db <= MAX_DB; db += 10) {
      if (db < MIN_DB) continue;
      const y = this.dbToY(db, plotH);
      ctx.moveTo(MARGIN_LEFT, y);
      ctx.lineTo(MARGIN_LEFT + plotW, y);
    }

    ctx.stroke();

    // --- 周波数ラベル ---
    ctx.fillStyle = COLOR_GRID_LABEL;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    for (const freq of GRID_FREQUENCIES) {
      const x = this.freqToX(freq);
      const label = GRID_LABELS[freq] ?? `${freq}`;
      ctx.fillText(label, x, MARGIN_TOP + plotH + 4);
    }

    // --- Hz ユニットラベル ---
    ctx.textAlign = 'right';
    ctx.fillText('Hz', MARGIN_LEFT + plotW, MARGIN_TOP + plotH + 4);

    // --- dBラベル ---
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let db = -90; db <= MAX_DB; db += 20) {
      if (db < MIN_DB) continue;
      const y = this.dbToY(db, plotH);
      ctx.fillText(`${db}`, MARGIN_LEFT - 4, y);
    }

    // 左上にユニットラベル
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText('dB', 4, 4);
  }

  // ==========================================================================
  // 上層描画: フォルマントマーカー（更新時のみ）
  // ==========================================================================

  private drawOverlay(): void {
    const ctx = this.overlayCtx;
    const w = this.cssWidth;
    const h = this.cssHeight;

    // 透明にクリア
    ctx.clearRect(0, 0, w, h);

    const [f1, f2, f3] = this.formants;
    const colors = [COLOR_F1, COLOR_F2, COLOR_F3] as const;
    const labels = ['F1', 'F2', 'F3'] as const;
    const values = [f1, f2, f3] as const;

    for (let i = 0; i < 3; i++) {
      const freq = values[i]!;
      // 範囲外のフォルマントは描画しない
      if (freq < MIN_FREQ || freq > MAX_FREQ || freq <= 0) continue;

      const x = this.freqToX(freq);
      const color = colors[i]!;
      const label = labels[i]!;

      // 垂直の点線
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, MARGIN_TOP);
      ctx.lineTo(x, h - MARGIN_BOTTOM);
      ctx.stroke();
      ctx.setLineDash([]);

      // 上部にラベル
      ctx.fillStyle = color;
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, MARGIN_TOP - 2);
    }
  }

  // ==========================================================================
  // 座標変換
  // ==========================================================================

  /** 対数周波数 → x 座標（CSS ピクセル） */
  private freqToX(freq: number): number {
    const plotW = this.cssWidth - MARGIN_LEFT - MARGIN_RIGHT;
    return (
      ((Math.log(freq) - LOG_MIN_FREQ) / (LOG_MAX_FREQ - LOG_MIN_FREQ)) *
        plotW +
      MARGIN_LEFT
    );
  }

  /** dB 値 → y 座標（CSS ピクセル）。MAX_DB が上、MIN_DB が下。 */
  private dbToY(db: number, plotH: number): number {
    // クランプ
    const clamped = db < MIN_DB ? MIN_DB : db > MAX_DB ? MAX_DB : db;
    const t = (clamped - MIN_DB) / (MAX_DB - MIN_DB);
    return MARGIN_TOP + plotH * (1 - t);
  }

  // ==========================================================================
  // リサイズ・高DPI対応
  // ==========================================================================

  private handleResize(): void {
    const rect = this.spectrumCanvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;

    this.cssWidth = cssW;
    this.cssHeight = cssH;

    // 両 Canvas のバックバッファを物理ピクセルに設定
    for (const canvas of [this.spectrumCanvas, this.overlayCanvas]) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }

    // 描画は CSS ピクセル空間で扱う（ctx に dpr スケールを掛ける）
    this.spectrumCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // リサイズ後にオーバーレイも再描画
    this.formantsDirty = true;
  }
}
