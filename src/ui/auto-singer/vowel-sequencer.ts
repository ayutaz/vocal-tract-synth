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
    // 前回と異なる候補を構築
    const candidates = this.lastVowel === null
      ? SINGABLE_VOWELS
      : SINGABLE_VOWELS.filter((v) => v !== this.lastVowel);

    // 等確率で選択
    const index = Math.floor(this.rng() * candidates.length);
    // rng() が 1.0 を返す極端なケースのガード
    const selected = candidates[Math.min(index, candidates.length - 1)]!;

    this.lastVowel = selected;
    return selected;
  }

  /**
   * 状態をリセットする。次の nextVowel() は前回制約なしで選択される。
   */
  reset(): void {
    this.lastVowel = null;
  }
}
