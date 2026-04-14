// ===== フォルマント周波数計算モジュール =====
//
// 声道の44区間断面積配列からフォルマント周波数（F1, F2, F3）を直接計算する。
// メインスレッドで実行される（AudioWorklet 内ではない）。
//
// 計算パイプライン:
//   44区間断面積 A[0..43] (唇=0, 声門=43)
//     → 連結管の伝達行列 (transmission matrix) を周波数ごとに積算
//     → |H(f)|^2 を 512 点で評価 (50-5000Hz)
//     → ローカルピーク検出 → フォルマント周波数抽出
//
// 各区間は長さ Δx = c/(2fs) の円筒管としてモデル化。
// 境界条件: 唇端=完全開放(圧力=0)、声門端=完全閉鎖(体積速度=0) の理想条件。
// 時間領域の KL フィルタ（LIP_REFLECTION=-0.85, GLOTTAL_REFLECTION=0.95）とは
// 異なる理想境界を使っているため、表示フォルマントと実音のスペクトルピークに
// 若干のずれが生じる。これは近似として許容する。
// 均一管では c/(4L) の奇数倍の共鳴（F1≈500, F2≈1500, F3≈2500 Hz）が生じる。
//
// 注: areasToReflectionCoeffs / reflectionToLpc は LPC 根探索方式の名残として
// エクスポートを維持（テスト済み）。Phase 5 でのLPCベース比較検証に使用予定。

import { SAMPLE_RATE } from '../types/index.js';

// ===== 型定義 =====

export interface FormantResult {
  f1: number;
  f2: number;
  f3: number;
  frequencies: number[];  // 全フォルマント周波数（昇順）
}

// ===== ステップ1: 断面積 → 反射係数 =====

/**
 * 44区間の断面積配列から43個の内部反射係数を計算する。
 * r[k] = (A[k+1] - A[k]) / (A[k+1] + A[k]), k = 0..42
 *
 * @param areas 長さ NUM_SECTIONS (44) の断面積配列（唇=0, 声門=43）
 * @returns 長さ 43 の反射係数配列
 */
export function areasToReflectionCoeffs(areas: ArrayLike<number>): Float64Array {
  const numCoeffs = areas.length - 1;
  const r = new Float64Array(numCoeffs);

  for (let k = 0; k < numCoeffs; k++) {
    const ak = areas[k]!;
    const ak1 = areas[k + 1]!;
    const sum = ak1 + ak;
    // 断面積は MIN_AREA (0.3) でクランプ済みのため sum > 0 だが、念のため防御
    if (sum < 1e-15) {
      r[k] = 0;
    } else {
      r[k] = (ak1 - ak) / sum;
    }
  }

  return r;
}

// ===== ステップ2: 反射係数 → LPC多項式 (step-up procedure) =====

/**
 * Levinson-Durbin の逆操作（step-up procedure）。
 * 反射係数の配列からLPC多項式の係数を生成する。
 *
 * @param r 長さ M の反射係数配列
 * @returns 長さ M+1 のLPC係数配列 (a[0]=1, a[1]..a[M])
 */
export function reflectionToLpc(r: Float64Array): Float64Array {
  const M = r.length;
  const a = new Float64Array(M + 1);
  a[0] = 1.0;

  // step-up: ステージ k = 0..M-1
  // 各ステージで a の更新は in-place で行えないため一時バッファを使用
  const tmp = new Float64Array(M + 1);

  for (let k = 0; k < M; k++) {
    const rk = r[k]!;

    // tmp に新しい係数をコピー
    tmp[0] = a[0]!; // 常に 1.0
    for (let j = 1; j <= k; j++) {
      tmp[j] = a[j]! + rk * a[k + 1 - j]!;
    }
    tmp[k + 1] = rk;

    // tmp → a にコピー
    for (let j = 0; j <= k + 1; j++) {
      a[j] = tmp[j]!;
    }
  }

  return a;
}

