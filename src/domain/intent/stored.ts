import type { Signal } from "./score";

/** A signal as stored in intent_scores.signals (dates as ISO strings). */
export type StoredSignal = Omit<Signal, "at"> & { at: string };

export function storeSignals(signals: Signal[]): StoredSignal[] {
  return signals.map((signal) => ({ ...signal, at: signal.at.toISOString() }));
}
