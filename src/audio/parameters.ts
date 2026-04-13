// ===== AudioParam 定義の共有モジュール =====
//
// AudioWorkletProcessor の static get parameterDescriptors() で使用する定義を
// メインスレッド / Worklet 両方から参照できるように切り出しておく。
// Phase 2 以降でパラメータを追加する際にもここを更新するだけで済む。
//
// TypeScript の lib.dom.d.ts には AudioParamDescriptor 型が含まれていないため、
// 自前で型を定義する。

import { DEFAULT_F0, MIN_F0, MAX_F0 } from '../types/index.js';

export interface VocalTractParamDescriptor {
  name: string;
  defaultValue?: number;
  minValue?: number;
  maxValue?: number;
  automationRate?: 'a-rate' | 'k-rate';
}

export const VOCAL_TRACT_PARAMETER_DESCRIPTORS: VocalTractParamDescriptor[] = [
  {
    name: 'frequency',
    defaultValue: DEFAULT_F0,
    minValue: MIN_F0,
    maxValue: MAX_F0,
    automationRate: 'k-rate',
  },
];
