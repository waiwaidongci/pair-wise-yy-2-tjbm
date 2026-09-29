// 快照存档的底层：单库文件加载 + 迁移 + 原子落盘。
// 核验单、凭据失效与报名共用同一份 db，任何写操作都以一次整体保存完成，
// 保证“不能留半张单”。
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "pigeons.json");
const tmpPath = `${dbPath}.tmp`;

const seed = {
  seqDate: "",
  seqNo: 0,
  verifications: [],
  enrollments: [],
  pigeons: [
    { ringNo: "CHN-2026-001", registrar: "王登记", owner: "北岸棚", fatherRing: "CHN-2022-188", motherRing: "CHN-2023-512", color: "灰", loft: "北岸A棚", vaccines: [{ date: "2026-04-01", name: "新城疫" }], transfers: [{ date: "2026-04-15", from: "育种棚", to: "北岸棚" }], races: [{ date: "2026-06-01", event: "120公里训放", distance: 120, returnTime: "10:42", rank: 18 }] },
    { ringNo: "CHN-2022-188", registrar: "王登记", owner: "育种棚", fatherRing: "", motherRing: "", color: "雨点", loft: "种鸽棚", vaccines: [], transfers: [], races: [] },
    { ringNo: "CHN-2023-512", registrar: "王登记", owner: "育种棚", fatherRing: "", motherRing: "", color: "红轮", loft: "种鸽棚", vaccines: [], transfers: [], races: [] }
  ]
};

function migrate(db) {
  if (!Array.isArray(db.pigeons)) db.pigeons = [];
  if (!Array.isArray(db.verifications)) db.verifications = [];
  if (!Array.isArray(db.enrollments)) db.enrollments = [];
  if (typeof db.seqDate !== "string") db.seqDate = "";
  if (typeof db.seqNo !== "number") db.seqNo = 0;
  for (const pigeon of db.pigeons) {
    if (typeof pigeon.registrar !== "string") pigeon.registrar = "原登记人";
    for (const key of ["fatherRing", "motherRing"]) {
      if (typeof pigeon[key] !== "string") pigeon[key] = "";
    }
    for (const key of ["vaccines", "transfers", "races"]) {
      if (!Array.isArray(pigeon[key])) pigeon[key] = [];
    }
  }
  return db;
}

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  return migrate(JSON.parse(await readFile(dbPath, "utf8")));
}

// 原子保存：先写临时文件再 rename，确认动作（定格快照、状态翻转）整体落盘，
// 进程中断时不会出现“快照定格了但状态还是待核”的半张单。
export async function saveDb(db) {
  await writeFile(tmpPath, JSON.stringify(db, null, 2));
  await rename(tmpPath, dbPath);
}
