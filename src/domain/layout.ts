import { Account, Transaction } from './types';

export interface Point {
  x: number;
  y: number;
}

export type LayoutMap = Map<string, Point>;

export function computeForceDirectedLayout(
  accounts: Account[],
  transactions: Transaction[],
  width: number = 800,
  height: number = 600,
  iterations: number = 55
): LayoutMap {
  const layout: LayoutMap = new Map();
  const accList = Array.from(accounts);
  const numNodes = accList.length;

  if (numNodes === 0) return layout;

  // 1. Initialise positions in a neat circle centered on canvas
  const cx = width / 2;
  const cy = height / 2;
  const rInitial = Math.min(width, height) * 0.25;

  accList.forEach((acc, i) => {
    const angle = (i / numNodes) * 2 * Math.PI;
    layout.set(acc.id, {
      x: cx + rInitial * Math.cos(angle) + (Math.random() - 0.5) * 10,
      y: cy + rInitial * Math.sin(angle) + (Math.random() - 0.5) * 10,
    });
  });

  // Unique edges for attraction
  const edges = new Map<string, { from: string; to: string; weight: number }>();
  transactions.forEach(tx => {
    if (tx.fromAccountId === tx.toAccountId) return;
    const key = [tx.fromAccountId, tx.toAccountId].sort().join('-');
    const existing = edges.get(key);
    if (existing) {
      existing.weight += 1;
    } else {
      edges.set(key, { from: tx.fromAccountId, to: tx.toAccountId, weight: 1 });
    }
  });

  const edgeList = Array.from(edges.values());

  // Force parameters
  const kRepulsion = 1500; // Repulsion constant
  const kAttraction = 0.04; // Attraction constant
  const kGravity = 0.05;   // Gravity constant (pull to center)
  const damping = 0.85;

  const velocities = new Map<string, Point>();
  accList.forEach(acc => velocities.set(acc.id, { x: 0, y: 0 }));

  // 2. Run simulation steps
  for (let iter = 0; iter < iterations; iter++) {
    const forces = new Map<string, Point>();
    accList.forEach(acc => forces.set(acc.id, { x: 0, y: 0 }));

    // A. Repulsion between all node pairs
    for (let i = 0; i < numNodes; i++) {
      const uId = accList[i].id;
      const uPos = layout.get(uId)!;

      for (let j = i + 1; j < numNodes; j++) {
        const vId = accList[j].id;
        const vPos = layout.get(vId)!;

        const dx = uPos.x - vPos.x;
        const dy = uPos.y - vPos.y;
        const distSq = dx * dx + dy * dy + 0.1; // avoid divide by zero
        const dist = Math.sqrt(distSq);

        if (dist < 220) {
          const forceMag = kRepulsion / distSq;
          const fx = (dx / dist) * forceMag;
          const fy = (dy / dist) * forceMag;

          const fU = forces.get(uId)!;
          fU.x += fx;
          fU.y += fy;

          const fV = forces.get(vId)!;
          fV.x -= fx;
          fV.y -= fy;
        }
      }

      // B. Gravity pulling to center
      const dxCent = cx - uPos.x;
      const dyCent = cy - uPos.y;
      const fU = forces.get(uId)!;
      fU.x += dxCent * kGravity;
      fU.y += dyCent * kGravity;
    }

    // C. Attraction along edges
    edgeList.forEach(edge => {
      const uPos = layout.get(edge.from);
      const vPos = layout.get(edge.to);
      if (!uPos || !vPos) return;

      const dx = uPos.x - vPos.x;
      const dy = uPos.y - vPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;

      // Force proportional to distance
      const forceMag = kAttraction * dist * Math.min(3, edge.weight);
      const fx = (dx / dist) * forceMag;
      const fy = (dy / dist) * forceMag;

      const fFrom = forces.get(edge.from)!;
      fFrom.x -= fx;
      fFrom.y -= fy;

      const fTo = forces.get(edge.to)!;
      fTo.x += fx;
      fTo.y += fy;
    });

    // D. Update positions
    accList.forEach(acc => {
      const pos = layout.get(acc.id)!;
      const f = forces.get(acc.id)!;
      const vel = velocities.get(acc.id)!;

      vel.x = (vel.x + f.x) * damping;
      vel.y = (vel.y + f.y) * damping;

      // Limit max velocity
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
      const maxSpeed = 35;
      if (speed > maxSpeed) {
        vel.x = (vel.x / speed) * maxSpeed;
        vel.y = (vel.y / speed) * maxSpeed;
      }

      pos.x += vel.x;
      pos.y += vel.y;
    });
  }

  // 3. Normalize coordinates to marginated boundaries
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  layout.forEach(p => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });

  const border = 65;
  const targetW = width - 2 * border;
  const targetH = height - 2 * border;
  
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  layout.forEach(p => {
    p.x = border + ((p.x - minX) / spanX) * targetW;
    p.y = border + ((p.y - minY) / spanY) * targetH;
  });

  return layout;
}
