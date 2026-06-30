import { Account, Transaction, TransactionGraph } from './types';

export function createGraph(accounts: Account[], transactions: Transaction[]): TransactionGraph {
  const accountMap = new Map<string, Account>();
  const outgoingMap = new Map<string, Transaction[]>();
  const incomingMap = new Map<string, Transaction[]>();

  // Pre-populate maps for all accounts to guarantee O(1) empty array return if needed
  accounts.forEach(acc => {
    accountMap.set(acc.id, acc);
    outgoingMap.set(acc.id, []);
    incomingMap.set(acc.id, []);
  });

  // Sort transactions by timestamp for chronological stability
  const sortedTransactions = [...transactions].sort((a, b) => a.timestamp - b.timestamp);

  sortedTransactions.forEach(tx => {
    // Check if account exist, if not create them on-the-fly to handle dynamically added nodes
    if (!accountMap.has(tx.fromAccountId)) {
      accountMap.set(tx.fromAccountId, { id: tx.fromAccountId, createdAt: tx.timestamp - 86400 });
      outgoingMap.set(tx.fromAccountId, []);
      incomingMap.set(tx.fromAccountId, []);
    }
    if (!accountMap.has(tx.toAccountId)) {
      accountMap.set(tx.toAccountId, { id: tx.toAccountId, createdAt: tx.timestamp - 86400 });
      outgoingMap.set(tx.toAccountId, []);
      incomingMap.set(tx.toAccountId, []);
    }

    outgoingMap.get(tx.fromAccountId)!.push(tx);
    incomingMap.get(tx.toAccountId)!.push(tx);
  });

  return {
    accounts: accountMap,
    transactions: sortedTransactions,
    outgoing: outgoingMap,
    incoming: incomingMap,
  };
}

export function getOutgoingTransactions(
  graph: TransactionGraph,
  accountId: string,
  withinWindow?: [number, number]
): Transaction[] {
  const txs = graph.outgoing.get(accountId) || [];
  if (!withinWindow) return txs;
  const [start, end] = withinWindow;
  return txs.filter(tx => tx.timestamp >= start && tx.timestamp <= end);
}

export function getIncomingTransactions(
  graph: TransactionGraph,
  accountId: string,
  withinWindow?: [number, number]
): Transaction[] {
  const txs = graph.incoming.get(accountId) || [];
  if (!withinWindow) return txs;
  const [start, end] = withinWindow;
  return txs.filter(tx => tx.timestamp >= start && tx.timestamp <= end);
}

export function getAllAccounts(graph: TransactionGraph): Account[] {
  return Array.from(graph.accounts.values());
}
