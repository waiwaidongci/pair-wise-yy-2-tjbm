// 页面层：只负责展示与交互编排，规则判断全部来自接口返回。
export function renderPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>种鸽档案核验站</title>
  <style>
    :root { --bg:#eff2f5; --panel:#fff; --ink:#1f2833; --muted:#697786; --line:#d3dce4; --accent:#315f83; --red:#9b3f35; --amber:#9a6b1f; --green:#2f6d4a; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:24px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; } h2 { margin:0 0 12px; font-size:18px; } h3 { margin:0; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:8px 12px; font-weight:700; cursor:pointer; }
    button.ghost { background:#e8eef3; color:var(--accent); } button.danger { background:var(--red); } button.smallbtn { padding:5px 9px; font-size:12px; }
    .toolbar { display:grid; grid-template-columns:1fr auto; gap:10px; margin-bottom:14px; } .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; }
    .card { display:grid; gap:8px; align-content:start; } .meta { color:var(--muted); font-size:13px; }
    .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 10px; font-size:12px; white-space:nowrap; }
    .pill.ok { color:var(--green); border-color:var(--green); } .pill.warn { color:var(--amber); border-color:var(--amber); } .pill.bad { color:var(--red); border-color:var(--red); } .pill.info { color:var(--accent); border-color:var(--accent); }
    .section { margin-top:14px; } .relation { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:14px; } .small { background:#f8fafb; border:1px solid var(--line); border-radius:8px; padding:10px; }
    .cert { border-left:4px solid var(--accent); } .cert.待核, .cert.待确认 { border-left-color:var(--amber); } .cert.已确认 { border-left-color:var(--green); } .cert.已失效 { border-left-color:var(--red); } .cert.已过期 { border-left-color:var(--muted); }
    .issue { color:var(--red); font-size:13px; } .change { color:var(--red); font-size:13px; margin:2px 0; } .frozen { background:#f4f8f4; border:1px dashed var(--green); border-radius:6px; padding:8px; font-size:13px; }
    .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; } .row > input { flex:1; min-width:120px; }
    #toast { position:fixed; right:20px; bottom:20px; display:none; background:#2b3540; color:#fff; padding:12px 16px; border-radius:8px; max-width:360px; font-size:14px; z-index:9; }
    .stamp { font-size:12px; color:var(--muted); }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} .relation{grid-template-columns:1fr;} }
  </style>
