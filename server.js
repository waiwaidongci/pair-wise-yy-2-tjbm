// 入口层：HTTP 路由与参数解析。核验判断在 lib/verify.js，
// 快照/凭据/报名在 lib/snapshot.js，页面在 public/index.html。
import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDb, saveDb } from "./lib/store.js";
import {
  VerifyError, createVerification, confirmVerification,
  mutatePigeon, enrollRace, presentForm, VALID_DAYS
} from "./lib/snapshot.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(__dirname, "public", "index.html"), "utf8");
const port = Number(process.env.PORT || 3024);

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function relation(db, ringNo) {
  const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
  if (!pigeon) return null;
  const father = db.pigeons.find(item => item.ringNo === pigeon.fatherRing) || null;
  const mother = db.pigeons.find(item => item.ringNo === pigeon.motherRing) || null;
  const children = db.pigeons.filter(item => item.fatherRing === ringNo || item.motherRing === ringNo);
  return { pigeon, father, mother, children };
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const db = await loadDb();
  const input = ["POST", "PATCH", "PUT"].includes(req.method) ? await body(req) : {};

  if (req.method === "GET" && p === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(page);
  }

  if (req.method === "GET" && p === "/api/pigeons") return sendJson(res, 200, db.pigeons);

  if (req.method === "POST" && p === "/api/pigeons") {
    if (!input.ringNo || !input.registrar) {
      throw new VerifyError(400, "ringNo_and_registrar_required");
    }
    if (db.pigeons.some(item => item.ringNo === input.ringNo)) throw new VerifyError(409, "ring_exists");
    const pigeon = {
      ringNo: input.ringNo,
      registrar: input.registrar,
      owner: input.owner || input.registrar,
      fatherRing: input.fatherRing || "",
      motherRing: input.motherRing || "",
      color: input.color || "",
      loft: input.loft || "",
      vaccines: [], transfers: [], races: []
    };
    db.pigeons.unshift(pigeon);
    await saveDb(db);
    return sendJson(res, 201, pigeon);
  }

  const relationMatch = p.match(/^\/api\/pigeons\/(.+)\/relation$/);
  if (relationMatch && req.method === "GET") {
    const data = relation(db, decodeURIComponent(relationMatch[1]));
    return data ? sendJson(res, 200, data) : sendJson(res, 404, { error: "pigeon_not_found" });
  }

  // 改档入口（鸽主/父母/羽色/棚号）：经 mutatePigeon 统一触发凭据失效。
  const pigeonMatch = p.match(/^\/api\/pigeons\/(.+)$/);
  if (pigeonMatch && req.method === "PATCH") {
    const ringNo = decodeURIComponent(pigeonMatch[1]);
    const allowed = ["owner", "fatherRing", "motherRing", "color", "loft"];
    const updates = Object.fromEntries(Object.entries(input).filter(([key]) => allowed.includes(key)));
    const pigeon = mutatePigeon(db, ringNo, target => { Object.assign(target, updates); });
    await saveDb(db);
    return sendJson(res, 200, pigeon);
  }

  // 疫苗 / 转让 / 成绩录入同样属于改档，会牵连未过期凭据标失效。
  const actionMatch = p.match(/^\/api\/pigeons\/(.+)\/(transfers|races|vaccines)$/);
  if (actionMatch && req.method === "POST") {
    const ringNo = decodeURIComponent(actionMatch[1]);
    const pigeon = mutatePigeon(db, ringNo, target => {
      if (actionMatch[2] === "transfers") {
        target.transfers.push({ date: input.date || today(), from: target.owner, to: input.to });
        target.owner = input.to;
      }
      if (actionMatch[2] === "races") {
        target.races.push({ date: input.date || today(), event: input.event, distance: Number(input.distance || 0), returnTime: input.returnTime || "", rank: Number(input.rank || 0) });
      }
      if (actionMatch[2] === "vaccines") {
        target.vaccines.push({ date: input.date || today(), name: input.name });
      }
    });
    await saveDb(db);
    return sendJson(res, 200, pigeon);
  }

  // ---- 档案核验单 ----------------------------------------------------------

  if (req.method === "GET" && p === "/api/verifications") {
    return sendJson(res, 200, { validDays: VALID_DAYS, verifications: db.verifications.map(form => presentForm(form)) });
  }
  if (req.method === "POST" && p === "/api/verifications") {
    const form = createVerification(db, input.ringNo, input.createdBy);
    await saveDb(db);
    return sendJson(res, 201, form);
  }
  const verifyMatch = p.match(/^\/api\/verifications\/(.+)\/confirm$/);
  if (verifyMatch && req.method === "POST") {
    const result = confirmVerification(db, decodeURIComponent(verifyMatch[1]), input.verifier);
    await saveDb(db);
    return sendJson(res, 200, result);
  }

  // ---- 比赛报名（沿用原快照） ----------------------------------------------

  if (req.method === "GET" && p === "/api/enrollments") return sendJson(res, 200, db.enrollments);
  if (req.method === "POST" && p === "/api/enrollments") {
    const enrollment = enrollRace(db, input.formId, input.raceEvent);
    await saveDb(db);
    return sendJson(res, 201, enrollment);
  }

  sendJson(res, 404, { error: "not_found" });
}

const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (error) {
    if (error instanceof VerifyError) {
      const payload = { error: error.code };
      if (error.reason) payload.reason = error.reason;
      if (error.blocked) payload.blocked = error.blocked;
      if (error.form) payload.form = error.form;
      return sendJson(res, error.status, payload);
    }
    if (error instanceof SyntaxError) return sendJson(res, 400, { error: "bad_json" });
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log(`Racing pigeon registry app listening on http://localhost:${port}`));
