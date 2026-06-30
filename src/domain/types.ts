export interface Account {
  id: string;
  createdAt: number; // unix timestamp in seconds
}

export interface Transaction {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number; // integer, local currency units
  timestamp: number; // unix timestamp in seconds
}

export interface TransactionGraph {
  accounts: Map<string, Account>;
  transactions: Transaction[];
  // Adjacency lists for fast O(1) lookups
  outgoing: Map<string, Transaction[]>;
  incoming: Map<string, Transaction[]>;
}

export type PatternType = 'smurfing' | 'rapid_pass_through' | 'circular_flow';

export interface GroundTruthPattern {
  patternId: string;
  accountIds: string[];
  transactionIds: string[];
}

export interface GroundTruth {
  smurfing: GroundTruthPattern[];
  rapidPassThrough: GroundTruthPattern[];
  circularFlow: GroundTruthPattern[];
}

export interface GeneratorConfig {
  numAccounts: number;
  numNormalTransactions: number;
  timeWindowDays: number; // e.g. 30 days
  seed?: string; // for reproducibility if specified

  // Injector toggles & counts
  injectSmurfing: boolean;
  numSmurfingInstances: number;
  
  injectRapidPassThrough: boolean;
  numRapidPassThroughInstances: number;

  injectCircularFlow: boolean;
  numCircularFlowInstances: number;

  numNearMisses: number; // count of near-miss sequences to generate
}

export interface DetectionConfig {
  // Smurfing thresholds
  smurfingWindowSeconds: number; // default 48h
  smurfingMinCount: number; // default 10
  smurfingReportingThreshold: number; // default 1,000,000 (individual tx below this)
  smurfingTotalMultiplier: number; // default 1x reporting threshold

  // Rapid Pass-through thresholds
  passThroughWindowSeconds: number; // default 30 mins
  passThroughAmountTolerance: number; // default 0.05 (±5%)
  passThroughMaxChainLength: number; // default 4

  // Circular Flow thresholds
  circularWindowSeconds: number; // default 72h
  circularMinLen: number; // default 3
  circularMaxLen: number; // default 6
  circularSkimTolerance: number; // default 0.05 (drop per hop ≤ 5%)
}

export interface GeneratedDataset {
  graph: TransactionGraph;
  groundTruth: GroundTruth;
  config: GeneratorConfig;
}

export interface Finding {
  id: string; // unique ID for finding list
  patternType: PatternType;
  accountIds: string[];
  transactionIds: string[];
  score: number; // 0 to 1
  explanation: string;
}
