import { Account, Transaction, GroundTruthPattern } from '../domain/types';
import { SeededRandom, START_EPOCH } from './baseline';

/**
 * INJECTOR A: SMURFING (Structuring)
 * One origin account sends a large total amount split into many small transactions
 * to 1-3 collector accounts within a short window (e.g., 48 hours), each individual
 * transaction being kept under the reporting threshold (e.g. 1,000,000) but summing to >= 1x multiplier.
 */
export function injectSmurfing(
  accounts: Account[],
  transactions: Transaction[],
  numInstances: number,
  timeWindowDays: number,
  rand: SeededRandom,
  txCounterRef: { val: number }
): { transactions: Transaction[]; groundTruth: GroundTruthPattern[] } {
  const injectedTransactions = [...transactions];
  const groundTruth: GroundTruthPattern[] = [];
  const timeWindowSeconds = timeWindowDays * 24 * 60 * 60;

  for (let i = 0; i < numInstances; i++) {
    const patternId = `SMURF_${(i + 1).toString().padStart(3, '0')}`;
    
    // Choose an origin account (prefer accounts with lower baseline activity to avoid muddying)
    const originIdx = rand.nextInt(0, accounts.length - 1);
    const origin = accounts[originIdx];

    // Choose 1 to 3 collectors
    const numCollectors = rand.nextInt(1, 3);
    const collectors: Account[] = [];
    while (collectors.length < numCollectors) {
      const idx = rand.nextInt(0, accounts.length - 1);
      const possibleCollector = accounts[idx];
      if (possibleCollector.id !== origin.id && !collectors.some(c => c.id === possibleCollector.id)) {
        collectors.push(possibleCollector);
      }
    }

    // Determine smurfing timing: a random 36-hour block within the overall timeline
    const smurfStart = START_EPOCH + rand.nextInt(0, Math.max(0, timeWindowSeconds - 36 * 3600));
    
    // Total amount split: say 1.2M to 2.5M
    const totalAmount = rand.nextInt(1200000, 2500000);
    // Number of small transactions: 15 to 30
    const txCount = rand.nextInt(15, 30);
    const avgAmount = Math.floor(totalAmount / txCount);

    const instanceAccountIds = new Set<string>([origin.id]);
    collectors.forEach(c => instanceAccountIds.add(c.id));
    const instanceTxIds: string[] = [];

    // Distribute transactions to the collectors within the window
    for (let j = 0; j < txCount; j++) {
      const collector = collectors[j % collectors.length];
      const txTimestamp = smurfStart + rand.nextInt(0, 36 * 3600);
      
      // Keep individual transactions well below 1,000,000, say with a minor jitter (e.g. ±10%)
      const jitterFactor = 0.9 + rand.next() * 0.2;
      const amount = Math.floor(avgAmount * jitterFactor);

      const txId = `TX_SMURF_${txCounterRef.val.toString().padStart(6, '0')}`;
      txCounterRef.val++;

      const tx: Transaction = {
        id: txId,
        fromAccountId: origin.id,
        toAccountId: collector.id,
        amount,
        timestamp: txTimestamp,
      };

      injectedTransactions.push(tx);
      instanceTxIds.push(txId);
    }

    groundTruth.push({
      patternId,
      accountIds: Array.from(instanceAccountIds),
      transactionIds: instanceTxIds,
    });
  }

  return { transactions: injectedTransactions, groundTruth };
}

/**
 * INJECTOR B: RAPID PASS-THROUGH (Mule Chains)
 * Money is sent through a chain of 2-4 mule accounts before reaching a destination.
 * Path: A -> B -> C -> D -> E
 * For each step, timestamp advances by under 30 minutes, and the amount remains
 * within ±5% tolerance.
 */