// ===== ステップ3: 伝達行列によるスペクトル評価 =====

/** スペクトル評価の周波数点数 */
const SPECTRUM_NUM_POINTS = 512;
/** スペクトル評価の下限周波数 (Hz) */
const SPECTRUM_FREQ_MIN = 50;
/** スペクトル評価の上限周波数 (Hz) */
const SPECTRUM_FREQ_MAX = 5000;

/**
 * 連結管モデルの伝達関数 |H(f)|^2 をスペクトル評価する。
 *
 * 各区間を長さ Δx = c/(2fs) の円筒管としてモデル化し、
 * 伝達行列（transmission matrix）を周波数ごとに積算する。
 *
 * 区間 k の伝達行列:
 *   T_k(ω) = [cos(ωτ),  j·Z_k·sin(ωτ)]
 *            [j/Z_k·sin(ωτ), cos(ωτ) ]
 * ここで Z_k = 1/A[k]（正規化音響インピーダンス）、τ = 1/(2·fs)。
 *
 * 開放端-閉端の境界条件のもとで H(f) = 1/|T_total[0][0]|。
 *
 * @param areas 断面積配列
 * @param numPoints 評価する周波数点数
 * @param fs サンプリング周波数
 * @returns 各周波数点での |H(f)|^2
 */
function evaluateTransferFunction(
  areas: ArrayLike<number>,
  numPoints: number,
  fs: number,
): Float64Array {
  const N = areas.length;
  const tau = 1 / (2 * fs); // 各区間の伝搬遅延 = Δx/c = 1/(2·fs)
  const magnitudes = new Float64Array(numPoints);

  for (let i = 0; i < numPoints; i++) {
    const freq = SPECTRUM_FREQ_MIN + (SPECTRUM_FREQ_MAX - SPECTRUM_FREQ_MIN) * i / (numPoints - 1);
    const omega = 2 * Math.PI * freq;
    const cosWT = Math.cos(omega * tau);
    const sinWT = Math.sin(omega * tau);

    // 累積伝達行列 T = T_0 * T_1 * ... * T_{N-1} (2x2 複素行列)
    // [aRe+j·aIm, bRe+j·bIm]
    // [cRe+j·cIm, dRe+j·dIm]
    let aRe = 1, aIm = 0, bRe = 0, bIm = 0;
    let cRe = 0, cIm = 0, dRe = 1, dIm = 0;

    for (let k = 0; k < N; k++) {
      const Zk = 1.0 / areas[k]!; // 正規化インピーダンス

      // 区間行列 S_k: 実部のみ cos, 虚部のみ sin の構造
      // S = [cosWT,       j·Zk·sinWT]
      //     [j/Zk·sinWT,  cosWT     ]
      const s01Im = Zk * sinWT;
      const s10Im = sinWT / Zk;

      // T_new = T_old * S_k (複素行列積)
      // s00 = cosWT + 0j, s01 = 0 + s01Im·j, s10 = 0 + s10Im·j, s11 = cosWT + 0j
      //
      // new_a = a*s00 + b*s10 = (aRe+j·aIm)*cosWT + (bRe+j·bIm)*j·s10Im
      //       = (aRe*cosWT - bIm*s10Im) + j·(aIm*cosWT + bRe*s10Im)
      const naRe = aRe * cosWT - bIm * s10Im;
      const naIm = aIm * cosWT + bRe * s10Im;
      // new_b = a*s01 + b*s11 = (aRe+j·aIm)*j·s01Im + (bRe+j·bIm)*cosWT
      //       = (-aIm*s01Im + bRe*cosWT) + j·(aRe*s01Im + bIm*cosWT)
      const nbRe = -aIm * s01Im + bRe * cosWT;
      const nbIm = aRe * s01Im + bIm * cosWT;
      // new_c = c*s00 + d*s10
      const ncRe = cRe * cosWT - dIm * s10Im;
      const ncIm = cIm * cosWT + dRe * s10Im;
      // new_d = c*s01 + d*s11
      const ndRe = -cIm * s01Im + dRe * cosWT;
      const ndIm = cRe * s01Im + dIm * cosWT;

      aRe = naRe; aIm = naIm;
      bRe = nbRe; bIm = nbIm;
      cRe = ncRe; cIm = ncIm;
      dRe = ndRe; dIm = ndIm;
    }

    // 声道伝達関数: |H(f)|^2 = 1/|T[0][0]|^2
    // T[0][0] の零点が声道の共鳴周波数（フォルマント）に対応する。
    magnitudes[i] = 1 / (aRe * aRe + aIm * aIm + 1e-30);
  }

  return magnitudes;
}

