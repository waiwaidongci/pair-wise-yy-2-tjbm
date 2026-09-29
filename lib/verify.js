// 核验判断层：只负责“这只鸽子、这份单现在是什么状态/能不能过”，
// 不落盘、不编号、不生成最终快照（快照由 snapshot 层负责）。

// 父母是否建档：留空属于未声明，有环号但库里查不到属于未建档。
export function parentChecks(pigeons, pigeon) {
  const find = ring => pigeons.find(item => item.ringNo === ring) || null;
  const checks = [];
  for (const [label, ring] of [["父鸽", pigeon.fatherRing], ["母鸽", pigeon.motherRing]]) {
    if (!ring) {
      checks.push({ item: `${label}建档`, pass: false, reason: `${label}环号未声明，待建档` });
    } else if (!find(ring)) {
      checks.push({ item: `${label}建档`, pass: false, reason: `${label} ${ring} 未建档` });
    } else {
      checks.push({ item: `${label}建档`, pass: true, reason: `${label} ${ring} 已建档` });
    }
  }
  return checks;
}

// 血统成环：沿父母链向上 DFS。起点环号再次出现在祖先链上即为成环，
// 返回从再次出现处开始的闭环环号链。
export function bloodlineCycle(pigeons, rootRingNo) {
  const byRing = new Map(pigeons.map(p => [p.ringNo, p]));
  const stack = [];
  function dfs(ring) {
    if (stack.includes(ring)) return stack.slice(stack.indexOf(ring)).concat(ring);
    const pigeon = byRing.get(ring);
    if (!pigeon) return null;
    stack.push(ring);
    for (const parent of [pigeon.fatherRing, pigeon.motherRing]) {
      if (!parent) continue;
      const cycle = dfs(parent);
      if (cycle) return cycle;
    }
    stack.pop();
    return null;
  }
  return dfs(rootRingNo);
}

// 汇总一只鸽子当前的全部核验项：父母建档 + 血统成环。
export function evaluatePigeon(pigeons, ringNo) {
  const pigeon = pigeons.find(item => item.ringNo === ringNo);
  if (!pigeon) return null;
  const checks = parentChecks(pigeons, pigeon);
  const cycle = bloodlineCycle(pigeons, ringNo);
  if (cycle) {
    checks.push({ item: "血统成环", pass: false, reason: `血统链成环：${cycle.join(" → ")}` });
  } else {
    checks.push({ item: "血统成环", pass: true, reason: "父母链未发现成环" });
  }
  const blocked = checks.filter(check => !check.pass);
  return { pigeon, checks, blocked, ready: blocked.length === 0 };
}

// 核验人与登记人不能相同（相同就换人确认），同时校验核验人非空。
export function verifierCheck(verifier, registrar) {
  const name = String(verifier || "").trim();
  if (!name) return { pass: false, reason: "核验人姓名不能为空" };
  if (name === String(registrar || "").trim()) {
    return { pass: false, reason: `核验人与登记人均为“${name}”，须换人确认` };
  }
  return { pass: true, reason: "核验人与登记人不同" };
}
