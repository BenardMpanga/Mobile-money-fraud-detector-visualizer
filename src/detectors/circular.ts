import { TransactionGraph, Finding, DetectionConfig, Transaction } from '../domain/types';

export function detectCircularFlow(graph: TransactionGraph, config: DetectionConfig): Finding[] {
  const findings: Finding[] = [];
  const {
    circularWindowSeconds,
    circularMinLen,
    circularMaxLen,
    circularSkimTolerance,
  } = config;

  const accounts = Array.from(graph.accounts.keys());
  const cycles: Transaction[][] = [];

  // Recursive DFS to find cycles
  function dfs(
    startNodeId: string,
    currentNodeId: string,
    path: Transaction[],
    visited: Set<string>
  ) {
    const depth = path.length;

    // Check if we have closed the cycle
    if (depth >= circularMinLen && currentNodeId === startNodeId) {
      cycles.push([...path]);
      return;
    }

    if (depth >= circularMaxLen) {
      return; // exceed maximum cycle size
    }

    const outgoing = graph.outgoing.get(currentNodeId) || [];

    for (const outTx of outgoing) {
      const nextNodeId = outTx.toAccountId;

      // 1. Canonical Node Ordering: Only start cycle from lexicographically smallest node
      // This eliminates finding permutations of the same cycle (e.g. A-B-C-A vs B-C-A-B)
      // and slashes the search space dramatically!
      if (nextNodeId < startNodeId) continue;

      // 2. Validate progressive timestamps and window constraints
      if (depth > 0) {
        const lastTx = path[depth - 1];
        if (outTx.timestamp <= lastTx.timestamp) continue;
        if (outTx.timestamp - lastTx.timestamp > circularWindowSeconds) continue;
      }

      // 3. Amount skim tolerance
      if (depth > 0) {
        const lastTx = path[depth - 1];
        const minAmt = lastTx.amount * (1 - circularSkimTolerance);
        const maxAmt = lastTx.amount * 1.05; // allow small rounding or slight variance
        if (outTx.amount < minAmt || outTx.amount > maxAmt) continue;
      }

      // 4. Handle loops
      if (nextNodeId === startNodeId) {
        // Closes cycle - valid step!
        path.push(outTx);
        dfs(startNodeId, nextNodeId, path, visited);
        path.pop();
      } else {
        // Internal cycle check: cannot visit already visited nodes in the middle
        if (visited.has(nextNodeId)) continue;

        visited.add(nextNodeId);
        path.push(outTx);

        dfs(startNodeId, nextNodeId, path, visited);

        // Backtrack
        path.pop();
        visited.delete(nextNodeId);
      }
    }
  }

  // Run DFS from each node in the graph
  for (const startId of accounts) {
    const incoming = graph.incoming.get(startId) || [];
    const outgoing = graph.outgoing.get(startId) || [];
    
    // An account can only be part of a cycle if it has both ingress and egress
    if (incoming.length === 0 || outgoing.length === 0) continue;

    const visited = new Set<string>([startId]);
    dfs(startId, startId, [], visited);
  }

  // Deduplicate transaction-level cycles (if there are multiple parallel traces)
  // We can group cycles that use the exact same accounts and keep the one with the highest score
  const uniqueCycles: Transaction[][] = [];
  const cycleSignatures = new Set<string>();

  for (const cy of cycles) {
    // Sort account IDs to form a unique structural signature
    const sortedAccs = cy.map(tx => tx.fromAccountId).sort().join('-');
    const signature = `${sortedAccs}`;
    if (!cycleSignatures.has(signature)) {
      cycleSignatures.add(signature);
      uniqueCycles.push(cy);
    }
  }

  // Format into Findings
  uniqueCycles.forEach((cy, index) => {
    const startTx = cy[0];
    const endTx = cy[cy.length - 1];
    const accountIds: string[] = cy.map(tx => tx.fromAccountId);
    const transactionIds = cy.map(tx => tx.id);

    const firstTxTime = startTx.timestamp;
    const lastTxTime = endTx.timestamp;
    const totalDurationHours = ((lastTxTime - firstTxTime) / 3600).toFixed(1);

    // Scoring: 0.85 to 0.98 based on complete preservation of funds and cycle size
    // Calculate total skim rate
    const startAmt = startTx.amount;
    const endAmt = endTx.amount;
    const preservation = endAmt / startAmt; // close to 1 is stronger circular flow

    const score = Math.min(0.98, Math.max(0.75, 0.60 + 0.38 * preservation));

    const explanation = `Circular flow cycle of length ${cy.length} detected: funds of ${startAmt.toLocaleString()} cycled through [${accountIds.join(' → ')} → ${startTx.fromAccountId}] within a window of ${totalDurationHours} hours, returning ${endAmt.toLocaleString()} (retained ${(preservation * 100).toFixed(1)}%).`;

    findings.push({
      id: `FIND_CYCLE_${startTx.fromAccountId}_${index}`,
      patternType: 'circular_flow',
      accountIds,
      transactionIds,
      score,
      explanation,
    });
  });

  return findings;
}
