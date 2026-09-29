// 快照存档层：生成编号、抓取实时档快照、对比改档变化。
export function today(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function deepClone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

// 每日从 001 开始的核验单编号，如 HY20260929-001。
export function nextCertificateNo(certificates, now = new Date()) {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  const prefix = `HY${day}-`;
  let max = 0;
  for (const cert of certificates) {
    if (typeof cert.no === "string" && cert.no.startsWith(prefix)) {
      const n = Number(cert.no.slice(prefix.length));
      if (Number.isInteger(n) && n > max) max = n;
    }
  }
  return prefix + String(max + 1).padStart(3, "0");
}

export function nextEntryNo(entries, now = new Date()) {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  const prefix = `BM${day}-`;
  let max = 0;
  for (const entry of entries) {
    if (typeof entry.no === "string" && entry.no.startsWith(prefix)) {
      const n = Number(entry.no.slice(prefix.length));
      if (Number.isInteger(n) && n > max) max = n;
    }
  }
  return prefix + String(max + 1).padStart(3, "0");
}

// 抓取某只鸽的实时档：父母、鸽主、疫苗、转让和成绩，连同父母档摘要一起定格。
export function buildSnapshot(db, pigeon, now = new Date()) {
  const parentOf = ring => {
    if (!ring) return null;
    const p = db.pigeons.find(item => item.ringNo === ring);
    if (!p) return { ringNo: ring, missing: true };
    return {
      ringNo: p.ringNo,
      owner: p.owner,
      color: p.color,
      loft: p.loft,
      fatherRing: p.fatherRing || "",
      motherRing: p.motherRing || ""
    };
  };
  return {
    at: now.toISOString(),
    revision: pigeon.revision,
    pigeon: {
      ringNo: pigeon.ringNo,
      owner: pigeon.owner,
      fatherRing: pigeon.fatherRing || "",
      motherRing: pigeon.motherRing || "",
      color: pigeon.color,
      loft: pigeon.loft,
      registrar: pigeon.registrar
    },
    father: parentOf(pigeon.fatherRing),
    mother: parentOf(pigeon.motherRing),
    vaccines: deepClone(pigeon.vaccines || []),
    transfers: deepClone(pigeon.transfers || []),
    races: deepClone(pigeon.races || [])
  };
}

function summarizeList(list) {
  return (list || []).map(item => JSON.stringify(item)).join("|");
}

// 改档后核对快照与实时档的差异，作为失效说明；无差异返回空数组。
export function diffSnapshot(snapshot, pigeon, db) {
  const changes = [];
  const live = {
    owner: pigeon.owner,
    fatherRing: pigeon.fatherRing || "",
    motherRing: pigeon.motherRing || "",
    color: pigeon.color,
    loft: pigeon.loft
  };
  const labels = {
    owner: "鸽主",
    fatherRing: "父鸽足环",
    motherRing: "母鸽足环",
    color: "羽色",
    loft: "棚号"
  };
  for (const key of Object.keys(live)) {
    const oldVal = snapshot.pigeon[key];
    if (oldVal !== live[key]) {
      changes.push(`${labels[key]}：${oldVal || "空"} → ${live[key] || "空"}`);
    }
  }
  // 父母本鸽被改（环号没变但父母自己的档变了）
  for (const side of ["father", "mother"]) {
    const ring = snapshot.pigeon[side === "father" ? "fatherRing" : "motherRing"];
    if (!ring) continue;
    const now = parentBrief(db, ring);
    const before = snapshot[side];
    if (!before) continue;
    if (!now) {
      changes.push(`${side === "father" ? "父鸽" : "母鸽"} ${ring} 档案已删除`);
    } else if (now.missing) {
      if (!before.missing) changes.push(`${side === "father" ? "父鸽" : "母鸽"} ${ring} 档案已缺失`);
    } else {
      const fields = ["owner", "color", "loft", "fatherRing", "motherRing"];
      for (const f of fields) {
        if ((before[f] ?? "") !== (now[f] ?? "")) {
          changes.push(`${side === "father" ? "父鸽" : "母鸽"} ${ring} 信息变化`);
          break;
        }
      }
    }
  }
  const compares = [
    ["vaccines", "疫苗", item => `${item.date} ${item.name}`],
    ["transfers", "转让", item => `${item.date} ${item.from}→${item.to}`],
    ["races", "成绩", item => `${item.date} ${item.event} 第${item.rank}名`]
  ];
  for (const [key, label, fmt] of compares) {
    const oldList = snapshot[key] || [];
    const newList = pigeon[key] || [];
    if (summarizeList(oldList.map(fmt)) !== summarizeList(newList.map(fmt))) {
      changes.push(`${label}记录由 ${oldList.length} 条变为 ${newList.length} 条`);
    }
  }
  return changes;
}

function parentBrief(db, ring) {
  const p = db.pigeons.find(item => item.ringNo === ring);
  if (!p) return { ringNo: ring, missing: true };
  return {
    ringNo: p.ringNo,
    owner: p.owner,
    color: p.color,
    loft: p.loft,
    fatherRing: p.fatherRing || "",
    motherRing: p.motherRing || ""
  };
}
