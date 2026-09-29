// 核验判断层：只做规则判断，不碰存储。
// 返回 issues：空数组代表血统可通过（进入“待确认”），有问题则“待核”。
export function checkPedigree(db, pigeon) {
  const issues = [];
  const byRing = ring => db.pigeons.find(item => item.ringNo === ring);

  for (const [side, ring, label] of [
    ["father", pigeon.fatherRing || "", "父鸽"],
    ["mother", pigeon.motherRing || "", "母鸽"]
  ]) {
    if (!ring) {
      issues.push({ code: "parent_empty", side, message: `${label}未登记` });
      continue;
    }
    if (ring === pigeon.ringNo) {
      issues.push({ code: "pedigree_cycle", side, message: `血统成环：${pigeon.ringNo} 不能作为自己的${label}` });
      continue;
    }
    if (!byRing(ring)) {
      issues.push({ code: "parent_not_filed", side, ring, message: `${label} ${ring} 未建档` });
    }
  }

  const cycle = findCycle(db, pigeon.ringNo);
  // 直接把自己登记成父母的情况已在上方单独提示，这里只报长度 ≥3 的环。
  if (cycle && cycle.length >= 3) {
    issues.push({ code: "pedigree_cycle", path: cycle, message: `血统成环：${cycle.join(" → ")}` });
  }
  return issues;
}

// 沿父母链做深度优先搜索；命中当前目标即视为成环。
function findCycle(db, startRing, depthLimit = 500) {
  const byRing = ring => db.pigeons.find(item => item.ringNo === ring);
  const walk = (ring, path, seen, depth) => {
    if (depth > depthLimit) return null;
    const pigeon = byRing(ring);
    if (!pigeon) return null;
    for (const parentRingRaw of [pigeon.fatherRing, pigeon.motherRing]) {
      const parentRing = parentRingRaw || "";
      if (!parentRing) continue;
      if (parentRing === startRing) return [...path, parentRing];
      if (seen.has(parentRing)) continue;
      const found = walk(parentRing, [...path, parentRing], new Set(seen).add(parentRing), depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(startRing, [startRing], new Set([startRing]), 0);
}

// 核验人与登记人不能相同。
export function checkVerifier(certificate, verifier) {
  if (!verifier || !String(verifier).trim()) {
    return { ok: false, code: "verifier_required", message: "核验人必填" };
  }
  if (String(verifier).trim() === String(certificate.registrar).trim()) {
    return { ok: false, code: "verifier_same_as_registrar", message: "核验人与登记人相同，请换人确认" };
  }
  return { ok: true };
}
