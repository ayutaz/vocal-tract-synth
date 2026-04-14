// ===== リズムエンジン =====
// BPMベースのリズム生成（音符長確率分布 + マイクロタイミング）

/** 音符タイプと拍数の定義 */
interface NoteTypeDef {
  readonly name: string;
  readonly beats: number;
  readonly probability: number;
}

/** 音符長確率分布 */
const NOTE_TYPES: readonly NoteTypeDef[] = [
  { name: '8th',        beats: 0.5,   probability: 0.40 },
  { name: 'quarter',    beats: 1.0,   probability: 0.30 },
  { name: 'dotted-8th', beats: 0.75,  probability: 0.15 },
  { name: '16th',       beats: 0.25,  probability: 0.10 },
  { name: 'half',       beats: 2.0,   probability: 0.05 },
];

/** マイクロタイミング揺らぎの範囲 (ms) */
const MICRO_TIMING_MIN_MS = 5;
const MICRO_TIMING_MAX_MS = 15;

export interface RhythmEvent {
  durationMs: number;
  durationBeats: number;
  microTimingOffsetMs: number;  // +-5〜15ms
  noteType: string;
}

export class RhythmEngine {
  private readonly rng: () => number;

  constructor(rng?: () => number) {
    this.rng = rng ?? Math.random;
  }

  /** 次のリズムイベントを生成 */
  nextNote(bpm: number): RhythmEvent {
    // 音符タイプを確率分布に従って選択
    const noteType = this.selectNoteType();

    // 拍数 → ミリ秒変換: 1拍 = 60000/bpm ms
    const msPerBeat = 60000 / bpm;
    const durationMs = noteType.beats * msPerBeat;

    // マイクロタイミング揺らぎ
    const microTimingOffsetMs = this.generateMicroTiming();

    return {
      durationMs,
      durationBeats: noteType.beats,
      microTimingOffsetMs,
      noteType: noteType.name,
    };
  }

  /** 状態をリセット（将来の拡張用） */
  reset(): void {
    // 現時点ではステートレスだが、インターフェース統一のため定義
  }

  /** 確率分布に従って音符タイプを選択 */
  private selectNoteType(): NoteTypeDef {
    let r = this.rng();

    for (const noteType of NOTE_TYPES) {
      r -= noteType.probability;
      if (r <= 0) return noteType;
    }

    // 浮動小数点誤差のフォールバック
    return NOTE_TYPES[NOTE_TYPES.length - 1]!;
  }

  /** マイクロタイミング揺らぎを生成（+-5〜15ms） */
  private generateMicroTiming(): number {
    const range = MICRO_TIMING_MAX_MS - MICRO_TIMING_MIN_MS;
    const magnitude = MICRO_TIMING_MIN_MS + this.rng() * range;
    // 正負をランダムに決定
    const sign = this.rng() < 0.5 ? -1 : 1;
    return sign * magnitude;
  }
}