export function injectRapidPassThrough(
  accounts: Account[],
  transactions: Transaction[],
  numInstances: number,
  timeWindowDays: number,
  rand: SeededRandom,
  txCounterRef: { val: number }
): { transactions: Transaction[]; groundTruth: GroundTruthPattern[] } {
  const injectedTransactions = [...transactions];
  const groundTruth: GroundTruthPattern[] = [];
  const timeWindowSeconds = timeWindowDays * 24 * 60 * 60;

  for (let i = 0; i < numInstances; i++) {
    const patternId = `MULE_${(i + 1).toString().padStart(3, '0')}`;
    
    // Choose length of chain: 2 to 4 hops (means 3 to 5 nodes total)
    const numHops = rand.nextInt(2, 4);
    const chainNodes: Account[] = [];
    
    // Find unique accounts for the chain
    while (chainNodes.length < numHops + 1) {
      const idx = rand.nextInt(0, accounts.length - 1);
      const node = accounts[idx];
      if (!chainNodes.some(n => n.id === node.id)) {
        chainNodes.push(node);
      }
    }

    // Timestamps: start chain at a random time, leave enough room for progressive hops (e.g., 30 mins each)
    const maxChainDuration = numHops * 30 * 60; // in seconds
    const chainStart = START_EPOCH + rand.nextInt(0, Math.max(0, timeWindowSeconds - maxChainDuration));

    // Initial amount: e.g. 300,000 to 900,000
    let currentAmount = rand.nextInt(300000, 900000);
    let currentTimestamp = chainStart;

    const instanceAccountIds = chainNodes.map(n => n.id);
    const instanceTxIds: string[] = [];

    // Build the chain of transactions
    for (let h = 0; h < numHops; h++) {
      const fromNode = chainNodes[h];
      const toNode = chainNodes[h + 1];

      // Delay to next hop: 1 to 25 minutes
      const delay = rand.nextInt(60, 25 * 60);
      currentTimestamp += delay;

      // Small fee/commission skim (spec says amount within ±5%)
      // We will make it stay closely aligned (e.g., skim 1-4%, or add/subtract small variance)
      const changePercent = rand.next() * 0.08 - 0.05; // -5% to +3%
      const amount = Math.floor(currentAmount * (1 + changePercent));

      const txId = `TX_MULE_${txCounterRef.val.toString().padStart(6, '0')}`;
      txCounterRef.val++;

      const tx: Transaction = {
        id: txId,
        fromAccountId: fromNode.id,
        toAccountId: toNode.id,
        amount,
        timestamp: currentTimestamp,
      };

      injectedTransactions.push(tx);
      instanceTxIds.push(txId);

      // Carry amount over to next hop
      currentAmount = amount;
    }

    groundTruth.push({
      patternId,
      accountIds: instanceAccountIds,
      transactionIds: instanceTxIds,
    });
  }

  return { transactions: injectedTransactions, groundTruth };
}

/**
 * INJECTOR C: CIRCULAR FLOW
 * A cycle of 3-6 accounts where each sends to the next, and the last sends back to
 * the first, all within 72 hours, with amounts staying within a 2-5% skim per hop.
 */
export function injectCircularFlow(
  accounts: Account[],
  transactions: Transaction[],
  numInstances: number,
  timeWindowDays: number,
  rand: SeededRandom,
  txCounterRef: { val: number }
): { transactions: Transaction[]; groundTruth: GroundTruthPattern[] } {
  const injectedTransactions = [...transactions];
  const groundTruth: GroundTruthPattern[] = [];
  const timeWindowSeconds = timeWindowDays * 24 * 60 * 60;

  for (let i = 0; i < numInstances; i++) {
    const patternId = `CYCLE_${(i + 1).toString().padStart(3, '0')}`;

    // Cycle size: 3 to 6 nodes
    const cycleSize = rand.nextInt(3, 6);
    const cycleNodes: Account[] = [];

    // Gather unique accounts for the cycle
    while (cycleNodes.length < cycleSize) {
      const idx = rand.nextInt(0, accounts.length - 1);
      const node = accounts[idx];
      if (!cycleNodes.some(n => n.id === node.id)) {
        cycleNodes.push(node);
      }
    }

    // Time window for entire cycle is 72 hours.
    // Let's divide 72 hours by cycle size, and distribute hops chronologically.
    const cycleStart = START_EPOCH + rand.nextInt(0, Math.max(0, timeWindowSeconds - 72 * 3600));
    const hopTimeBudget = Math.floor((72 * 3600) / cycleSize);

    let currentTimestamp = cycleStart;
    // Starting cycle amount: e.g. 500,000 to 1,500,000
    let currentAmount = rand.nextInt(500000, 1500000);

    const instanceAccountIds = cycleNodes.map(n => n.id);
    const instanceTxIds: string[] = [];

    for (let c = 0; c < cycleSize; c++) {
      const fromNode = cycleNodes[c];
      const toNode = cycleNodes[(c + 1) % cycleSize]; // loops back at the end

      // Timestamp for this hop
      const delay = rand.nextInt(Math.floor(hopTimeBudget * 0.1), Math.floor(hopTimeBudget * 0.9));
      currentTimestamp += delay;

      // Amount skimmed at each hop: 2% to 5% taken (skim tolerance is 5%)
      const skimRate = 0.02 + rand.next() * 0.03; // 2% to 5%
      const amount = Math.floor(currentAmount * (1 - skimRate));

      const txId = `TX_CYCLE_${txCounterRef.val.toString().padStart(6, '0')}`;
      txCounterRef.val++;

      const tx: Transaction = {
        id: txId,
        fromAccountId: fromNode.id,
        toAccountId: toNode.id,
        amount,
        timestamp: currentTimestamp,
      };

      injectedTransactions.push(tx);
      instanceTxIds.push(txId);

      // Carry forward
      currentAmount = amount;
    }

    groundTruth.push({
      patternId,
      accountIds: instanceAccountIds,
      transactionIds: instanceTxIds,
    });
  }

  return { transactions: injectedTransactions, groundTruth };
}

