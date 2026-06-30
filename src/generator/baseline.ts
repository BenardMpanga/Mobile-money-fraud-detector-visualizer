import { Account, Transaction } from '../domain/types';

// Simple seeded PRNG (Mulberry32) for deterministic, reproducible generation
export class SeededRandom {
  private h: number;

  constructor(seedStr: string) {
    let h = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) {
      h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    this.h = h >>> 0;
  }

  // Returns [0, 1)
  next(): number {
    let z = (this.h += 0x6d2b79f5);
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  }

  // Returns integer in range [min, max]
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  // Standard normal distribution using Box-Muller
  nextNormal(): number {
    let u = 0, v = 0;
    while(u === 0) u = this.next(); // Converting [0,1) to (0,1)
    while(v === 0) v = this.next();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  // Log-normal distribution
  nextLogNormal(mean: number, sigma: number): number {
    return Math.exp(mean + sigma * this.nextNormal());
  }

  // Weighted selection from an array
  selectWeighted<T>(items: T[], weights: number[]): T {
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let r = this.next() * totalWeight;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }
}

// Fixed baseline epoch
export const START_EPOCH = 1770000000; // approx year 2026

export function generateBaseline(
  numAccounts: number,
  numTransactions: number,
  timeWindowDays: number,
  rand: SeededRandom
): { accounts: Account[]; transactions: Transaction[] } {
  const accounts: Account[] = [];
  const transactions: Transaction[] = [];
  const timeWindowSeconds = timeWindowDays * 24 * 60 * 60;

  // 1. Generate Accounts
  for (let i = 0; i < numAccounts; i++) {
    const accountId = `ACC_${(i + 1).toString().padStart(4, '0')}`;
    // Account creation date somewhere in the 90 days prior to START_EPOCH
    const createdAt = START_EPOCH - rand.nextInt(0, 90 * 86400);
    accounts.push({ id: accountId, createdAt });
  }

  // 2. Assign activity weights (Power-law/Exponential like distribution)
  // This makes sure most accounts have few transactions, and a few are highly active.
  const accountWeights = accounts.map(() => {
    // Highly skewed: some super-agents, some average users, many quiet users
    return Math.pow(rand.next(), 4.0) * 100 + 1;
  });

  // 3. Helper to get a realistic diurnal timestamp
  // Diurnal multiplier: returns relative probability [0.1, 1.0] depending on hour of day
  function getDiurnalFactor(hour: number): number {
    if (hour >= 1 && hour < 5) return 0.1; // quiet late night
    if (hour >= 5 && hour < 8) return 0.4; // early morning
    if (hour >= 8 && hour < 12) return 1.0; // morning peak
    if (hour >= 12 && hour < 14) return 0.9; // lunch lull/plateau
    if (hour >= 14 && hour < 18) return 1.0; // afternoon peak
    if (hour >= 18 && hour < 22) return 0.7; // evening active
    return 0.2; // late night tapering
  }

  function proposeTimestamp(): number {
    const relativeSecs = rand.nextInt(0, timeWindowSeconds);
    const timestamp = START_EPOCH + relativeSecs;
    const hour = Math.floor((timestamp % 86400) / 3600); // 0-23
    const factor = getDiurnalFactor(hour);
    // Rejection sampling
    if (rand.next() <= factor) {
      return timestamp;
    }
    // Fallback: simple adjustment to make it daytime
    const adjustedHour = rand.selectWeighted(
      [2, 6, 10, 13, 16, 20, 23],
      [0.1, 0.4, 1.0, 0.9, 1.0, 0.7, 0.2]
    );
    const dayStart = Math.floor(relativeSecs / 86400) * 86400;
    return START_EPOCH + dayStart + adjustedHour * 3600 + rand.nextInt(0, 3599);
  }

  // 4. Generate transactions
  let txCounter = 1;
  while (transactions.length < numTransactions) {
    const fromAcc = rand.selectWeighted(accounts, accountWeights);
    let toAcc = rand.selectWeighted(accounts, accountWeights);
    
    // Ensure no self-loops
    if (fromAcc.id === toAcc.id) {
      // Find another destination
      let attempts = 0;
      while (toAcc.id === fromAcc.id && attempts < 10) {
        toAcc = rand.selectWeighted(accounts, accountWeights);
        attempts++;
      }
      if (toAcc.id === fromAcc.id) continue;
    }

    const timestamp = proposeTimestamp();
    
    // Log-normal amount skewed toward smaller values
    // mean of ln(x) = 9.5 (around 13,000)
    // sigma = 1.2 (wide spread, some small ones e.g. 1000, some big ones up to 100,000+)
    let amount = Math.floor(rand.nextLogNormal(9.2, 1.3));
    if (amount < 200) amount = rand.nextInt(200, 1000); // lower floor
    if (amount > 1000000) amount = rand.nextInt(500000, 950000); // clamp outliers under reporting threshold

    const txId = `TX_${txCounter.toString().padStart(6, '0')}`;
    transactions.push({
      id: txId,
      fromAccountId: fromAcc.id,
      toAccountId: toAcc.id,
      amount,
      timestamp,
    });
    txCounter++;
  }

  return { accounts, transactions };
}
