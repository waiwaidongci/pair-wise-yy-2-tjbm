// 快照存档层：编号、建单、确认定格、改档失效、比赛报名沿用原快照。
// 所有函数直接在传入的 db 上操作并返回结果，由入口层 loadDb → 本层 → saveDb
// 包成一次原子读写，确认动作不会留下半张单。
import { randomUUID } from "node:crypto";
import { evaluatePigeon, verifierCheck } from "./verify.js";

export const VALID_DAYS = 14; // 核验单确认后 14 天内有效，过期不再被改档标失效

export class VerifyError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
const clone = value => JSON.parse(JSON.stringify(value));
const empty = value => value === "" || value === undefined || value === null;

// 凭据是否已过期（失效优先于过期；待核单没有有效期概念）。
export function isExpired(form, at = nowIso()) {
  return form.status === "confirmed" && !!form.expiresAt && form.expiresAt < at;
}

// 对外视图：补一个派生的 effective 字段，状态本身不因过期被改写。
export function presentForm(form, at = nowIso()) {
  return { ...form, expired: isExpired(form, at), effective: form.status === "confirmed" && !isExpired(form, at) };
}

// 选鸽定格内容：父母、鸽主、羽色棚号、疫苗、转让、成绩。
// 父母未建档时保留环号并标 missing，供待核单说明情况。
export function takeSnapshot(pigeons, pigeon) {
  const parent = ring => {
    if (empty(ring)) return { ringNo: "" };
    const filed = pigeons.find(item => item.ringNo === ring);
    return filed
      ? { ringNo: filed.ringNo, owner: filed.owner, color: filed.color, loft: filed.loft }
      : { ringNo: ring, missing: true };
  };
  return {
    takenAt: nowIso(),
    ringNo: pigeon.ringNo,
    owner: pigeon.owner,
    color: pigeon.color,
    loft: pigeon.loft,
    father: parent(pigeon.fatherRing),
    mother: parent(pigeon.motherRing),
    vaccines: clone(pigeon.vaccines),
    transfers: clone(pigeon.transfers),
    races: clone(pigeon.races)
  };
}

// 核验单编号：JY + 年月日 + 当日三位流水。
function nextSerial(db) {
  const day = today();
  if (db.seqDate !== day) { db.seqDate = day; db.seqNo = 0; }
  db.seqNo += 1;
  return `JY${day.replace(/-/g, "")}-${String(db.seqNo).padStart(3, "0")}`;
}

// 入口动作①：选鸽生成编号与快照；父母未建档或血统成环时为待核。
export function createVerification(db, ringNo, createdBy) {
  const operator = String(createdBy || "").trim();
  if (!operator) throw new VerifyError(400, "operator_required");
  const result = evaluatePigeon(db.pigeons, ringNo);
  if (!result) throw new VerifyError(404, "pigeon_not_found");
  const form = {
    id: randomUUID(),
    serial: nextSerial(db),
    ringNo,
    registrar: result.pigeon.registrar,
    status: result.ready ? "pending" : "blocked", // 待核：等待补档/解环后确认
    blocked: result.blocked.map(item => item.reason),
    snapshot: takeSnapshot(db.pigeons, result.pigeon),
    checksAtCreation: result.checks,
    createdBy: operator,
    createdAt: nowIso(),
    verifier: null,
    confirmChecks: null,
    confirmedAt: null,
    expiresAt: null,
    invalidations: []
  };
  db.verifications.push(form);
  return presentForm(form);
}

// 入口动作②：核验人确认。核验人与登记人相同 → 换人；
// 仍有未过项 → 维持待核并返回最新原因；
// 全部通过 → 重新取当前档案快照并定格父母、鸽主、疫苗、转让、成绩。
// 重复确认沿用首次结果（幂等）；已失效单不可再确认。
export function confirmVerification(db, id, verifier) {
  const form = db.verifications.find(item => item.id === id);
  if (!form) throw new VerifyError(404, "form_not_found");
  if (form.status === "invalid") throw new VerifyError(409, "form_invalid");
  if (form.status === "confirmed") {
    return { reused: true, form: presentForm(form) }; // 首次结果原样返回
  }

  const pigeon = db.pigeons.find(item => item.ringNo === form.ringNo);
  if (!pigeon) throw new VerifyError(409, "pigeon_missing");
  const identity = verifierCheck(verifier, pigeon.registrar);
  if (!identity.pass) throw new VerifyError(400, "verifier_conflict", { reason: identity.reason });

  const result = evaluatePigeon(db.pigeons, form.ringNo);
  if (!result.ready) {
    form.status = "blocked";
    form.blocked = result.blocked.map(item => item.reason);
    form.snapshot = takeSnapshot(db.pigeons, pigeon); // 待核单也保留选鸽当时到此刻的最新样貌
    throw new VerifyError(422, "verification_blocked", { blocked: form.blocked, form: presentForm(form) });
  }

  // 定格：一次写入完成状态翻转 + 最新快照 + 有效期，不允许半成品。
  form.verifier = String(verifier).trim();
  form.status = "confirmed";
  form.blocked = [];
  form.confirmChecks = result.checks;
  form.snapshot = takeSnapshot(db.pigeons, pigeon);
  form.confirmedAt = nowIso();
  const expires = new Date(form.confirmedAt);
  expires.setUTCDate(expires.getUTCDate() + VALID_DAYS);
  form.expiresAt = expires.toISOString();
  return { reused: false, form: presentForm(form, form.confirmedAt) };
}