/**
 * GENERATOR NOISE & NEAR-MISS PATTERNS
 * Injects benign structures that resemble fraud patterns but fail specific thresholds
 * (e.g. longer intervals, smaller totals, amount gaps, unclosed cycles).
 * These are NOT recorded in ground truth so that we test precision/false-positives!
 */
export function injectNearMisses(
  accounts: Account[],
  transactions: Transaction[],
  numNearMisses: number,
  timeWindowDays: number,
  rand: SeededRandom,
  txCounterRef: { val: number }
): Transaction[] {
  const finalTransactions = [...transactions];
  const timeWindowSeconds = timeWindowDays * 24 * 60 * 60;

  for (let i = 0; i < numNearMisses; i++) {
    const missType = i % 3;

    if (missType === 0) {
      // 1. Smurfing Near-Miss
      // Many transactions but low overall total (structuring near miss, e.g. 5,000 each * 15 = 75,000 total)
      // OR transactions spread over a very long time window (e.g. 8 days instead of 48 hours)
      const origin = accounts[rand.nextInt(0, accounts.length - 1)];
      const collector = accounts[rand.nextInt(0, accounts.length - 1)];
      if (origin.id !== collector.id) {
        const isSpreadMiss = rand.next() > 0.5;
        if (isSpreadMiss) {
          // Spread over 10 days
          const start = START_EPOCH + rand.nextInt(0, Math.max(0, timeWindowSeconds - 10 * 86400));
          const txCount = rand.nextInt(12, 18);
          for (let j = 0; j < txCount; j++) {
            const txId = `TX_NM_SMURF_${txCounterRef.val.toString().padStart(6, '0')}`;
            txCounterRef.val++;
            finalTransactions.push({
              id: txId,
              fromAccountId: origin.id,
              toAccountId: collector.id,
              amount: rand.nextInt(40000, 80000),
              timestamp: start + j * Math.floor((10 * 86400) / txCount) + rand.nextInt(-1000, 1000),
            });
          }
        } else {
          // Large count (e.g. 15 transactions) in short window (e.g. 24h) but very small total (e.g., 2,000 each = 30,000 total)
          const start = START_EPOCH + rand.nextInt(0, Math.max(0, timeWindowSeconds - 86400));
          const txCount = rand.nextInt(12, 18);
          for (let j = 0; j < txCount; j++) {
            const txId = `TX_NM_SMURF_${txCounterRef.val.toString().padStart(6, '0')}`;
            txCounterRef.val++;
            finalTransactions.push({
              id: txId,
              fromAccountId: origin.id,
              toAccountId: collector.id,
              amount: rand.nextInt(1500, 3000), // very small!
              timestamp: start + rand.nextInt(0, 86400),
            });
          }
        }
      }
    } else if (missType === 1) {
      // 2. Rapid Pass-Through Near-Miss
      // Receives money but sends out 2 days later (exceeds 30 mins)
      // OR receives 500,000 but only forwards 5,000 (amount discrepancy exceeds ±5%)
      const a = accounts[rand.nextInt(0, accounts.length - 1)];
      const b = accounts[rand.nextInt(0, accounts.length - 1)];
      const c = accounts[rand.nextInt(0, accounts.length - 1)];

      if (a.id !== b.id && b.id !== c.id && a.id !== c.id) {
        const isTimeDelayMiss = rand.next() > 0.5;
        const start = START_EPOCH + rand.nextInt(0, Math.max(0, timeWindowSeconds - 3 * 86400));
        
        if (isTimeDelayMiss) {
          // Delay is 2 days (172800 seconds)
          const tx1Id = `TX_NM_MULE_${txCounterRef.val.toString().padStart(6, '0')}`;
          txCounterRef.val++;
          finalTransactions.push({
            id: tx1Id,
            fromAccountId: a.id,
            toAccountId: b.id,
            amount: 500000,
            timestamp: start,
          });

          const tx2Id = `TX_NM_MULE_${txCounterRef.val.toString().padStart(6, '0')}`;
          txCounterRef.val++;
          finalTransactions.push({
            id: tx2Id,
            fromAccountId: b.id,
            toAccountId: c.id,
            amount: 495000,
            timestamp: start + 2 * 86400, // 2 days delay
          });
        } else {
          // Instant pass-through but major amount gap (receives 500k, sends 50k - forwards only 10%)
          const tx1Id = `TX_NM_MULE_${txCounterRef.val.toString().padStart(6, '0')}`;
          txCounterRef.val++;
          finalTransactions.push({
            id: tx1Id,
            fromAccountId: a.id,
            toAccountId: b.id,
            amount: 500000,
            timestamp: start,
          });

          const tx2Id = `TX_NM_MULE_${txCounterRef.val.toString().padStart(6, '0')}`;
          txCounterRef.val++;
          finalTransactions.push({
            id: tx2Id,
            fromAccountId: b.id,
            toAccountId: c.id,
            amount: 50000, // huge drop!
            timestamp: start + 300, // 5 mins
          });
        }
      }
    } else {
      // 3. Circular Flow Near-Miss
      // Cycle where consecutive edges occur 8 days apart (exceeds 72h)
      // OR a path that does NOT close (e.g. A -> B -> C -> D but D doesn't send to A)
      const a = accounts[rand.nextInt(0, accounts.length - 1)];
      const b = accounts[rand.nextInt(0, accounts.length - 1)];
      const c = accounts[rand.nextInt(0, accounts.length - 1)];

      if (a.id !== b.id && b.id !== c.id && a.id !== c.id) {
        const isOpenPathMiss = rand.next() > 0.5;
        const start = START_EPOCH + rand.nextInt(0, Math.max(0, timeWindowSeconds - 15 * 86400));
        
        if (isOpenPathMiss) {
          // Open path A -> B -> C (does not loop back, just a normal chain of two standard transfers within 10 hours)
          const tx1Id = `TX_NM_CYC_${txCounterRef.val.toString().padStart(6, '0')}`;
          txCounterRef.val++;
          finalTransactions.push({
            id: tx1Id,
            fromAccountId: a.id,
            toAccountId: b.id,
            amount: 400000,
            timestamp: start,
          });

          const tx2Id = `TX_NM_CYC_${txCounterRef.val.toString().padStart(6, '0')}`;
          txCounterRef.val++;
          finalTransactions.push({
            id: tx2Id,
            fromAccountId: b.id,
            toAccountId: c.id,
            amount: 388000,
            timestamp: start + 3600,
          });
          // Note: NO transaction back from C to A!
        } else {
          // Loop that closes, but takes 12 days total (too slow)
          const tx1Id = `TX_NM_CYC_${txCounterRef.val.toString().padStart(6, '0')}`;
          txCounterRef.val++;
          finalTransactions.push({
            id: tx1Id,
            fromAccountId: a.id,
            toAccountId: b.id,
            amount: 400000,
            timestamp: start,
          });

          const tx2Id = `TX_NM_CYC_${txCounterRef.val.toString().padStart(6, '0')}`;
          txCounterRef.val++;
          finalTransactions.push({
            id: tx2Id,
            fromAccountId: b.id,
            toAccountId: c.id,
            amount: 388000,
            timestamp: start + 5 * 86400, // 5 days
          });

          const tx3Id = `TX_NM_CYC_${txCounterRef.val.toString().padStart(6, '0')}`;
          txCounterRef.val++;
          finalTransactions.push({
            id: tx3Id,
            fromAccountId: c.id,
            toAccountId: a.id,
            amount: 376000,
            timestamp: start + 12 * 86400, // 12 days total
          });
        }
      }
    }
  }

  return finalTransactions;
}
