import { explain, type ContactInfo, type Explanation } from "./explain";
import {
  combine,
  detectSignals,
  levelFor,
  resolveWeights,
  type IntentFacts,
  type IntentLevel,
  type ScoreWeights,
  type Signal,
} from "./score";

export * from "./explain";
export * from "./score";

export interface IntentResult {
  score: number;
  level: IntentLevel;
  signals: Signal[];
  lastSignalAt: Date | null;
  explanation: Explanation;
}

/** Score, level, signals and explanation for one prospect (§7.6). */
export function computeIntent(input: {
  facts: IntentFacts;
  weights?: ScoreWeights;
  info: ContactInfo;
  now: Date;
  timeZone: string;
}): IntentResult {
  const { facts, now, timeZone } = input;
  const dayOf = (date: Date) => date.toLocaleDateString("de-DE", { timeZone });
  const signals = detectSignals(facts, resolveWeights(input.weights), dayOf);
  const score = combine(signals);
  const lastSignalAt = signals.reduce<Date | null>(
    (latest, signal) => (!latest || signal.at > latest ? signal.at : latest),
    null,
  );
  return {
    score,
    level: levelFor(score),
    signals,
    lastSignalAt,
    explanation: explain({
      score,
      signals,
      info: input.info,
      visitStarts: facts.visits.map((visit) => visit.startedAt),
      now,
      timeZone,
    }),
  };
}
