import http from "node:http";
import { runExclusive } from "./lib/queue.js";
import {
  ACTIVE_STATUSES,
  invalidateCertificatesForPigeon,
  loadDb,
  saveDb,
  sweepExpired
} from "./lib/store.js";
import { buildSnapshot, deepClone, nextCertificateNo, nextEntryNo, today } from "./lib/snapshot.js";
import { checkPedigree, checkVerifier } from "./lib/verify.js";
import { renderPage } from "./lib/page.js";

const port = Number(process.env.PORT || 3024);
const DEFAULT_VALID_DAYS = 30;

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function fail(res, status, error, message) {
  return sendJson(res, status, { error, message });
}
function relation(db, ringNo) {
  const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
  if (!pigeon) return null;
  const father = db.pigeons.find(item => item.ringNo === pigeon.fatherRing) || null;
  const mother = db.pigeons.find(item => item.ringNo === pigeon.motherRing) || null;
  const children = db.pigeons.filter(item => item.fatherRing === ringNo || item.motherRing === ringNo);
  return { pigeon, father, mother, children };
}
function defaultExpiresAt(now) {
  return today(new Date(now.getTime() + DEFAULT_VALID_DAYS * 86400000));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;

    if (req.method === "GET" && p === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderPage());
    }

    // ---------- 只读接口 ----------
    if (req.method === "GET" && (p === "/api/pigeons" || p === "/api/certificates" || p === "/api/race-entries")) {
      const db = await loadDb();
      const key = { "/api/pigeons": "pigeons", "/api/certificates": "certificates", "/api/race-entries": "raceEntries" }[p];
      return sendJson(res, 200, db[key]);
    }
    const relationMatch = p.match(/^\/api\/pigeons\/(.+)\/relation$/);
    if (req.method === "GET" && relationMatch) {
      const db = await loadDb();
      const data = relation(db, decodeURIComponent(relationMatch[1]));
      return data ? sendJson(res, 200, data) : fail(res, 404, "pigeon_not_found", "未找到该足环号档案");
    }
    const certGetMatch = p.match(/^\/api\/certificates\/(.+)$/);
    if (req.method === "GET" && certGetMatch) {
      const db = await loadDb();
      const cert = db.certificates.find(item => item.no === decodeURIComponent(certGetMatch[1]));
      return cert ? sendJson(res, 200, cert) : fail(res, 404, "certificate_not_found", "核验单不存在");
    }
    const pigeonGetMatch = p.match(/^\/api\/pigeons\/(.+)$/);
    if (req.method === "GET" && pigeonGetMatch) {
      const db = await loadDb();
      const pigeon = db.pigeons.find(item => item.ringNo === decodeURIComponent(pigeonGetMatch[1]));
      return pigeon ? sendJson(res, 200, pigeon) : fail(res, 404, "pigeon_not_found", "未找到该足环号档案");
    }

    // ---------- 写接口：串行事务，全部改完一次落盘 ----------
    const result = await runExclusive(() => handleMutation(req, p));
    return sendJson(res, result.status, result.data);
  } catch (error) {
    if (error instanceof SyntaxError) return fail(res, 400, "bad_json", error.message);
    return fail(res, 500, "internal_error", error.message);
  }
});

