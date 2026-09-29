// 快照存档层：数据载入、旧档迁移、过期判定、改档失效。
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diffSnapshot, today } from "./snapshot.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "pigeons.json");

const seed = {
  seq: 0,
  pigeons: [
    {
      ringNo: "CHN-2026-001", owner: "北岸棚", registrar: "老周", revision: 1,
      fatherRing: "CHN-2022-188", motherRing: "CHN-2023-512", color: "灰", loft: "北岸A棚",
      vaccines: [{ date: "2026-04-01", name: "新城疫" }],
      transfers: [{ date: "2026-04-15", from: "育种棚", to: "北岸棚" }],
      races: [{ date: "2026-06-01", event: "120公里训放", distance: 120, returnTime: "10:42", rank: 18 }]
    },
    { ringNo: "CHN-2022-188", owner: "育种棚", registrar: "老周", revision: 1, fatherRing: "", motherRing: "", color: "雨点", loft: "种鸽棚", vaccines: [], transfers: [], races: [] },
    { ringNo: "CHN-2023-512", owner: "育种棚", registrar: "老周", revision: 1, fatherRing: "", motherRing: "", color: "红轮", loft: "种鸽棚", vaccines: [], transfers: [], races: [] }
  ],
  certificates: [],
  raceEntries: []
};

// 凭据状态：待核 / 待确认 / 已确认 / 已失效 / 已过期
export const ACTIVE_STATUSES = ["待核", "待确认", "已确认"];

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
    return structuredCopy(seed);
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  migrate(db);
  sweepExpired(db, new Date());
  return db;
}

export async function saveDb(db) {
  // 写临时文件后原子改名：单次落盘，中断也不会留半张单。
  const tmp = dbPath + ".tmp";
  await writeFile(tmp, JSON.stringify(db, null, 2));
  await rename(tmp, dbPath);
}

function structuredCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

// 旧档补字段，保证登记人、版本号、核验单与报名集合存在。
function migrate(db) {
  if (!Number.isInteger(db.seq)) db.seq = 0;
  if (!Array.isArray(db.certificates)) db.certificates = [];
  if (!Array.isArray(db.raceEntries)) db.raceEntries = [];
  for (const pigeon of db.pigeons || []) {
    if (!pigeon.registrar) pigeon.registrar = pigeon.owner || "未署名";
    if (!Number.isInteger(pigeon.revision)) pigeon.revision = 1;
    pigeon.fatherRing ||= "";
    pigeon.motherRing ||= "";
    pigeon.vaccines ||= [];
    pigeon.transfers ||= [];
    pigeon.races ||= [];
  }
}

export function isExpired(certificate, now = new Date()) {
  return Boolean(certificate.expiresAt) && certificate.expiresAt < today(now);
}

// 到期但状态未刷新的凭据，在载入时统一标为“已过期”。
export function sweepExpired(db, now = new Date()) {
  let touched = false;
  for (const cert of db.certificates) {
    if (ACTIVE_STATUSES.includes(cert.status) && isExpired(cert, now)) {
      cert.status = "已过期";
      cert.invalidReason = `凭据已于 ${cert.expiresAt} 到期`;
      touched = true;
    }
  }
  return touched;
}

// 改档后：扫描所有未过期凭据（含本鸽及把它当父母引用的子代凭据），
// 快照与实时档不一致即标失效并写明变化。
export function invalidateCertificatesForPigeon(db, pigeon, now = new Date()) {
  let touched = false;
  for (const cert of db.certificates) {
    if (isExpired(cert, now) || !ACTIVE_STATUSES.includes(cert.status)) continue;
    const target = db.pigeons.find(item => item.ringNo === cert.ringNo);
    if (!target) continue;
    const changes = diffSnapshot(cert.snapshot, target, db);
    if (changes.length === 0) continue;
    cert.status = "已失效";
    cert.invalidatedAt = now.toISOString();
    cert.invalidReason = cert.ringNo === pigeon.ringNo
      ? "档案已修改，与快照不一致"
      : `档案所引用的${pigeon.ringNo === cert.snapshot.pigeon.fatherRing ? "父鸽" : "母鸽"} ${pigeon.ringNo} 已修改，与快照不一致`;
    cert.changes = changes;
    touched = true;
  }
  return touched;
}
