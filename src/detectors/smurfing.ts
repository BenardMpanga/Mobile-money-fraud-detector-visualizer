import { TransactionGraph, Finding, DetectionConfig, Transaction } from '../domain/types';

export function detectSmurfing(graph: TransactionGraph, config: DetectionConfig): Finding[] {
  const findings: Finding[] = [];
  const {
    smurfingWindowSeconds,
    smurfingMinCount,
    smurfingReportingThreshold,
    smurfingTotalMultiplier,
  } = config;

  const minTotalRequired = smurfingReportingThreshold * smurfingTotalMultiplier;

  for (const [accountId, outgoingTxs] of graph.outgoing.entries()) {
    if (outgoingTxs.length < smurfingMinCount) continue;

    // Outgoing transactions are sorted by timestamp
    const candidates: { txs: Transaction[]; total: number; collectors: Set<string> }[] = [];

    // Sliding window
    for (let i = 0; i < outgoingTxs.length; i++) {
      const startTx = outgoingTxs[i];
      const windowTxs: Transaction[] = [startTx];
      let totalAmount = startTx.amount;
      const collectors = new Set<string>([startTx.toAccountId]);
      let allUnderThreshold = startTx.amount < smurfingReportingThreshold;

      for (let j = i + 1; j < outgoingTxs.length; j++) {
        const nextTx = outgoingTxs[j];
        if (nextTx.timestamp - startTx.timestamp > smurfingWindowSeconds) {
          break; // outside window
        }
        windowTxs.push(nextTx);
        totalAmount += nextTx.amount;
        collectors.add(nextTx.toAccountId);
        if (nextTx.amount >= smurfingReportingThreshold) {
          allUnderThreshold = false;
        }
      }

      // Check criteria
      if (
        windowTxs.length >= smurfingMinCount &&
        allUnderThreshold &&
        totalAmount >= minTotalRequired
      ) {
        candidates.push({
          txs: windowTxs,
          total: totalAmount,
          collectors,
        });
      }
    }

    if (candidates.length === 0) continue;

    // Deduplicate/merge overlapping findings for this account
    // We group candidates that share at least one transaction ID.
    const mergedGroups: { txs: Map<string, Transaction>; collectors: Set<string>; total: number }[] = [];

    candidates.forEach(cand => {
      // Find if this candidate shares any transaction with an existing merged group
      let matchedGroup = mergedGroups.find(group => 
        cand.txs.some(tx => group.txs.has(tx.id))
      );

      if (matchedGroup) {
        // Union transactions and collectors
        cand.txs.forEach(tx => {
          if (!matchedGroup!.txs.has(tx.id)) {
            matchedGroup!.txs.set(tx.id, tx);
          }
        });
        cand.collectors.forEach(col => matchedGroup!.collectors.add(col));
      } else {
        const txMap = new Map<string, Transaction>();
        cand.txs.forEach(tx => txMap.set(tx.id, tx));
        mergedGroups.push({
          txs: txMap,
          collectors: new Set(cand.collectors),
          total: 0, // will compute later
        });
      }
    });

    // Create finding for each merged group
    mergedGroups.forEach((group, index) => {
      const mergedTxs = Array.from(group.txs.values()).sort((a, b) => a.timestamp - b.timestamp);
      const totalAmount = mergedTxs.reduce((sum, tx) => sum + tx.amount, 0);
      const firstTxTime = mergedTxs[0].timestamp;
      const lastTxTime = mergedTxs[mergedTxs.length - 1].timestamp;
      const timeDiffHours = ((lastTxTime - firstTxTime) / 3600).toFixed(1);

      // Scoring: 0-1 based on count of txs and total amount relative to thresholds
      // A larger smurfing effort gets closer to 1.0.
      const countScore = Math.min(1.5, mergedTxs.length / smurfingMinCount); // cap at 1.5
      const amountScore = Math.min(1.5, totalAmount / minTotalRequired);
      const rawScore = 0.4 * countScore + 0.6 * amountScore;
      const score = Math.min(0.98, Math.max(0.65, rawScore)); // bound score realistically for fraud

      const explanation = `Structuring detected: account ${accountId} sent ${mergedTxs.length} separate transactions (each under reporting threshold ${smurfingReportingThreshold.toLocaleString()}) totaling ${totalAmount.toLocaleString()} to ${group.collectors.size} collector account(s) within a window of ${timeDiffHours} hours.`;

      findings.push({
        id: `FIND_SMURF_${accountId}_${index}`,
        patternType: 'smurfing',
        accountIds: [accountId, ...Array.from(group.collectors)],
        transactionIds: mergedTxs.map(tx => tx.id),
        score,
        explanation,
      });
    });
  }

  return findings;
}
