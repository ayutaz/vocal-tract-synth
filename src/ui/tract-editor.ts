// ============================================================================
// 声道断面積エディタ (TractEditor)
// ----------------------------------------------------------------------------
// 16個の制御点をドラッグして声道断面積を操作する Canvas UI。
//
// - source of truth: 16要素 Float64Array（controlPoints）
// - 44区間 Float64Array（sectionAreas）は自然3次スプライン補間の導出値
// - ドラッグのたびにコールバックで 44区間を外部に通知し、Canvas を再描画
// - 高DPI対応（devicePixelRatio + ResizeObserver）
// ============================================================================

import {
  NUM_SECTIONS,
  NUM_CONTROL_POINTS,
  MIN_AREA,
  MAX_AREA,
  DEFAULT_AREA,
  type AreasChangeCallback,
} from '../types/index';

// ===== 描画・操作定数 =====

/** 制御点の描画半径（px） */
const POINT_DRAW_RADIUS = 8;
/** 制御点のヒット判定半径（px） */
const POINT_HIT_RADIUS = 15;

/** 描画時の外側マージン（px）— ラベル用の余白 */
const MARGIN_LEFT = 48;
const MARGIN_RIGHT = 24;
const MARGIN_TOP = 24;
const MARGIN_BOTTOM = 32;

// ===== 配色（style.css の配色に合わせた暗色テーマ） =====

const COLOR_BACKGROUND = '#16213e';
const COLOR_GRID = '#2a3a5e';
const COLOR_GRID_LABEL = '#6a7fa8';
const COLOR_CURVE = '#4cc9f0';
const COLOR_CURVE_FILL = 'rgba(76, 201, 240, 0.15)';
const COLOR_POINT = '#a0c4ff';
const COLOR_POINT_ACTIVE = '#ffd166';
const COLOR_AXIS_LABEL = '#a0c4ff';

// ============================================================================
// TractEditor クラス
// ============================================================================

export class TractEditor {
  // --- DOM / 描画 ---
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly onAreasChange: AreasChangeCallback;
  private readonly resizeObserver: ResizeObserver;

  // --- 状態（source of truth）---
  /** 16 制御点の断面積 [cm²]（唇=0, 声門=NUM_CONTROL_POINTS-1） */
  private readonly controlPoints: Float64Array;
  /** 44 区間の断面積 [cm²]（スプライン補間の導出値） */
  private readonly sectionAreas: Float64Array;

  // --- Canvas サイズ（CSSピクセル、描画座標系） ---
  private cssWidth = 0;
  private cssHeight = 0;