async function handleMutation(req, p) {
  const input = ["POST", "PATCH", "PUT"].includes(req.method) ? await body(req) : {};
  const db = await loadDb();
  const now = new Date();
  const reply = (status, data) => ({ status, data });

  // 建档案
  if (req.method === "POST" && p === "/api/pigeons") {
    if (!input.ringNo || !input.owner) return reply(400, { error: "missing_fields", message: "足环号和鸽主必填" });
    if (db.pigeons.some(item => item.ringNo === input.ringNo)) {
      return reply(409, { error: "ring_exists", message: "该足环号已建档" });
    }
    const pigeon = {
      ringNo: input.ringNo,
      owner: input.owner,
      registrar: input.registrar || input.owner,
      fatherRing: input.fatherRing || "",
      motherRing: input.motherRing || "",
      color: input.color || "",
      loft: input.loft || "",
      revision: 1,
      vaccines: [], transfers: [], races: []
    };
    db.pigeons.unshift(pigeon);
    await saveDb(db);
    return reply(201, pigeon);
  }

  // 改档案（鸽主、父母、羽色、棚号）
  const pigeonPatchMatch = p.match(/^\/api\/pigeons\/(.+)$/);
  if (req.method === "PATCH" && pigeonPatchMatch) {
    const pigeon = db.pigeons.find(item => item.ringNo === decodeURIComponent(pigeonPatchMatch[1]));
    if (!pigeon) return reply(404, { error: "pigeon_not_found", message: "未找到该足环号档案" });
    const editable = ["owner", "fatherRing", "motherRing", "color", "loft"];
    let changed = false;
    for (const key of editable) {
      if (!(key in input)) continue;
      const value = key === "owner" ? String(input[key] || "").trim() : String(input[key] ?? "");
      if (key === "owner" && !value) return reply(400, { error: "owner_required", message: "鸽主不能为空" });
      if ((pigeon[key] || "") !== value) { pigeon[key] = value; changed = true; }
    }
    if (changed) {
      pigeon.revision += 1;
      invalidateCertificatesForPigeon(db, pigeon, now);
    }
    await saveDb(db);
    return reply(200, pigeon);
  }

  // 疫苗 / 转让 / 成绩（成绩指历史归巢成绩）
  const actionMatch = p.match(/^\/api\/pigeons\/(.+)\/(transfers|races|vaccines)$/);
  if (req.method === "POST" && actionMatch) {
    const pigeon = db.pigeons.find(item => item.ringNo === decodeURIComponent(actionMatch[1]));
    if (!pigeon) return reply(404, { error: "pigeon_not_found", message: "未找到该足环号档案" });
    const kind = actionMatch[2];
    if (kind === "transfers") {
      if (!input.to) return reply(400, { error: "to_required", message: "受让方必填" });
      pigeon.transfers.push({ date: input.date || today(now), from: pigeon.owner, to: input.to });
      pigeon.owner = input.to;
    }
    if (kind === "races") {
      pigeon.races.push({
        date: input.date || today(now), event: input.event || "未命名赛事",
        distance: Number(input.distance || 0), returnTime: input.returnTime || "", rank: Number(input.rank || 0)
      });
    }
    if (kind === "vaccines") {
      if (!input.name) return reply(400, { error: "name_required", message: "疫苗名称必填" });
      pigeon.vaccines.push({ date: input.date || today(now), name: input.name });
    }
    pigeon.revision += 1;
    invalidateCertificatesForPigeon(db, pigeon, now);
    await saveDb(db);
    return reply(200, pigeon);
  }

  // 入口：选鸽申请核验单 → 生成编号与快照，同步做核验判断
  const applyMatch = p.match(/^\/api\/pigeons\/(.+)\/certificates$/);
  if (req.method === "POST" && applyMatch) {
    const pigeon = db.pigeons.find(item => item.ringNo === decodeURIComponent(applyMatch[1]));
    if (!pigeon) return reply(404, { error: "pigeon_not_found", message: "未找到该足环号档案" });
    const issues = checkPedigree(db, pigeon);
    const certificate = {
      no: nextCertificateNo(db.certificates, now),
      ringNo: pigeon.ringNo,
      createdAt: now.toISOString(),
      registrar: input.registrar || pigeon.registrar || pigeon.owner,
      status: issues.length ? "待核" : "待确认",
      issues,
      snapshot: buildSnapshot(db, pigeon, now),
      expiresAt: input.expiresAt || defaultExpiresAt(now),
      frozen: null,
      confirmedBy: null,
      confirmedAt: null,
      invalidReason: null,
      invalidatedAt: null,
      changes: null
    };
    db.certificates.unshift(certificate);
    await saveDb(db);
    return reply(201, certificate);
  }

  const certMatch = p.match(/^\/api\/certificates\/([^/]+)(?:\/(confirm|recheck|entries))?$/);
  if (["POST"].includes(req.method) && certMatch) {
    const no = decodeURIComponent(certMatch[1]);
    const action = certMatch[2];
    const cert = db.certificates.find(item => item.no === no);
    if (!cert) return reply(404, { error: "certificate_not_found", message: "核验单不存在" });

    // 确认：核验人不能与登记人相同；通过后定格快照
    if (action === "confirm") {
      // 重复确认沿用首次结果：无论之后凭据是否失效/过期，都返回首次定格，不产生新动作
      if (cert.status === "已确认" || (cert.frozen && cert.confirmedBy)) {
        return reply(200, { reused: true, certificate: cert });
      }
      if (cert.status === "待核") {
        return reply(422, { error: "cert_pending_issues", message: "核验单仍有待核问题，请先复核处理", certificate: cert });
      }
      if (cert.status === "已失效") {
        return reply(409, { error: "cert_invalid", message: `核验单已失效：${cert.invalidReason || "档案已变化"}`, certificate: cert });
      }
      if (cert.status === "已过期") {
        return reply(409, { error: "cert_expired", message: `核验单已于 ${cert.expiresAt} 过期`, certificate: cert });
      }
      const verifierCheck = checkVerifier(cert, input.verifier);
      if (!verifierCheck.ok) return reply(422, { error: verifierCheck.code, message: verifierCheck.message });

      const pigeon = db.pigeons.find(item => item.ringNo === cert.ringNo);
      if (!pigeon) return reply(404, { error: "pigeon_not_found", message: "足环号档案已不存在，无法确认" });
      // 定格前再防一次：快照版本落后则先失效，不允许确认
      if (pigeon.revision !== cert.snapshot.revision) {
        cert.status = "已失效";
        cert.invalidatedAt = now.toISOString();
        cert.invalidReason = "确认时发现档案版本落后于实时档";
        cert.changes = ["档案在确认前已被修改"];
        await saveDb(db);
        return reply(409, { error: "snapshot_stale", message: cert.invalidReason, certificate: cert });
      }
      cert.status = "已确认";
      cert.confirmedBy = String(input.verifier).trim();
      cert.confirmedAt = now.toISOString();
      cert.frozen = { ...deepClone(cert.snapshot), lockedAt: now.toISOString() };
      await saveDb(db);
      return reply(200, { reused: false, certificate: cert });
    }

    // 待核复核：父母已补档/血统环解除后，重新抓取快照并判断
    if (action === "recheck") {
      if (cert.status !== "待核") {
        return reply(409, { error: "cert_not_pending", message: `当前状态为“${cert.status}”，无需复核`, certificate: cert });
      }
      const pigeon = db.pigeons.find(item => item.ringNo === cert.ringNo);
      if (!pigeon) return reply(404, { error: "pigeon_not_found", message: "足环号档案已不存在" });
      cert.snapshot = buildSnapshot(db, pigeon, now);
      cert.issues = checkPedigree(db, pigeon);
      if (cert.issues.length === 0) cert.status = "待确认";
      await saveDb(db);
      return reply(200, cert);
    }

    // 报名比赛：以确认时定格的快照报名，之后改档仍按原快照
    if (action === "entries") {
      if (cert.status !== "已确认") {
        return reply(409, { error: "cert_not_confirmed", message: `核验单状态为“${cert.status}”，只有已确认凭据可报名`, certificate: cert });
      }
      if (!input.event) return reply(400, { error: "event_required", message: "赛事名称必填" });
      const entry = {
        no: nextEntryNo(db.raceEntries, now),
        certNo: cert.no,
        ringNo: cert.ringNo,
        event: input.event,
        date: input.date || today(now),
        registeredAt: now.toISOString(),
        snapshot: deepClone(cert.frozen)
      };
      db.raceEntries.unshift(entry);
      await saveDb(db);
      return reply(201, entry);
    }
  }

  return reply(404, { error: "not_found", message: "接口不存在" });
}

server.listen(port, () => console.log(`Racing pigeon registry app listening on http://localhost:${port}`));
