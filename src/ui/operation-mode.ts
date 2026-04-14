// ============================================================================
// OperationModeManager — Phase 9 操作モード状態機械
// ----------------------------------------------------------------------------
// 3 値の排他状態機械 ('manual' | 'autoSing' | 'textRead') を管理する。
// - 初期値: 'manual'
// - 遷移可能経路:
//     manual <-> autoSing
//     manual <-> textRead
// - 禁止経路:
//     autoSing <-> textRead (必ず manual を経由)
//
// モード変更時は登録されたコールバックを発火し、main.ts 側から全 UI 要素の
// enable/disable 一括制御を行う (applyModeToUI 関数)。
//
// 複雑な UI 制御ロジック (どのコントロールを無効化するか) は本クラスの
// 責務外であり、onChange コールバックの受け側 (main.ts) に集約する。
// 本クラスは単純な状態機械としての最小責務のみを持つ。
// ============================================================================

import type { OperationMode } from '../types/index';

export type OperationModeChangeCallback = (
  mode: OperationMode,
  prev: OperationMode,
) => void;

export class OperationModeManager {
  private mode: OperationMode = 'manual';
  private callbacks: OperationModeChangeCallback[] = [];

  // ==========================================================================
  // 公開 API
  // ==========================================================================

  /** 現在のモードを取得する。 */
  getMode(): OperationMode {
    return this.mode;
  }

  /**
   * モード遷移を試みる。遷移不可能な場合は警告ログを出して何もしない。
   * 成功時は全コールバックを発火する。
   *
   * 同一モードへの遷移は no-op (コールバックも発火しない)。
   */
  setMode(target: OperationMode): void {
    if (target === this.mode) return;
    if (!this.canTransitionTo(target)) {
      console.warn(
        `OperationMode: invalid transition ${this.mode} -> ${target}`,
      );
      return;
    }
    const prev = this.mode;
    this.mode = target;
    for (const cb of this.callbacks) {
      cb(target, prev);
    }
  }

  /**
   * target への遷移が可能か判定する。
   * - 同一モード: true (no-op 扱い)
   * - manual から任意モードへ: true
   * - 任意モードから manual へ: true
   * - autoSing <-> textRead: false (必ず manual 経由)
   */
  canTransitionTo(target: OperationMode): boolean {
    if (target === this.mode) return true;
    if (this.mode === 'manual') return true;
    if (target === 'manual') return true;
    return false;
  }

  /** モード変更コールバックを登録する。 */
  onChange(cb: OperationModeChangeCallback): void {
    this.callbacks.push(cb);
  }

  /** 全コールバックを解除する。 */
  destroy(): void {
    this.callbacks = [];
  }
}
