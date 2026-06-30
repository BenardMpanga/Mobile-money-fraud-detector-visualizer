import { GroundTruth, Finding, PatternType } from '../domain/types';

export interface ScoreMetrics {
  precision: number;
  recall: number;
  f1: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  totalPlanted: number;
  totalFlagged: number;
}

export interface ValidationReport {
  overall: ScoreMetrics;
  smurfing: ScoreMetrics;
  rapidPassThrough: ScoreMetrics;
  circularFlow: ScoreMetrics;
}

function mapPatternTypeToKey(type: PatternType): keyof GroundTruth {
  if (type === 'smurfing') return 'smurfing';
  if (type === 'rapid_pass_through') return 'rapidPassThrough';
  return 'circularFlow';
}

export function evaluateDetection(
  findings: Finding[],
  groundTruth: GroundTruth
): ValidationReport {
  const evaluateForType = (type: PatternType): ScoreMetrics => {
    const findingsOfType = findings.filter(f => f.patternType === type);
    const gtKey = mapPatternTypeToKey(type);
    const plantedPatterns = groundTruth[gtKey] || [];

    const totalPlanted = plantedPatterns.length;
    const totalFlagged = findingsOfType.length;

    // Track which planted patterns were successfully detected
    const detectedPlantedIndices = new Set<number>();
    // Track which findings are true positives (match at least one planted pattern)
    let truePosFindingsCount = 0;

    findingsOfType.forEach(finding => {
      let isTruePositive = false;
      const findingTxIds = new Set(finding.transactionIds);

      plantedPatterns.forEach((planted, pIdx) => {
        // Overlap check: if they share at least one transaction ID, it is a true match
        const hasOverlap = planted.transactionIds.some(txId => findingTxIds.has(txId));
        if (hasOverlap) {
          detectedPlantedIndices.add(pIdx);
          isTruePositive = true;
        }
      });

      if (isTruePositive) {
        truePosFindingsCount++;
      }
    });

    const truePositives = detectedPlantedIndices.size; // Planted items that were found
    const falseNegatives = totalPlanted - truePositives; // Planted items missed
    const falsePositives = totalFlagged - truePosFindingsCount; // Findings that didn't match any planted pattern

    const precision = totalFlagged > 0 ? truePosFindingsCount / totalFlagged : 1.0;
    const recall = totalPlanted > 0 ? truePositives / totalPlanted : 1.0;
    const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0.0;

    return {
      precision,
      recall,
      f1,
      truePositives,
      falsePositives,
      falseNegatives,
      totalPlanted,
      totalFlagged,
    };
  };

  const smurfing = evaluateForType('smurfing');
  const rapidPassThrough = evaluateForType('rapid_pass_through');
  const circularFlow = evaluateForType('circular_flow');

  // Compute overall summary stats
  const totalPlanted = smurfing.totalPlanted + rapidPassThrough.totalPlanted + circularFlow.totalPlanted;
  const totalFlagged = smurfing.totalFlagged + rapidPassThrough.totalFlagged + circularFlow.totalFlagged;
  const truePositives = smurfing.truePositives + rapidPassThrough.truePositives + circularFlow.truePositives;
  const falsePositives = smurfing.falsePositives + rapidPassThrough.falsePositives + circularFlow.falsePositives;
  const falseNegatives = smurfing.falseNegatives + rapidPassThrough.falseNegatives + circularFlow.falseNegatives;

  // Weighted overall calculations
  const totalMatchedFindings = 
    (smurfing.totalFlagged - smurfing.falsePositives) +
    (rapidPassThrough.totalFlagged - rapidPassThrough.falsePositives) +
    (circularFlow.totalFlagged - circularFlow.falsePositives);

  const precision = totalFlagged > 0 ? totalMatchedFindings / totalFlagged : 1.0;
  const recall = totalPlanted > 0 ? truePositives / totalPlanted : 1.0;
  const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0.0;

  return {
    overall: {
      precision,
      recall,
      f1,
      truePositives,
      falsePositives,
      falseNegatives,
      totalPlanted,
      totalFlagged,
    },
    smurfing,
    rapidPassThrough,
    circularFlow,
  };
}
