// ===== 母音プリセット & 遷移マネージャ =====
//
// 5母音 + neutral のプリセット断面積データ（16制御点、cm²）と、
// プリセット間をコサイン補間で滑らかに遷移する TransitionManager を提供する。
//
// 制御点 index 規約: 0 が唇側、15 が声門側。

import { NUM_CONTROL_POINTS, DEFAULT_AREA, type VowelId, type VowelPreset } from '../types/index';

// ---------------------------------------------------------------------------
// 断面積プリセットデータ (16 制御点, cm², 唇 index=0 → 声門 index=15)
// ---------------------------------------------------------------------------

const VOWEL_DATA: Record<VowelId, number[]> = {
  a: [5.0, 5.0, 5.5, 8.0, 8.0, 7.0, 4.0, 2.0, 1.0, 0.7, 0.8, 1.5, 2.0, 3.0, 3.5, 2.5],
  i: [1.0, 0.5, 0.4, 0.3, 0.5, 1.0, 3.0, 5.0, 6.5, 6.0, 5.5, 4.5, 3.5, 2.5, 2.0, 1.5],
  u: [0.5, 0.5, 1.0, 2.5, 4.0, 5.0, 4.0, 2.0, 0.5, 0.4, 0.5, 1.5, 3.0, 3.5, 3.0, 2.0],
  e: [2.5, 2.0, 1.0, 0.8, 1.0, 2.0, 4.0, 5.5, 6.0, 5.5, 5.0, 4.0, 3.0, 2.5, 2.0, 1.5],
  o: [0.8, 1.0, 2.0, 4.0, 6.0, 7.0, 6.0, 4.0, 2.0, 1.0, 1.5, 2.5, 3.5, 4.0, 3.5, 2.5],
  neutral: [4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0],
};

// ---------------------------------------------------------------------------
// フォルマント目標値 (Phase 3 チューニング検証用)
// ---------------------------------------------------------------------------

const TARGET_FORMANTS: Partial<Record<VowelId, { f1: number; f2: number; f3: number }>> = {
  a: { f1: 800, f2: 1300, f3: 2500 },
  i: { f1: 300, f2: 2300, f3: 3000 },
  u: { f1: 350, f2: 1400, f3: 2500 },
  e: { f1: 500, f2: 1900, f3: 2600 },
  o: { f1: 500, f2: 800, f3: 2500 },
};

// ---------------------------------------------------------------------------
// ラベルマップ
// ---------------------------------------------------------------------------

const VOWEL_LABELS: Record<VowelId, string> = {
  a: 'あ',
  i: 'い',
  u: 'う',
  e: 'え',
  o: 'お',
  neutral: 'Flat',
};

// ---------------------------------------------------------------------------
// プリセット配列（Readonly でエクスポート）
// ---------------------------------------------------------------------------

const VOWEL_IDS: readonly VowelId[] = ['a', 'i', 'u', 'e', 'o', 'neutral'] as const;

export const VOWEL_PRESETS: ReadonlyArray<VowelPreset> = VOWEL_IDS.map((id) => ({
  id,
  label: VOWEL_LABELS[id],
  controlPoints: [...VOWEL_DATA[id]],
  targetFormants: TARGET_FORMANTS[id],
}));

/** ID からプリセットを取得する */
export function getPresetById(id: VowelId): VowelPreset | undefined {
  return VOWEL_PRESETS.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// TransitionManager — コサイン補間によるプリセット遷移
// ---------------------------------------------------------------------------

/** デフォルト遷移時間 (ms) */
const DEFAULT_DURATION_MS = 150;

export class TransitionManager {
  // 遷移中の開始・終了スナップショット
  private startPoints: Float64Array;
  private targetPoints: Float64Array;
  // 補間結果を書き込む内部バッファ
  private interpolatedPoints: Float64Array;

  // 遷移タイミング
  private startTime = 0;
  private duration = 0;
  private transitioning = false;

  // rAF ハンドル
  private rafId = 0;

  constructor(
    private getCurrentPoints: () => Readonly<Float64Array>,  // 現在値の取得
    private onUpdate: (points: Float64Array) => void,        // 更新通知
  ) {
    this.startPoints = new Float64Array(NUM_CONTROL_POINTS);
    this.targetPoints = new Float64Array(NUM_CONTROL_POINTS);
    this.interpolatedPoints = new Float64Array(NUM_CONTROL_POINTS);
  }

  // ----- 公開 API -----

  /** 指定プリセットへ遷移開始 */
  transitionTo(targetId: VowelId, durationMs: number = DEFAULT_DURATION_MS): void {
    const preset = getPresetById(targetId);
    if (!preset) return;
    this.transitionToCustom(preset.controlPoints, durationMs);
  }

  /** 任意の断面積配列への遷移 */
  transitionToCustom(target: ArrayLike<number>, durationMs: number = DEFAULT_DURATION_MS): void {
    // 現在の制御点をスナップショットとして取得
    const current = this.getCurrentPoints();
    // 現在の制御点を遷移開始地点としてコピー
    this.startPoints.set(current);
    // 目標値をコピー
    for (let i = 0; i < NUM_CONTROL_POINTS; i++) {
      this.targetPoints[i] = (i < target.length ? target[i] : current[i]) ?? DEFAULT_AREA;
    }

    this.startTime = performance.now();
    this.duration = durationMs;
    this.transitioning = true;

    // rAF ループが未起動なら開始
    if (this.rafId === 0) {
      this.scheduleUpdate();
    }
  }

  /** 遷移中かどうか */
  isTransitioning(): boolean {
    return this.transitioning;
  }

  /**
   * rAF ループで毎フレーム呼ばれる — コサイン補間値を計算して onUpdate を呼ぶ。
   * 外部から手動で呼ぶことも可能。
   */
  update(): void {
    if (!this.transitioning) return;

    const now = performance.now();
    const elapsed = now - this.startTime;
    const tLinear = Math.min(elapsed / this.duration, 1);

    // コサイン補間: ease-in/ease-out
    const tSmooth = 0.5 * (1 - Math.cos(Math.PI * tLinear));

    for (let i = 0; i < NUM_CONTROL_POINTS; i++) {
      this.interpolatedPoints[i] =
        (1 - tSmooth) * (this.startPoints[i] ?? 0) + tSmooth * (this.targetPoints[i] ?? 0);
    }

    this.onUpdate(this.interpolatedPoints);

    // 遷移完了判定
    if (tLinear >= 1) {
      this.transitioning = false;
      // rAF ループを停止（次の transitionTo で再開）
      if (this.rafId !== 0) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
    }
  }

  /** 遷移を即座に完了させる (Auto Sing 中断時等) */
  cancelTransition(): void {
    if (!this.transitioning) return;

    // 目標値を即座に適用
    this.interpolatedPoints.set(this.targetPoints);
    this.onUpdate(this.interpolatedPoints);

    this.transitioning = false;
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  /** リソース解放 */
  destroy(): void {
    this.transitioning = false;
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  // ----- 内部 -----

  // rAF コールバック（bound method でクロージャ毎回生成を回避）
  private tick = (): void => {
    this.update();
    if (this.transitioning) {
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      this.rafId = 0;
    }
  };

  private scheduleUpdate(): void {
    this.rafId = requestAnimationFrame(this.tick);
  }
}