// ===== ステップ4: スペクトルピーク検出 → フォルマント周波数抽出 =====

/**
 * スペクトルのローカルピークを検出し、対応する周波数を昇順で返す。
 * 放物線補間によるサブサンプル精度のピーク位置推定を行う。
 *
 * @param magnitudes スペクトルの振幅配列
 * @param numPoints 周波数点数
 * @returns ピーク周波数の昇順配列
 */
function findSpectralPeaks(magnitudes: Float64Array, numPoints: number): number[] {
  const peaks: number[] = [];

  for (let i = 1; i < numPoints - 1; i++) {
    const prev = magnitudes[i - 1]!;
    const curr = magnitudes[i]!;
    const next = magnitudes[i + 1]!;

    // ローカルピーク: 前後の点より大きい
    if (curr > prev && curr > next) {
      // 放物線補間でピーク位置をサブサンプル精度で求める
      const denom = prev - 2 * curr + next;
      let peakIdx: number = i;
      if (Math.abs(denom) > 1e-30) {
        peakIdx = i + 0.5 * (prev - next) / denom;
      }
      const freq = SPECTRUM_FREQ_MIN + (SPECTRUM_FREQ_MAX - SPECTRUM_FREQ_MIN) * peakIdx / (numPoints - 1);
      peaks.push(freq);
    }
  }

  // 昇順ソート（基本的に既にソート済みだが念のため）
  peaks.sort((a, b) => a - b);
  return peaks;
}

// ===== エクスポートAPI =====

/**
 * 44区間の断面積配列からフォルマント周波数 (F1, F2, F3) を計算する。
 *
 * 計算パイプライン:
 *   断面積 A[0..N-1] → 連結管伝達行列の周波数応答を評価
 *   → |H(f)|^2 を 512 点で計算 (50-5000Hz)
 *   → ローカルピーク検出 → フォルマント周波数抽出
 *
 * 各区間は長さ Δx = c/(2·fs) の円筒管。開放端（唇）-閉端（声門）の
 * 境界条件により、均一管では c/(4L) の奇数倍の共鳴が生じる。
 *
 * @param areas 長さ NUM_SECTIONS (44) の断面積配列（唇=0, 声門=43）
 * @param sampleRate サンプリング周波数（デフォルト: 44100）
 * @returns フォルマント周波数 (F1, F2, F3) と全周波数リスト
 */
export function calculateFormants(
  areas: ArrayLike<number>,
  sampleRate: number = SAMPLE_RATE,
): FormantResult {
  // 入力検証
  if (areas.length < 2) {
    return { f1: 0, f2: 0, f3: 0, frequencies: [] };
  }

  // ステップ1-2: 伝達行列によるスペクトル評価
  const magnitudes = evaluateTransferFunction(areas, SPECTRUM_NUM_POINTS, sampleRate);

  // ステップ3: スペクトルピーク検出 → フォルマント周波数
  const frequencies = findSpectralPeaks(magnitudes, SPECTRUM_NUM_POINTS);

  return {
    f1: frequencies[0] ?? 0,
    f2: frequencies[1] ?? 0,
    f3: frequencies[2] ?? 0,
    frequencies,
  };
}
