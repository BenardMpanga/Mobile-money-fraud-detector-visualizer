import { TransactionGraph, Finding, DetectionConfig } from '../domain/types';
import { detectSmurfing } from './smurfing';
import { detectPassThrough } from './passthrough';
import { detectCircularFlow } from './circular';

export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  smurfingWindowSeconds: 48 * 3600, // 48 hours
  smurfingMinCount: 10,
  smurfingReportingThreshold: 1000000, // 1,000,000 reporting threshold
  smurfingTotalMultiplier: 1.0, // sum must be at least 1x of threshold

  passThroughWindowSeconds: 30 * 60, // 30 minutes
  passThroughAmountTolerance: 0.05, // ±5% amount match
  passThroughMaxChainLength: 4,

  circularWindowSeconds: 72 * 3600, // 72 hours
  circularMinLen: 3,
  circularMaxLen: 6,
  circularSkimTolerance: 0.05, // 5% max drop per hop
};

export function runDetection(
  graph: TransactionGraph,
  config: DetectionConfig = DEFAULT_DETECTION_CONFIG
): Finding[] {
  const smurfingFindings = detectSmurfing(graph, config);
  const passThroughFindings = detectPassThrough(graph, config);
  const circularFindings = detectCircularFlow(graph, config);

  // Return all findings combined, sorted by confidence score (highest first)
  return [
    ...smurfingFindings,
    ...passThroughFindings,
    ...circularFindings,
  ].sort((a, b) => b.score - a.score);
}
