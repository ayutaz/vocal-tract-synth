// ============================================================================
// FormantController — dirty フラグ + rAF ループ + throttle によるフォルマント計算
// ============================================================================

import { calculateFormants } from './formant-calculator';
import type { SpectrumDisplay } from '../ui/spectrum-display';

export class FormantController {
  private dirty = false;
  private lastUpdate = 0;
  private rafId = 0;
  private readonly interval = 80; // ~12fps

  constructor(
    private getAreas: () => Readonly<Float64Array>,
    private spectrumDisplay: SpectrumDisplay,
  ) {}

  /** 次の rAF tick でフォルマント再計算を要求 */
  schedule(): void {
    this.dirty = true;
  }

  /** rAF ループを開始（初回計算も即実行） */
  start(): void {
    this.schedule();
    this.tick(); // 初回実行
    this.rafId = requestAnimationFrame(this.loop);
  }

  /** rAF ループを停止 */
  stop(): void {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private loop = (): void => {
    this.tick();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private tick(): void {
    if (!this.dirty) return;
    const now = performance.now();
    if (now - this.lastUpdate < this.interval) return;
    this.dirty = false;
    this.lastUpdate = now;
    const result = calculateFormants(this.getAreas());
    this.spectrumDisplay.updateFormants(result.f1, result.f2, result.f3);
  }
}
