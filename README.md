# 赛鸽血统环号登记站 · 种鸽档案核验

运行：

```bash
npm start
```

访问 `http://localhost:3024`。

## 功能

- 鸽只档案：足环、鸽主、登记人、父母、羽色、棚号；疫苗、转让、归巢成绩实时档。
- 档案核验单（交付种鸽用）：
  - **申请（入口）**：在鸽只卡片上选鸽申请，生成编号（`HY日期-序号`）并保存申请时快照，默认 30 天有效。
  - **核验判断**：父母未建档、父母未登记、血统成环（含自环/多跳环）判为「待核」；问题消除后可「重新核验」。
  - **换人确认**：核验人必须与登记人不同；确认后把父母、鸽主、疫苗、转让、成绩**定格**。
  - **改档失效**：改档（含改父母档案）后，所有未过期且与快照不一致的凭据自动标「已失效」，逐条写明变化；已过期的不重复处理。
  - **重复确认**：沿用首次确认结果（确认人与定格快照不变）。
  - **比赛报名**：只有已确认单可报名（`BM日期-序号`），报名单永久携带确认时定格快照，之后改档仍按原快照。

## 分层

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 入口 | `server.js` | HTTP 路由、事务编排、入参校验、状态机 |
| 核验判断 | `lib/verify.js` | 血统核验（父母建档、成环 DFS）、核验人换人判断 |
| 快照存档 | `lib/snapshot.js`、`lib/store.js`、`lib/queue.js` | 编号、快照抓取与差异比对、落盘/过期/失效、写串行化 |
| 页面 | `lib/page.js` | 档案卡片、实时档查询改档、核验单与报名展示 |

写请求经 `runExclusive` 串行执行，内存中完成全部变更后以「临时文件 + 原子改名」一次性落盘，不留半张单。

## 主要接口

- `POST /api/pigeons` 建档
- `PATCH /api/pigeons/:ring` 改档（鸽主/父母/羽色/棚号）
- `POST /api/pigeons/:ring/(vaccines|transfers|races)` 追加记录
- `POST /api/pigeons/:ring/certificates` 申请核验单
- `POST /api/certificates/:no/recheck` 待核重新核验
- `POST /api/certificates/:no/confirm` 换人确认（body：`{"verifier":"姓名"}`）
- `POST /api/certificates/:no/entries` 报名比赛（body：`{"event":"赛事"}`）
- `GET /api/certificates`、`GET /api/race-entries` 列表