</head>
<body>
  <header><div><h1>种鸽档案核验站</h1><div class="meta">血统 · 疫苗 · 转让 · 成绩 —— 核验通过即定格</div></div><button id="reload">刷新</button></header>
  <main>
    <form id="form">
      <h2>创建鸽只档案</h2>
      <label>足环号</label><input name="ringNo" required>
      <label>鸽主</label><input name="owner" required>
      <label>登记人</label><input name="registrar" placeholder="默认同鸽主">
      <label>父鸽足环号</label><input name="fatherRing">
      <label>母鸽足环号</label><input name="motherRing">
      <label>羽色</label><input name="color" required>
      <label>出生棚号</label><input name="loft" required>
      <div style="margin-top:12px"><button>保存档案</button></div>
    </form>
    <section>
      <div class="toolbar"><input id="search" placeholder="输入足环号查询血统/实时档"><button id="searchBtn">查询</button></div>
      <div class="panel" id="detail"></div>
      <div class="section"><h2>鸽只档案（实时档）</h2><div class="grid" id="cards"></div></div>
      <div class="section"><h2>档案核验单</h2><div class="grid" id="certs"></div></div>
      <div class="section"><h2>比赛报名（按确认时快照）</h2><div class="grid" id="entries"></div></div>
    </section>
  </main>
  <div id="toast"></div>
  <script>
    const cards = document.querySelector("#cards");
    const detail = document.querySelector("#detail");
    const certsEl = document.querySelector("#certs");
    const entriesEl = document.querySelector("#entries");
    const search = document.querySelector("#search");
    let pigeons = [], certificates = [], entries = [], currentRing = "";

    function esc(v) { return String(v ?? "").replace(/[&<>"']/g, s => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[s])); }
    function toast(msg, bad) { const t = document.querySelector("#toast"); t.textContent = msg; t.style.background = bad ? "#7a342d" : "#2b3540"; t.style.display = "block"; clearTimeout(t._timer); t._timer = setTimeout(() => t.style.display = "none", 4000); }
    async function api(path, options) {
      const opts = options && options.body ? { ...options, headers: { "Content-Type": "application/json" } } : options;
      const res = await fetch(path, opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "请求失败");
      return data;
    }

    function statusPill(s) {
      const cls = { "待确认": "warn", "待核": "warn", "已确认": "ok", "已失效": "bad", "已过期": "info" }[s] || "info";
      return '<span class="pill ' + cls + '">' + esc(s) + '</span>';
    }

    function renderCards() {
      cards.innerHTML = pigeons.map(p =>
        '<article class="card"><div class="row" style="justify-content:space-between"><h3>' + esc(p.ringNo) + '</h3>' +
        '<button class="smallbtn" data-apply="' + esc(p.ringNo) + '">申请核验单</button></div>' +
        '<span class="pill">' + esc(p.owner) + '</span><div class="meta">登记人：' + esc(p.registrar) + ' · v' + p.revision + '<br>' + esc(p.color) + ' · ' + esc(p.loft) + '</div>' +
        '<div>父：' + esc(p.fatherRing || "未登记") + '</div><div>母：' + esc(p.motherRing || "未登记") + '</div>' +
        '<div class="meta">疫苗 ' + (p.vaccines?.length || 0) + ' 条 · 转让 ' + (p.transfers?.length || 0) + ' 条 · 成绩 ' + (p.races?.length || 0) + ' 条</div>' +
        '<label>录入转让（新归属人）</label><div class="row"><input data-to="' + esc(p.ringNo) + '" placeholder="新鸽主"><button class="ghost smallbtn" data-transfer="' + esc(p.ringNo) + '">转让</button></div>' +
        '<label>录入疫苗</label><div class="row"><input data-vac="' + esc(p.ringNo) + '" placeholder="疫苗名称"><button class="ghost smallbtn" data-vacbtn="' + esc(p.ringNo) + '">保存</button></div>' +
        '<label>归巢成绩（赛事/距离/名次）</label><div class="row"><input data-race="' + esc(p.ringNo) + '" placeholder="200公里/200/6"><button class="ghost smallbtn" data-score="' + esc(p.ringNo) + '">保存</button></div>' +
        '</article>').join("");

      document.querySelectorAll("[data-apply]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.apply;
        const pigeon = pigeons.find(p => p.ringNo === ringNo);
        const registrar = prompt("核验单登记人（不能与核验人相同）", pigeon.registrar || pigeon.owner || "");
        if (registrar === null) return;
        try {
          const cert = await api('/api/pigeons/' + encodeURIComponent(ringNo) + '/certificates', { method: "POST", body: JSON.stringify({ registrar }) });
          await load();
          toast(cert.no + " 已生成：" + cert.status + (cert.issues.length ? "（" + cert.issues.map(i => i.message).join("；") + "）" : ""), cert.issues.length > 0);
        } catch (e) { toast(e.message, true); }
      });
      document.querySelectorAll("[data-transfer]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.transfer; const to = document.querySelector('[data-to="' + ringNo + '"]').value.trim();
        if (!to) return toast("请填写受让方", true);
        try { await api('/api/pigeons/' + encodeURIComponent(ringNo) + '/transfers', { method: "POST", body: JSON.stringify({ to }) }); await load(); toast("转让已记录，未过期凭据已复核失效状态"); }
        catch (e) { toast(e.message, true); }
      });
      document.querySelectorAll("[data-vacbtn]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.vacbtn; const name = document.querySelector('[data-vac="' + ringNo + '"]').value.trim();
        if (!name) return toast("请填写疫苗名称", true);
        try { await api('/api/pigeons/' + encodeURIComponent(ringNo) + '/vaccines', { method: "POST", body: JSON.stringify({ name }) }); await load(); toast("疫苗已记录，未过期凭据已复核失效状态"); }
        catch (e) { toast(e.message, true); }
      });
      document.querySelectorAll("[data-score]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.score; const raw = document.querySelector('[data-race="' + ringNo + '"]').value.split("/");
        try {
          await api('/api/pigeons/' + encodeURIComponent(ringNo) + '/races', { method: "POST", body: JSON.stringify({ event: raw[0]?.trim() || "未命名赛事", distance: Number(raw[1] || 0), rank: Number(raw[2] || 0) }) });
          await load(); toast("成绩已记录，未过期凭据已复核失效状态");
        } catch (e) { toast(e.message, true); }
      });
    }

    function renderRelation(data) {
      if (!data) { detail.innerHTML = '<h2>血统查询</h2><p class="meta">请输入足环号查看父母、子代、疫苗、转让和成绩，并可直接改档。</p>'; return; }
      const p = data.pigeon;
      currentRing = p.ringNo;
      detail.innerHTML =
        '<h2>' + esc(p.ringNo) + ' 实时档 ' + statusPill("v" + p.revision) + '</h2>' +
        '<div class="relation"><div class="small"><b>父鸽</b><br>' + esc(data.father?.ringNo || p.fatherRing || "未登记") + (data.father ? "" : (p.fatherRing ? ' <span class="issue">未建档</span>' : "")) + '</div>' +
        '<div class="small"><b>本鸽</b><br>' + esc(p.owner) + ' · ' + esc(p.color) + '<br><span class="stamp">登记人 ' + esc(p.registrar) + '</span></div>' +
        '<div class="small"><b>母鸽</b><br>' + esc(data.mother?.ringNo || p.motherRing || "未登记") + (data.mother ? "" : (p.motherRing ? ' <span class="issue">未建档</span>' : "")) + '</div></div>' +
        '<div class="meta"><b>子代</b>：' + esc(data.children.map(c => c.ringNo).join("、") || "暂无") + '</div>' +
        '<div class="meta"><b>疫苗</b>：' + esc(p.vaccines.map(v => v.date + " " + v.name).join(" / ") || "暂无") + '</div>' +
        '<div class="meta"><b>转让</b>：' + esc(p.transfers.map(t => t.date + " " + t.from + "→" + t.to).join(" / ") || "暂无") + '</div>' +
        '<div class="meta"><b>归巢成绩</b>：' + esc(p.races.map(r => r.date + " " + r.event + " 第" + r.rank + "名").join(" / ") || "暂无") + '</div>' +
        '<div class="section small"><b>改档</b>（保存后未过期核验单自动标失效）' +
        '<div class="row"><label style="flex:1">鸽主<input id="e-owner" value="' + esc(p.owner) + '"></label><label style="flex:1">羽色<input id="e-color" value="' + esc(p.color) + '"></label></div>' +
        '<div class="row"><label style="flex:1">父环<input id="e-father" value="' + esc(p.fatherRing) + '"></label><label style="flex:1">母环<input id="e-mother" value="' + esc(p.motherRing) + '"></label></div>' +
        '<label>棚号<input id="e-loft" value="' + esc(p.loft) + '"></label>' +
        '<div style="margin-top:8px"><button id="saveEdit" data-ring="' + esc(p.ringNo) + '">保存改档</button></div></div>';
      document.querySelector("#saveEdit").onclick = async () => {
        const ringNo = document.querySelector("#saveEdit").dataset.ring;
        const patch = {
          owner: document.querySelector("#e-owner").value.trim(),
          color: document.querySelector("#e-color").value.trim(),
          fatherRing: document.querySelector("#e-father").value.trim(),
          motherRing: document.querySelector("#e-mother").value.trim(),
          loft: document.querySelector("#e-loft").value.trim()
        };
        try { await api('/api/pigeons/' + encodeURIComponent(ringNo), { method: "PATCH", body: JSON.stringify(patch) }); await load(); document.querySelector("#search").value = ringNo; renderRelation(await api('/api/pigeons/' + encodeURIComponent(ringNo) + '/relation')); toast("改档已保存，受影响凭据已标失效并记录变化"); }
        catch (e) { toast(e.message, true); }
      };
    }

    function renderCerts() {
      if (!certificates.length) { certsEl.innerHTML = '<p class="meta">暂无核验单，在鸽只卡片上点击“申请核验单”生成。</p>'; return; }
      certsEl.innerHTML = certificates.map(c => {
        const s = c.snapshot, f = c.frozen;
        const frozenView = (src, lockedText) =>
          '<div class="frozen">' + lockedText + '<br>' +
          '父母：' + esc((src.father ? (src.father.ringNo + (src.father.missing ? "(未建档)" : "")) : "未登记") + " × " + (src.mother ? (src.mother.ringNo + (src.mother.missing ? "(未建档)" : "")) : "未登记")) + '<br>' +
          '鸽主：' + esc(src.pigeon.owner) + '　羽色：' + esc(src.pigeon.color) + '　棚号：' + esc(src.pigeon.loft) + '<br>' +
          '疫苗：' + esc(src.vaccines.map(v => v.name).join("、") || "无") + '<br>' +
          '转让：' + esc(src.transfers.map(t => t.from + "→" + t.to).join(" / ") || "无") + '<br>' +
          '成绩：' + esc(src.races.map(r => r.event + "第" + r.rank + "名").join(" / ") || "无") + '</div>';
        let actions = "";
        if (c.status === "待核") actions = '<div class="row"><button class="ghost smallbtn" data-recheck="' + esc(c.no) + '">重新核验</button></div>';
        if (c.status === "待确认") actions = '<div class="row"><input data-verifier="' + esc(c.no) + '" placeholder="核验人姓名（须与登记人不同）"><button class="smallbtn" data-confirm="' + esc(c.no) + '">换人确认</button></div>';
        if (c.status === "已确认") actions = '<div class="row"><input data-event="' + esc(c.no) + '" placeholder="报名赛事，如500公里决赛"><button class="smallbtn" data-entry="' + esc(c.no) + '">按定格快照报名</button></div>';
        return '<article class="card cert ' + esc(c.status) + '">' +
          '<div class="row" style="justify-content:space-between"><h3>' + esc(c.no) + '</h3>' + statusPill(c.status) + '</div>' +
          '<div class="meta">足环 ' + esc(c.ringNo) + ' · 登记人 ' + esc(c.registrar) + '<br>生成 ' + esc(s.at.replace("T", " ").slice(0, 19)) + ' · 有效期至 ' + esc(c.expiresAt) + ' · 快照 v' + s.revision + '</div>' +
          (c.issues?.length ? c.issues.map(i => '<div class="issue">⚠ ' + esc(i.message) + '</div>').join("") : '<div class="meta">血统核验通过</div>') +
          (c.status === "已确认" && f ? frozenView(f, "🔒 已定格（确认人 " + esc(c.confirmedBy) + "，" + esc(c.confirmedAt.replace("T", " ").slice(0, 19)) + "）：") : (c.status === "待核" || c.status === "待确认" ? frozenView(s, "📷 申请时快照（确认后定格）：") : frozenView(s, "📷 失效前快照："))) +
          (c.invalidReason ? '<div class="small"><b class="issue">失效说明：</b> ' + esc(c.invalidReason) + (c.changes?.length ? c.changes.map(ch => '<div class="change">· ' + esc(ch) + '</div>').join("") : "") + '</div>' : "") +
          (c.confirmedBy && c.status !== "已确认" ? '<div class="stamp">确认人：' + esc(c.confirmedBy) + '</div>' : "") +
          actions + '</article>';
      }).join("");

      document.querySelectorAll("[data-recheck]").forEach(btn => btn.onclick = async () => {
        try { const c = await api('/api/certificates/' + encodeURIComponent(btn.dataset.recheck) + '/recheck', { method: "POST", body: "{}" }); await load(); toast("重新核验完成：" + c.status + (c.issues.length ? "（" + c.issues.map(i => i.message).join("；") + "）" : ""), c.issues.length > 0); }
        catch (e) { toast(e.message, true); }
      });
      document.querySelectorAll("[data-confirm]").forEach(btn => btn.onclick = async () => {
        const no = btn.dataset.confirm;
        const verifier = document.querySelector('[data-verifier="' + no + '"]').value.trim();
        try {
          const r = await api('/api/certificates/' + encodeURIComponent(no) + '/confirm', { method: "POST", body: JSON.stringify({ verifier }) });
          await load();
          toast(r.reused ? "重复确认：沿用首次确认结果" : "已确认，父母/鸽主/疫苗/转让/成绩已定格");
        } catch (e) { toast(e.message, true); }
      });
      document.querySelectorAll("[data-entry]").forEach(btn => btn.onclick = async () => {
        const no = btn.dataset.entry;
        const ev = document.querySelector('[data-event="' + no + '"]').value.trim();
        if (!ev) return toast("请填写赛事名称", true);
        try { const e = await api('/api/certificates/' + encodeURIComponent(no) + '/entries', { method: "POST", body: JSON.stringify({ event: ev }) }); await load(); toast("报名成功 " + e.no + "，按原定格快照存档"); }
        catch (err) { toast(err.message, true); }
      });
    }

    function renderEntries() {
      if (!entries.length) { entriesEl.innerHTML = '<p class="meta">暂无比赛报名。</p>'; return; }
      entriesEl.innerHTML = entries.map(e => {
        const s = e.snapshot;
        return '<article class="card"><div class="row" style="justify-content:space-between"><h3>' + esc(e.no) + '</h3><span class="pill ok">已报名</span></div>' +
          '<div class="meta">赛事：' + esc(e.event) + ' (' + esc(e.date) + ')<br>足环：' + esc(e.ringNo) + ' · 核验单：' + esc(e.certNo) + '</div>' +
          '<div class="frozen">🔒 报名按原快照：鸽主 ' + esc(s.pigeon.owner) + '｜父母 ' + esc((s.father?.ringNo || "未登记") + " × " + (s.mother?.ringNo || "未登记")) + '<br>疫苗 ' + esc(s.vaccines.map(v => v.name).join("、") || "无") + '｜成绩 ' + esc(s.races.map(r => r.event).join("、") || "无") + '</div>' +
          '<div class="stamp">报名时间 ' + esc(e.registeredAt.replace("T", " ").slice(0, 19)) + '</div></article>';
      }).join("");
    }

    async function load() {
      [pigeons, certificates, entries] = await Promise.all([api("/api/pigeons"), api("/api/certificates"), api("/api/race-entries")]);
      renderCards(); renderCerts(); renderEntries();
      if (currentRing && pigeons.some(p => p.ringNo === currentRing)) {
        const q = currentRing; currentRing = ""; document.querySelector("#search").value = q;
        renderRelation(await api('/api/pigeons/' + encodeURIComponent(q) + '/relation'));
      }
    }
    document.querySelector("#searchBtn").onclick = async () => {
      try { renderRelation(await api('/api/pigeons/' + encodeURIComponent(search.value.trim()) + '/relation')); }
      catch (e) { toast(e.message, true); }
    };
    document.querySelector("#reload").onclick = () => load().then(() => toast("已刷新"));
    document.querySelector("#form").onsubmit = async event => {
      event.preventDefault();
      const form = document.querySelector("#form");
      try {
        await api("/api/pigeons", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
        form.reset(); await load(); toast("档案已创建");
      } catch (e) { toast(e.message, true); }
    };
    load().catch(e => toast(e.message, true));
  </script>
</body>
</html>`;
}