  // --- ドラッグ状態 ---
  private draggingIndex: number | null = null;
  private activePointerId: number | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    onAreasChange: AreasChangeCallback,
    private readonly onDragStart?: () => void,
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('TractEditor: Canvas 2D context が取得できませんでした');
    }
    this.ctx = ctx;
    this.onAreasChange = onAreasChange;

    // 初期状態: 均一管（全制御点に DEFAULT_AREA）
    this.controlPoints = new Float64Array(NUM_CONTROL_POINTS);
    this.controlPoints.fill(DEFAULT_AREA);
    this.sectionAreas = new Float64Array(NUM_SECTIONS);

    // 補間を実行して 44区間を初期化
    this.interpolateToSections();

    // サイズ追従（ResizeObserver）
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(canvas);

    // Pointer Events のハンドラ登録
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerUp);

    // 初回レイアウト・描画
    this.handleResize();
  }

  // ==========================================================================
  // 公開 API
  // ==========================================================================

  /**
   * 16制御点を外部から上書きする（母音プリセットの適用などで使用）。
   * 長さが不正な場合は何もしない。
   */
  setControlPoints(points: ArrayLike<number>): void {
    if (points.length !== NUM_CONTROL_POINTS) return;
    for (let i = 0; i < NUM_CONTROL_POINTS; i++) {
      this.controlPoints[i] = this.clampArea(points[i]!);
    }
    this.interpolateToSections();
    this.onAreasChange(this.sectionAreas);
    this.draw();
  }

  /** 16制御点の現在値を返す（コピーではなく読み取り専用ビュー） */
  getControlPoints(): Readonly<Float64Array> {
    return this.controlPoints;
  }

  /** 44区間の現在値を返す（コピーではなく読み取り専用ビュー） */
  getSectionAreas(): Readonly<Float64Array> {
    return this.sectionAreas;
  }

  /** リソース解放（イベント・オブザーバ解除） */
  destroy(): void {
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerUp);
  }

  // ==========================================================================
  // スプライン補間（自然3次スプライン: 16制御点 → 44区間）
  // ==========================================================================

  /**
   * 自然3次スプラインで 16制御点 → 44区間を補間し、sectionAreas を更新する。
   *
   * - 16制御点の x座標を [0, NUM_SECTIONS-1] に等間隔マッピング
   * - 各44区間の中心 x を補間位置として評価
   * - 結果を MIN_AREA〜MAX_AREA にクランプ
   */
  private interpolateToSections(): void {
    const xs = TractEditor.controlPointXs(NUM_CONTROL_POINTS, NUM_SECTIONS);
    const m = TractEditor.computeNaturalSplineSecondDerivatives(
      xs,
      this.controlPoints,
    );
    TractEditor.evaluateSplineAtSections(
      xs,
      this.controlPoints,
      m,
      NUM_SECTIONS,
      this.sectionAreas,
    );
    // クランプ
    for (let i = 0; i < NUM_SECTIONS; i++) {
      const v = this.sectionAreas[i]!;
      if (v < MIN_AREA) this.sectionAreas[i] = MIN_AREA;
      else if (v > MAX_AREA) this.sectionAreas[i] = MAX_AREA;
    }
  }

  /**
   * 制御点の x座標を計算する（外部テスト可能な静的メソッド）。
   * [0, numSections-1] 区間に等間隔で numControlPoints 個を配置する。
   */
  static controlPointXs(
    numControlPoints: number,
    numSections: number,
  ): Float64Array {
    const xs = new Float64Array(numControlPoints);
    if (numControlPoints === 1) {
      xs[0] = 0;
      return xs;
    }
    const step = (numSections - 1) / (numControlPoints - 1);
    for (let i = 0; i < numControlPoints; i++) {
      xs[i] = i * step;
    }
    return xs;
  }

  /**
   * 自然3次スプラインの各節点での2階微分（m_i）を計算する。
   *
   * 境界条件は m_0 = m_{n-1} = 0 の自然スプライン。
   * トーマスアルゴリズム（三重対角行列の前進消去＋後退代入）で解く。
   *
   * @param xs  節点の x座標（長さ n, 昇順）
   * @param ys  節点の y座標（長さ n）
   * @returns   各節点での2階微分の配列（長さ n）
   */
  static computeNaturalSplineSecondDerivatives(
    xs: ArrayLike<number>,
    ys: ArrayLike<number>,
  ): Float64Array {
    const n = xs.length;
    const m = new Float64Array(n);
    if (n <= 2) {
      // 端点のみ、または2点のみ → 線形補間（m は全て 0）
      return m;
    }

    // 三重対角系 A m = b を解く
    //   A[i,i-1] = h_{i-1},  A[i,i] = 2(h_{i-1}+h_i),  A[i,i+1] = h_i
    //   b[i] = 6 * ((y_{i+1}-y_i)/h_i - (y_i - y_{i-1})/h_{i-1})
    // i = 1..n-2 について（端点は m_0=m_{n-1}=0 で固定）
    const h = new Float64Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      h[i] = xs[i + 1]! - xs[i]!;
    }

    // トーマス法の作業配列
    const c = new Float64Array(n); // 上側対角（書き換え）
    const d = new Float64Array(n); // 右辺（書き換え）

    // 端点の m は 0 固定
    m[0] = 0;
    m[n - 1] = 0;

    if (n === 3) {
      // 中点1個だけを直接解く
      const h0 = h[0]!;
      const h1 = h[1]!;
      const rhs =
        6 * ((ys[2]! - ys[1]!) / h1 - (ys[1]! - ys[0]!) / h0);
      m[1] = rhs / (2 * (h0 + h1));
      return m;
    }

    // 前進消去
    // 最初の中間行 i=1
    {
      const h0 = h[0]!;
      const h1 = h[1]!;
      const b0 = 2 * (h0 + h1);
      const rhs =
        6 * ((ys[2]! - ys[1]!) / h1 - (ys[1]! - ys[0]!) / h0);
      c[1] = h1 / b0;
      d[1] = rhs / b0;
    }
    for (let i = 2; i < n - 1; i++) {
      const hPrev = h[i - 1]!;
      const hCurr = h[i]!;
      const b = 2 * (hPrev + hCurr);
      const rhs =
        6 *
        ((ys[i + 1]! - ys[i]!) / hCurr - (ys[i]! - ys[i - 1]!) / hPrev);
      const denom = b - hPrev * c[i - 1]!;
      c[i] = hCurr / denom;
      d[i] = (rhs - hPrev * d[i - 1]!) / denom;
    }

    // 後退代入（m[n-1] = 0 を使う）
    m[n - 2] = d[n - 2]!;
    for (let i = n - 3; i >= 1; i--) {
      m[i] = d[i]! - c[i]! * m[i + 1]!;
    }

    return m;
  }

  /**
   * スプラインを各区間の中心（0..numSections-1 の整数格子）で評価し、
   * out に書き込む。
   *
   * 区間 i（xs[i] <= x <= xs[i+1]）上では:
   *   S_i(x) = m_i  * (xs[i+1] - x)^3 / (6 h_i)
   *          + m_{i+1} * (x - xs[i])^3 / (6 h_i)
   *          + (y_i / h_i - m_i h_i / 6) * (xs[i+1] - x)
   *          + (y_{i+1} / h_i - m_{i+1} h_i / 6) * (x - xs[i])
   */
  static evaluateSplineAtSections(
    xs: ArrayLike<number>,
    ys: ArrayLike<number>,
    m: ArrayLike<number>,
    numSections: number,
    out: Float64Array,
  ): void {
    const n = xs.length;
    let seg = 0; // 現在どの区間にいるか（x に対して単調増加）
    for (let k = 0; k < numSections; k++) {
      const x = k; // 区間中心は整数 k で代表する（0..numSections-1）
      // x を含む区間を探す
      while (seg < n - 2 && x > xs[seg + 1]!) seg++;

      const x0 = xs[seg]!;
      const x1 = xs[seg + 1]!;
      const y0 = ys[seg]!;
      const y1 = ys[seg + 1]!;
      const m0 = m[seg]!;
      const m1 = m[seg + 1]!;
      const h = x1 - x0;

      if (h <= 0) {
        out[k] = y0;
        continue;
      }

      const a = x1 - x;
      const b = x - x0;

      const value =
        (m0 * a * a * a) / (6 * h) +
        (m1 * b * b * b) / (6 * h) +
        (y0 / h - (m0 * h) / 6) * a +
        (y1 / h - (m1 * h) / 6) * b;

      out[k] = value;
    }
  }

  // ==========================================================================
  // Pointer イベント
  // ==========================================================================

  private handlePointerDown = (ev: PointerEvent): void => {
    // 既に別のポインタでドラッグ中なら無視
    if (this.activePointerId !== null) return;

    const [px, py] = this.getLocalPointerPos(ev);
    const idx = this.hitTestControlPoint(px, py);
    if (idx === null) return;

    this.draggingIndex = idx;
    this.activePointerId = ev.pointerId;
    this.canvas.setPointerCapture(ev.pointerId);
    ev.preventDefault();

    // ドラッグ開始をコールバックで通知
    this.onDragStart?.();

    // ドラッグ開始直後に値を更新（クリックだけでも反応）
    this.updateFromPointer(py);
  };

  private handlePointerMove = (ev: PointerEvent): void => {
    if (
      this.draggingIndex === null ||
      ev.pointerId !== this.activePointerId
    ) {
      return;
    }
    const [, py] = this.getLocalPointerPos(ev);
    this.updateFromPointer(py);
    ev.preventDefault();
  };

  private handlePointerUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.activePointerId) return;
    this.draggingIndex = null;
    this.activePointerId = null;
    if (this.canvas.hasPointerCapture(ev.pointerId)) {
      this.canvas.releasePointerCapture(ev.pointerId);
    }
    // ドラッグ終了後もハイライトを消すため再描画
    this.draw();
  };

  /**
   * ドラッグ中のポインタY座標（CSSピクセル）から制御点を更新する。
   * 16制御点 → 44区間補間 → コールバック通知 → 再描画 を一貫して行う。
   */
  private updateFromPointer(py: number): void {
    if (this.draggingIndex === null) return;

    const area = this.clampArea(this.yToArea(py));
    this.controlPoints[this.draggingIndex] = area;
    this.interpolateToSections();
    this.onAreasChange(this.sectionAreas);
    this.draw();
  }

  /**
   * イベント座標を Canvas のローカル CSS ピクセル座標（左上=0,0）に変換。
   */
  private getLocalPointerPos(ev: PointerEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [ev.clientX - rect.left, ev.clientY - rect.top];
  }

  /**
   * 任意の (px, py) 座標に最も近い制御点を POINT_HIT_RADIUS 以内で探す。
   * 見つからなければ null。
   */
  private hitTestControlPoint(px: number, py: number): number | null {
    let bestIdx: number | null = null;
    let bestDist = POINT_HIT_RADIUS * POINT_HIT_RADIUS;
    for (let i = 0; i < NUM_CONTROL_POINTS; i++) {
      const cx = this.controlPointScreenX(i);
      const cy = this.areaToY(this.controlPoints[i]!);
      const dx = px - cx;
      const dy = py - cy;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < bestDist) {
        bestDist = dist2;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  // ==========================================================================
  // 座標変換（データ ↔ 画面）
  // ==========================================================================

  /** 制御点インデックス i の画面X座標（CSSピクセル） */
  private controlPointScreenX(i: number): number {
    const plotW = this.cssWidth - MARGIN_LEFT - MARGIN_RIGHT;
    if (NUM_CONTROL_POINTS <= 1) return MARGIN_LEFT + plotW * 0.5;
    return MARGIN_LEFT + (plotW * i) / (NUM_CONTROL_POINTS - 1);
  }

  /** 区間インデックス k (0..NUM_SECTIONS-1) の画面X座標 */
  private sectionScreenX(k: number): number {
    const plotW = this.cssWidth - MARGIN_LEFT - MARGIN_RIGHT;
    if (NUM_SECTIONS <= 1) return MARGIN_LEFT + plotW * 0.5;
    return MARGIN_LEFT + (plotW * k) / (NUM_SECTIONS - 1);
  }

  /** 断面積 [cm²] → 画面Y座標。MAX_AREA が上、MIN_AREA が下。 */
  private areaToY(area: number): number {
    const plotH = this.cssHeight - MARGIN_TOP - MARGIN_BOTTOM;
    const t = (area - MIN_AREA) / (MAX_AREA - MIN_AREA);
    return MARGIN_TOP + plotH * (1 - t);
  }

  /** 画面Y座標 → 断面積 [cm²]（クランプ前の生値） */
  private yToArea(y: number): number {
    const plotH = this.cssHeight - MARGIN_TOP - MARGIN_BOTTOM;
    const t = 1 - (y - MARGIN_TOP) / plotH;
    return MIN_AREA + t * (MAX_AREA - MIN_AREA);
  }

  private clampArea(v: number): number {
    if (!Number.isFinite(v)) return DEFAULT_AREA;
    if (v < MIN_AREA) return MIN_AREA;
    if (v > MAX_AREA) return MAX_AREA;
    return v;
  }

  // ==========================================================================
  // リサイズ・高DPI対応
  // ==========================================================================

  private handleResize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;

    this.cssWidth = cssW;
    this.cssHeight = cssH;

    // バックバッファは物理ピクセル
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);

    // 描画は CSS ピクセル空間で扱う（ctx に dpr スケールを掛ける）
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.draw();
  }

  // ==========================================================================
  // 描画
  // ==========================================================================

  private draw(): void {
    const ctx = this.ctx;
    const w = this.cssWidth;
    const h = this.cssHeight;

    // --- 背景 ---
    ctx.fillStyle = COLOR_BACKGROUND;
    ctx.fillRect(0, 0, w, h);

    // --- グリッド ---
    this.drawGrid();

    // --- 軸ラベル（唇/声門） ---
    ctx.fillStyle = COLOR_AXIS_LABEL;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText('唇', MARGIN_LEFT, h - 4);
    ctx.textAlign = 'right';
    ctx.fillText('声門', w - MARGIN_RIGHT, h - 4);

    // --- 補間曲線（44区間） ---
    this.drawCurve();

    // --- 制御点（16個） ---
    this.drawControlPoints();
  }

  private drawGrid(): void {
    const ctx = this.ctx;
    const w = this.cssWidth;
    const h = this.cssHeight;

    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();

    // 垂直グリッド（制御点ごと）
    for (let i = 0; i < NUM_CONTROL_POINTS; i++) {
      const x = this.controlPointScreenX(i);
      ctx.moveTo(x, MARGIN_TOP);
      ctx.lineTo(x, h - MARGIN_BOTTOM);
    }

    // 水平グリッド（面積値: 0, 2, 4, 6, 8, 10）
    const gridAreas = [0, 2, 4, 6, 8, 10];
    for (const a of gridAreas) {
      const yClamped = Math.max(MIN_AREA, a);
      const y = this.areaToY(yClamped);
      ctx.moveTo(MARGIN_LEFT, y);
      ctx.lineTo(w - MARGIN_RIGHT, y);
    }

    ctx.stroke();

    // --- 水平グリッドの値ラベル ---
    ctx.fillStyle = COLOR_GRID_LABEL;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (const a of gridAreas) {
      if (a < MIN_AREA) continue;
      const y = this.areaToY(a);
      ctx.fillText(`${a}`, MARGIN_LEFT - 6, y);
    }

    // 左上にユニットラベル
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLOR_GRID_LABEL;
    ctx.fillText('cm²', 6, 6);
  }

  private drawCurve(): void {
    const ctx = this.ctx;

    // 44区間の折れ線
    ctx.beginPath();
    for (let k = 0; k < NUM_SECTIONS; k++) {
      const x = this.sectionScreenX(k);
      const y = this.areaToY(this.sectionAreas[k]!);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    // 塗りつぶし用のパスを作るため、ベースラインまで閉じる
    const baselineY = this.areaToY(MIN_AREA);
    const lastX = this.sectionScreenX(NUM_SECTIONS - 1);
    const firstX = this.sectionScreenX(0);

    ctx.save();
    ctx.lineTo(lastX, baselineY);
    ctx.lineTo(firstX, baselineY);
    ctx.closePath();
    ctx.fillStyle = COLOR_CURVE_FILL;
    ctx.fill();
    ctx.restore();

    // 線だけ上書き描画
    ctx.beginPath();
    for (let k = 0; k < NUM_SECTIONS; k++) {
      const x = this.sectionScreenX(k);
      const y = this.areaToY(this.sectionAreas[k]!);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = COLOR_CURVE;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  private drawControlPoints(): void {
    const ctx = this.ctx;
    for (let i = 0; i < NUM_CONTROL_POINTS; i++) {
      const cx = this.controlPointScreenX(i);
      const cy = this.areaToY(this.controlPoints[i]!);
      const isActive = this.draggingIndex === i;

      ctx.beginPath();
      ctx.arc(cx, cy, POINT_DRAW_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? COLOR_POINT_ACTIVE : COLOR_POINT;
      ctx.fill();

      // 縁取り
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = COLOR_BACKGROUND;
      ctx.stroke();
    }
  }
}