// ---- 改档比对：说明“变了什么” -------------------------------------------------

function fieldChanges(before, after, fields, prefix = "") {
  const notes = [];
  for (const field of fields) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      notes.push(`${prefix}${fieldLabel(field)}：${before[field] || "空"} → ${after[field] || "空"}`);
    }
  }
  return notes;
}
function fieldLabel(field) {
  return { owner: "鸽主", fatherRing: "父鸽环号", motherRing: "母鸽环号", color: "羽色", loft: "棚号" }[field] || field;
}
function listChanges(before, after, key, describe) {
  const notes = [];
  const signature = item => JSON.stringify(item);
  const oldList = before[key] || [];
  const newList = after[key] || [];
  const oldSigs = new Set(oldList.map(signature));
  const newSigs = new Set(newList.map(signature));
  for (const item of newList.filter(entry => !oldSigs.has(signature(entry)))) notes.push(`新增${describe(item)}`);
  for (const item of oldList.filter(entry => !newSigs.has(signature(entry)))) notes.push(`删除${describe(item)}`);
  return notes;
}

function ownDiff(before, after) {
  return [
    ...fieldChanges(before, after, ["owner", "fatherRing", "motherRing", "color", "loft"]),
    ...listChanges(before, after, "vaccines", item => `疫苗：${item.date} ${item.name}`),
    ...listChanges(before, after, "transfers", item => `转让：${item.date} ${item.from}→${item.to}`),
    ...listChanges(before, after, "races", item => `成绩：${item.date} ${item.event} 第${item.rank}名`)
  ];
}
function parentDiff(role, frozenParent, current) {
  if (!current || frozenParent.missing) {
    return [`${role === "father" ? "父鸽" : "母鸽"} ${frozenParent.ringNo || ""} 档案状态变化`.trim()];
  }
  return fieldChanges(frozenParent, current, ["owner", "color", "loft"], `${role === "father" ? "父鸽" : "母鸽"}（${current.ringNo}）`);
}

// 改档后统一收口：未过期的已确认凭据标失效并写明变化；待核单不动（还不是凭据），
// 已过期/已失效的不再重复标记。
export function invalidateAffected(db, ringNo, before, after, at = nowIso()) {
  for (const form of db.verifications) {
    if (form.status !== "confirmed" || isExpired(form, at)) continue;
    let notes = [];
    if (form.ringNo === ringNo) notes = ownDiff(before, after);
    else if (form.snapshot.father.ringNo === ringNo) notes = parentDiff("father", form.snapshot.father, after);
    else if (form.snapshot.mother.ringNo === ringNo) notes = parentDiff("mother", form.snapshot.mother, after);
    if (notes.length) {
      form.status = "invalid";
      form.invalidations.push({ at, ringNo, changes: notes });
    }
  }
}

// 改档动作的统一包装：拷贝改前档案 → 执行修改 → 落差异 → 关联凭据失效。
export function mutatePigeon(db, ringNo, mutate) {
  const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
  if (!pigeon) throw new VerifyError(404, "pigeon_not_found");
  const before = clone(pigeon);
  mutate(pigeon);
  invalidateAffected(db, ringNo, before, pigeon);
  return pigeon;
}

// ---- 比赛报名：始终按报名时凭据里的原快照，凭据事后失效不影响已报名 ----------

export function enrollRace(db, formId, raceEvent) {
  const event = String(raceEvent || "").trim();
  if (!event) throw new VerifyError(400, "event_required");
  const form = db.verifications.find(item => item.id === formId);
  if (!form) throw new VerifyError(404, "form_not_found");
  if (form.status === "invalid") throw new VerifyError(409, "form_invalid");
  if (form.status !== "confirmed") throw new VerifyError(409, "form_not_confirmed");
  if (isExpired(form)) throw new VerifyError(409, "form_expired");
  const enrollment = {
    id: randomUUID(),
    enrollNo: `BM${today().replace(/-/g, "")}-${String(db.enrollments.length + 1).padStart(3, "0")}`,
    raceEvent: event,
    formId,
    formSerial: form.serial,
    ringNo: form.ringNo,
    // 复制快照而非引用实时档案：之后改档、凭据失效都不改变报名内容。
    snapshot: clone(form.snapshot),
    enrolledAt: nowIso()
  };
  db.enrollments.push(enrollment);
  return enrollment;
}
