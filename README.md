# Mobile Money Fraud Pattern Visualiser

An interactive, high-fidelity React + Canvas simulator and algorithmic audit workbench designed to generate synthetic mobile money transaction networks, inject known financial crime topologies, and run high-performance, hand-written graph algorithms to detect and visualize them in real-time.

---

## 🚀 Key Features

- **Handwritten Graph Algorithms**: Formulated purely with standard TypeScript data structures (`Map`, `Set`, and standard array operations) with zero external graph library dependencies.
- **Planted Synthetic Generator**: Integrates normal transaction patterns (log-normal amount distributions, diurnal timestamp scheduling, sparse benign transaction counts) and three controllable fraud injectors.
- **Adjacency-List Graph Representations**: Implemented using index maps for `O(1)` incoming/outgoing query performance.
- **High-Performance Cycle Pruning**: Leverages custom structural DFS constraints (e.g., node lexicographical ordering) to completely prevent combinatorial explosion on dense/noisy graph nodes.
- **High-Fidelity UI**: Fully interactive HTML5 Canvas-based network visualization with pan, zoom, click-selection highlight, tabular leg listings, live precision/recall telemetry, and dynamic subgraph schematics.

---

## 📂 Architecture & Directory Layout

The application has been modularized cleanly into separated directories to adhere to pristine structural boundaries:

- `src/domain/types.ts`: Core data structures and parameters (`Account`, `Transaction`, `TransactionGraph`, configs).
- `src/domain/helpers.ts`: Fast graph assembly, adjacency-list structures, and `O(1)` transaction lookup indices.
- `src/domain/layout.ts`: Handwritten force-directed physical simulation layout, optimizing spacing and centering without third-party layout engines.
- `src/generator/`:
  - `baseline.ts`: Generates realistic normal baseline accounts and skewed transactions using a seeded Mulberry32 PRNG.
  - `injectors.ts`: Implements the three controllable fraud topology injectors alongside realistic "near-miss" decoy sequences.
  - `index.ts`: The orchestrator that takes a `GeneratorConfig` and returns a consolidated dataset with detailed ground truth records.
- `src/detectors/`:
  - `smurfing.ts`: Custom sliding-window aggregator flagging accounts attempting structuring.
  - `passthrough.ts`: Multi-hop recursive mule chain tracker linking inflows and outflows with strict timing/amount tolerances.
  - `circular.ts`: High-performance cycle detector identifying circular funds transfers with time/skim-rate restrictions.
- `src/scoring/validator.ts`: Evaluates the precision, recall, and F1-score of our detection engines compared against the baseline's ground-truth records.
- `src/App.tsx`: The primary interactive panel, displaying global metrics, simulation parameter sliders, detailed tabular reports, and the interactive Canvas viewport.

---

## 🔍 Fraud Topologies Explained

### 1. Pattern A: Structuring (Smurfing)
- **Concept**: A single origin account attempts to evade financial reporting thresholds (e.g. 1,000,000) by splitting a large sum into multiple small transactions distributed to several collector accounts within a short sliding window (e.g., 48 hours).
- **Detection Strategy**: The algorithm scans each node's outgoing logs within a rolling window. If the transaction count exceeds `smurfingMinCount` while each transfer remains under the threshold, but the aggregate sum exceeds the required limit, it groups overlapping candidates and flags them as a single structured campaign.

### 2. Pattern B: Rapid Pass-Through (Mule Accounts)
- **Concept**: Funds enter an account and are almost immediately forwarded (e.g., within 30 minutes) to another account, retaining 95%-105% of the initial received amount. This cycle often repeats across a chain of multiple hops to mask the funds' origin.
- **Detection Strategy**: We perform a recursive DFS. For each transaction, we find chronologically progressive outgoing transactions from the recipient. If the timing (under 30m), amount (within ±5% tolerance), and non-cyclic constraints match, we track the chain and record the maximal chain length (up to 4 hops).

### 3. Pattern C: Circular Flow
- **Concept**: A cycle of 3 to 6 accounts where funds transfer sequentially and return to the original sender within a constrained timeframe (e.g., 72 hours), sustaining minor skims (e.g., 2%-5% commission loss per hop).
- **Detection Strategy**: To prevent high factorial complexity ($O(N!)$) during cycle searches:
  1. We restrict searches strictly to nodes having both outgoing and incoming connections.
  2. We enforce a **Canonical Node Ordering** constraint: a cycle search is only initiated from the lexicographically smallest node in the cycle. This immediately discards redundant cyclic permutations (e.g., A-B-C-A vs B-C-A-B).
  3. Paths that exceed the timing windows or amount tolerances are aggressively pruned.

---

## 📊 Live Metrics & Audit Scoring

A built-in development scorekeeper calculates:
- **Precision**: How many flagged alerts represent actual planted fraud vs. false positives triggered by near-miss decoy noise.
- **Recall**: The model's success rate in uncovering 100% of the planted fraud topologies without letting any slip by.
- **F1 Score**: The harmonic mean of Precision and Recall, measuring the overall balance and audit hygiene of the detection parameters.

---

## 🛠️ Development & Deployment Commands

- **Start Dev Server**: `npm run dev`
- **Compile Production Bundle**: `npm run build`
- **Lint Codebase**: `npm run lint`
