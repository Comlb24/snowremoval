/**
 * Suggest an efficient stop order from a travel-time matrix.
 * matrix[i][j] = minutes from point i to point j. Index 0 is the start location;
 * indexes 1..n are the stops. Returns stop indexes (1..n) in visiting order.
 * Nearest-neighbour start, improved with 2-opt. Open route (no return to start).
 */
export function suggestOrder(matrix: number[][]): number[] {
  const n = matrix.length - 1;
  if (n <= 1) return n === 1 ? [1] : [];
  const left = new Set(Array.from({ length: n }, (_, i) => i + 1));
  const order: number[] = [];
  let cur = 0;
  while (left.size) {
    let best = -1;
    let bestCost = Infinity;
    for (const j of left) {
      const c = matrix[cur][j];
      if (c < bestCost || (c === bestCost && j < best)) { best = j; bestCost = c; }
    }
    order.push(best);
    left.delete(best);
    cur = best;
  }
  return twoOpt(order, matrix);
}

export function pathCost(order: number[], matrix: number[][]): number {
  let cost = 0;
  let prev = 0;
  for (const i of order) { cost += matrix[prev][i]; prev = i; }
  return cost;
}

function twoOpt(order: number[], matrix: number[][]): number[] {
  let best = order.slice();
  let bestCost = pathCost(best, matrix);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const cand = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
        const c = pathCost(cand, matrix);
        if (c + 1e-9 < bestCost) { best = cand; bestCost = c; improved = true; }
      }
    }
  }
  return best;
}
