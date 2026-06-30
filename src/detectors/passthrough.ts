import { TransactionGraph, Finding, DetectionConfig, Transaction } from '../domain/types';

export function detectPassThrough(graph: TransactionGraph, config: DetectionConfig): Finding[] {
  const {
    passThroughWindowSeconds,
    passThroughAmountTolerance,
    passThroughMaxChainLength, // e.g. default 4 hops
  } = config;

  const allChains: Transaction[][] = [];

  // Recursive DFS helper to trace mule chains
  function traceChain(
    currentChain: Transaction[],
    visitedAccounts: Set<string>
  ) {
    if (currentChain.length >= passThroughMaxChainLength) {
      allChains.push([...currentChain]);
      return;
    }

    const lastTx = currentChain[currentChain.length - 1];
    const intermediary = lastTx.toAccountId;

    // Retrieve outgoing transactions from the intermediary account
    const outgoing = graph.outgoing.get(intermediary) || [];

    let hasExtensions = false;
    for (const outTx of outgoing) {
      // 1. Chronological order
      if (outTx.timestamp <= lastTx.timestamp) continue;

      // 2. Delay within window
      const delay = outTx.timestamp - lastTx.timestamp;
      if (delay > passThroughWindowSeconds) continue;

      // 3. Amount within tolerance
      const lowAmount = lastTx.amount * (1 - passThroughAmountTolerance);
      const highAmount = lastTx.amount * (1 + passThroughAmountTolerance);
      if (outTx.amount < lowAmount || outTx.amount > highAmount) continue;

      // 4. Prevent loops (already visited in this chain)
      if (visitedAccounts.has(outTx.toAccountId)) continue;

      // Valid extension found!
      hasExtensions = true;
      visitedAccounts.add(outTx.toAccountId);
      currentChain.push(outTx);

      traceChain(currentChain, visitedAccounts);

      // Backtrack
      currentChain.pop();
      visitedAccounts.delete(outTx.toAccountId);
    }

    // If we cannot extend further, save the chain (needs to have at least 1 transfer, but rapid pass-through requires a receipt and an egress, i.e., >= 2 transactions)
    if (!hasExtensions && currentChain.length >= 2) {
      allChains.push([...currentChain]);
    }
  }

  // Start a trace from every transaction as a potential chain root
  for (const rootTx of graph.transactions) {
    const visited = new Set<string>([rootTx.fromAccountId, rootTx.toAccountId]);
    traceChain([rootTx], visited);
  }

  // Deduplicate and filter out sub-chains
  // E.g., if chain A is [TX1, TX2] and chain B is [TX1, TX2, TX3], we discard chain A.
  const sortedChains = [...allChains].sort((a, b) => b.length - a.length);
  const maximalChains: Transaction[][] = [];

  for (const chain of sortedChains) {
    // Check if this chain's transaction IDs are entirely contained in any already accepted maximal chain
    const isSubchain = maximalChains.some(maxChain => {
      if (maxChain.length <= chain.length) return false;
      // Simple check: does the long chain contain the short chain as a contiguous sub-segment?
      const chainTxIds = chain.map(tx => tx.id).join(',');
      const maxChainTxIds = maxChain.map(tx => tx.id).join(',');
      return maxChainTxIds.includes(chainTxIds);
    });

    if (!isSubchain) {
      maximalChains.push(chain);
    }
  }

  // Format maximal chains into Findings
  const findings: Finding[] = [];
  maximalChains.forEach((chain, index) => {
    // Assemble distinct account IDs in order
    const accountIds: string[] = [chain[0].fromAccountId];
    chain.forEach(tx => {
      if (!accountIds.includes(tx.toAccountId)) {
        accountIds.push(tx.toAccountId);
      }
    });

    const numHops = chain.length; // e.g., 2 transactions = 2 hops
    const firstTx = chain[0];
    const lastTx = chain[chain.length - 1];
    const totalDurationSecs = lastTx.timestamp - firstTx.timestamp;
    const durationMins = Math.ceil(totalDurationSecs / 60);

    // Scoring: 0.70 for 2 hops, scaling up to 0.98 for 4+ hops
    const baseScore = 0.65;
    const stepMultiplier = 0.11;
    const rawScore = baseScore + (numHops - 2) * stepMultiplier;
    const score = Math.min(0.98, Math.max(0.65, rawScore));

    const finalRecAmt = lastTx.amount;
    const origSentAmt = firstTx.amount;
    
    const explanation = `Rapid pass-through mule chain of ${numHops} hops detected: ${origSentAmt.toLocaleString()} sent from ${firstTx.fromAccountId} reached ${lastTx.toAccountId} via ${numHops - 1} intermediary mule accounts in ${durationMins} minutes (final received: ${finalRecAmt.toLocaleString()}).`;

    findings.push({
      id: `FIND_MULE_${firstTx.fromAccountId}_${index}`,
      patternType: 'rapid_pass_through',
      accountIds,
      transactionIds: chain.map(tx => tx.id),
      score,
      explanation,
    });
  });

  return findings;
}
