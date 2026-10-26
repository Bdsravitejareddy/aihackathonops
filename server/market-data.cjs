'use strict';

function allocateParentTotal(total, children) {
  if (!Number.isFinite(total)) throw new TypeError('total must be a finite number');
  if (!Array.isArray(children) || children.length === 0) throw new TypeError('children must be a non-empty array');
  const ids = new Set();
  let weightSum = 0;
  for (const child of children) {
    if (!child || child.id === undefined || child.id === null || ids.has(child.id)) {
      throw new TypeError('children must have unique ids');
    }
    ids.add(child.id);
    if (!Number.isFinite(child.weight) || child.weight < 0) throw new RangeError('weights must be finite and non-negative');
    weightSum += child.weight;
  }
  if (Math.abs(weightSum - 1) > 1e-9) throw new RangeError('weights must sum to one');
  return children.map(child => ({ id: child.id, value: total * child.weight }));
}

module.exports = { allocateParentTotal };
