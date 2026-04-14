// ===== メロディ生成 =====
// ペンタトニック音階での1次マルコフ連鎖 + 音楽理論制約

/** MIDIノート番号 → Hz 変換 */
export function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** ペンタトニック音階（C3〜E5） */
const PENTATONIC_NOTES: readonly number[] = [
  48, 50, 52, 55, 57,  // C3, D3, E3, G3, A3
  60, 62, 64, 67, 69,  // C4, D4, E4, G4, A4
  72, 74, 76            // C5, D5, E5
];

/** フレーズ末収束先（ルートCまたは5度G） */
const PHRASE_END_TARGETS: readonly number[] = [48, 55, 60, 67, 72];

/** 大跳躍とみなす閾値（半音数） */
const LARGE_LEAP_THRESHOLD = 4;

/** 最大跳躍幅（完全5度 = 7半音） */
const MAX_INTERVAL = 7;

/** 順次進行（隣接音）の選択確率 */
const STEPWISE_PROBABILITY = 0.55;

export interface MelodyEvent {
  midiNote: number;
  frequency: number;          // Hz
  intervalFromPrev: number;   // 半音数（符号付き）
}

export class MelodyGenerator {
  private readonly rng: () => number;
  private currentIndex: number;
  private prevInterval: number;

  constructor(rng?: () => number) {
    this.rng = rng ?? Math.random;
    // 中央付近（C4 = index 5）から開始
    this.currentIndex = 5;
    this.prevInterval = 0;
  }

  /** 次の音符を生成 */
  nextNote(isApproachingPhraseEnd: boolean): MelodyEvent {
    const prevNote = PENTATONIC_NOTES[this.currentIndex]!;

    let nextIndex: number;

    if (isApproachingPhraseEnd) {
      nextIndex = this.selectPhraseEndNote();
    } else {
      nextIndex = this.selectNextIndex();
    }

    const nextNote = PENTATONIC_NOTES[nextIndex]!;
    const interval = nextNote - prevNote;

    this.prevInterval = interval;
    this.currentIndex = nextIndex;

    return {
      midiNote: nextNote,
      frequency: midiToFreq(nextNote),
      intervalFromPrev: interval,
    };
  }

  /** 状態をリセット */
  reset(): void {
    this.currentIndex = 5;
    this.prevInterval = 0;
  }

  /** 通常のメロディ進行（マルコフ連鎖 + 音楽理論制約） */
  private selectNextIndex(): number {
    const candidates = this.buildCandidates();

    if (candidates.length === 0) {
      // フォールバック: 現在位置に留まる
      return this.currentIndex;
    }

    // 確率分布を構築
    const weights = this.assignWeights(candidates);
    return this.weightedSelect(candidates, weights);
  }

  /** フレーズ末: ルート(C)または5度(G)に収束 */
  private selectPhraseEndNote(): number {
    // 収束先候補のうち、最大跳躍幅以内のものを選ぶ
    const currentNote = PENTATONIC_NOTES[this.currentIndex]!;
    const reachableTargets: number[] = [];

    for (const target of PHRASE_END_TARGETS) {
      if (Math.abs(target - currentNote) <= MAX_INTERVAL) {
        reachableTargets.push(target);
      }
    }

    // 到達可能な収束先がない場合、最も近い収束先を選ぶ
    if (reachableTargets.length === 0) {
      let closestTarget = PHRASE_END_TARGETS[0]!;
      let closestDist = Math.abs(closestTarget - currentNote);
      for (const target of PHRASE_END_TARGETS) {
        const dist = Math.abs(target - currentNote);
        if (dist < closestDist) {
          closestDist = dist;
          closestTarget = target;
        }
      }
      reachableTargets.push(closestTarget);
    }

    // 最も近い収束先を優先（距離に反比例した重み）
    const weights = reachableTargets.map(target => {
      const dist = Math.abs(target - currentNote);
      return dist === 0 ? 2 : 1 / dist;
    });

    const selectedNote = this.weightedSelectValue(reachableTargets, weights);
    return PENTATONIC_NOTES.indexOf(selectedNote);
  }

  /** 音楽理論制約を満たす候補インデックスを構築 */
  private buildCandidates(): number[] {
    const currentNote = PENTATONIC_NOTES[this.currentIndex]!;
    const hadLargeLeap = Math.abs(this.prevInterval) >= LARGE_LEAP_THRESHOLD;
    const candidates: number[] = [];

    for (let i = 0; i < PENTATONIC_NOTES.length; i++) {
      if (i === this.currentIndex) continue;

      const note = PENTATONIC_NOTES[i]!;
      const interval = note - currentNote;

      // 跳躍幅制限: 最大7半音
      if (Math.abs(interval) > MAX_INTERVAL) continue;

      // 大跳躍後反進行: 前回4半音以上跳躍したら逆方向に制限
      if (hadLargeLeap) {
        if (this.prevInterval > 0 && interval > 0) continue;
        if (this.prevInterval < 0 && interval < 0) continue;
      }

      candidates.push(i);
    }

    return candidates;
  }

  /** 候補に重みを割り当て（順次進行優先） */
  private assignWeights(candidates: number[]): number[] {
    // 隣接音の数をforループでカウント（filter()のGC回避）
    let stepwiseCount = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (Math.abs(candidates[i]! - this.currentIndex) === 1) stepwiseCount++;
    }
    const stepwiseWeight = STEPWISE_PROBABILITY / Math.min(stepwiseCount, 2);

    const weights: number[] = [];
    for (const candidateIdx of candidates) {
      const indexDist = Math.abs(candidateIdx - this.currentIndex);
      if (indexDist === 1) {
        weights.push(stepwiseWeight);
      } else if (indexDist === 2) {
        weights.push(0.15);
      } else {
        weights.push(0.05);
      }
    }
    return weights;
  }

  /** 重み付き選択（インデックス配列） */
  private weightedSelect(candidates: number[], weights: number[]): number {
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    let r = this.rng() * totalWeight;

    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i]!;
      if (r <= 0) return candidates[i]!;
    }

    // 浮動小数点誤差のフォールバック
    return candidates[candidates.length - 1]!;
  }

  /** 重み付き選択（値配列） */
  private weightedSelectValue(values: number[], weights: number[]): number {
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    let r = this.rng() * totalWeight;

    for (let i = 0; i < values.length; i++) {
      r -= weights[i]!;
      if (r <= 0) return values[i]!;
    }

    return values[values.length - 1]!;
  }
}
