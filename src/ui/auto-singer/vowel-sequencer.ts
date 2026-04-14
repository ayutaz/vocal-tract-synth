// ============================================================================
// VowelSequencer — 5母音のランダム選択（連続同母音回避）
// ----------------------------------------------------------------------------
// Auto Sing モードで使用する母音シーケンサー。
// 'a' | 'i' | 'u' | 'e' | 'o' の5母音からランダムに次の母音を選択し、
// 直前と同じ母音が連続しないことを保証する。
// ============================================================================

import type { VowelId } from '../../types/index';

// ===== 定数 =====

/** Auto Sing で使用する5母音（'neutral' は除外） */
const SINGABLE_VOWELS: readonly VowelId[] = ['a', 'i', 'u', 'e', 'o'];

// ===== VowelSequencer =====

export class VowelSequencer {
  private readonly rng: () => number;
  private lastVowel: VowelId | null = null;

  constructor(rng?: () => number) {
    this.rng = rng ?? Math.random;
  }

  /**
   * 次の母音を選択する（前回と異なる母音を保証）。
   *
   * 初回呼び出し時は5母音から等確率で選択。
   * 2回目以降は前回と異なる4母音から等確率で選択。
   */
  nextVowel(): VowelId {
    const n = SINGABLE_VOWELS.length; // 5
    if (this.lastVowel === null) {
      // 初回: 5母音から等確率
      const idx = Math.min(Math.floor(this.rng() * n), n - 1);
      this.lastVowel = SINGABLE_VOWELS[idx]!;
    } else {
      // 2回目以降: 前回を除く4母音から選択（filter不使用でGC回避）
      const idx = Math.min(Math.floor(this.rng() * (n - 1)), n - 2);
      let count = 0;
      for (let i = 0; i < n; i++) {
        if (SINGABLE_VOWELS[i] === this.lastVowel) continue;
        if (count === idx) {
          this.lastVowel = SINGABLE_VOWELS[i]!;
          break;
        }
        count++;
      }
    }
    return this.lastVowel;
  }

  /**
   * 状態をリセットする。次の nextVowel() は前回制約なしで選択される。
   */
  reset(): void {
    this.lastVowel = null;
  }
}
