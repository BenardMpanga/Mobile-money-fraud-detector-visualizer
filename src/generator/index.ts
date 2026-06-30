import { GeneratorConfig, GeneratedDataset, Account, Transaction, GroundTruth } from '../domain/types';
import { SeededRandom, generateBaseline } from './baseline';
import { injectSmurfing, injectRapidPassThrough, injectCircularFlow, injectNearMisses } from './injectors';
import { createGraph } from '../domain/helpers';

export const DEFAULT_CONFIG: GeneratorConfig = {
  numAccounts: 200,
  numNormalTransactions: 2000,
  timeWindowDays: 30,
  seed: 'money-fraud-repro-2026',
  injectSmurfing: true,
  numSmurfingInstances: 3,
  injectRapidPassThrough: true,
  numRapidPassThroughInstances: 3,
  injectCircularFlow: true,
  numCircularFlowInstances: 3,
  numNearMisses: 10,
};

export function generateDataset(config: GeneratorConfig = DEFAULT_CONFIG): GeneratedDataset {
  // 1. Initialise Random
  const seedString = config.seed || Math.random().toString(36).substring(2, 11);
  const rand = new SeededRandom(seedString);

  // 2. Generate baseline (normal) transactions
  const { accounts, transactions } = generateBaseline(
    config.numAccounts,
    config.numNormalTransactions,
    config.timeWindowDays,
    rand
  );

  let currentTransactions = [...transactions];
  const txCounterRef = { val: currentTransactions.length + 1 };

  const groundTruth: GroundTruth = {
    smurfing: [],
    rapidPassThrough: [],
    circularFlow: [],
  };

  // 3. Inject Smurfing Patterns
  if (config.injectSmurfing && config.numSmurfingInstances > 0) {
    const res = injectSmurfing(
      accounts,
      currentTransactions,
      config.numSmurfingInstances,
      config.timeWindowDays,
      rand,
      txCounterRef
    );
    currentTransactions = res.transactions;
    groundTruth.smurfing = res.groundTruth;
  }

  // 4. Inject Rapid Pass-Through Patterns
  if (config.injectRapidPassThrough && config.numRapidPassThroughInstances > 0) {
    const res = injectRapidPassThrough(
      accounts,
      currentTransactions,
      config.numRapidPassThroughInstances,
      config.timeWindowDays,
      rand,
      txCounterRef
    );
    currentTransactions = res.transactions;
    groundTruth.rapidPassThrough = res.groundTruth;
  }

  // 5. Inject Circular Flow Patterns
  if (config.injectCircularFlow && config.numCircularFlowInstances > 0) {
    const res = injectCircularFlow(
      accounts,
      currentTransactions,
      config.numCircularFlowInstances,
      config.timeWindowDays,
      rand,
      txCounterRef
    );
    currentTransactions = res.transactions;
    groundTruth.circularFlow = res.groundTruth;
  }

  // 6. Inject Near-Miss Patterns (Noise)
  if (config.numNearMisses > 0) {
    currentTransactions = injectNearMisses(
      accounts,
      currentTransactions,
      config.numNearMisses,
      config.timeWindowDays,
      rand,
      txCounterRef
    );
  }

  // 7. Create final graph
  const graph = createGraph(accounts, currentTransactions);

  return {
    graph,
    groundTruth,
    config,
  };
}
