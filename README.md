# 种鸽交付 · 档案核验站

运行：

```bash
npm start
```

访问 `http://localhost:3024`，页面分三区：档案、核验单、比赛报名。

## 分层

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 入口 | `server.js` | HTTP 路由、参数解析，不写业务判断 |
| 核验判断 | `lib/verify.js` | 父母建档、血统成环、核验人≠登记人 |
| 快照存档 | `lib/snapshot.js` | 编号、建单、确认定格、改档失效、报名沿用快照 |
| 页面 | `public/index.html` | 三个操作区与凭据/快照展示 |

数据落盘在 `lib/store.js`，整库原子写（临时文件 + rename），确认动作不会留半张单。

## 核验单规则

- **选鸽建单**：生成编号 `JY年月日-当日流水`，并定格一份快照（父母、鸽主、羽色棚号、疫苗、转让、成绩）。
  - 父母环号未声明/有环号但未建档、或父母链血统成环 → 单子为「待核」，列出待核原因；补档/解环后可再确认。
- **确认定格**：核验人与登记人相同时必须换人（400）；核验项通过才确认，定格最新快照，有效期 14 天。
- **重复确认**：沿用首次确认结果（核验人、快照均不变），返回 `reused: true`。
- **改档失效**：改本鸽或其父母档案、新增/删除疫苗、转让、成绩后，所有引用它且**未过期**的已确认凭据标为失效，并记录逐条变化说明；待核单不动，已过期/已失效单不重复标记。
- **比赛报名**：只能用有效凭据报名；报名复制凭据确认时的**原快照**，之后改档或凭据失效，已报名记录不变。

## 主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/verifications` | 选鸽建单 `{ringNo, createdBy}` |
| POST | `/api/verifications/:id/confirm` | 核验人确认 `{verifier}` |
| GET | `/api/verifications` | 核验单列表（含 `effective/expired` 派生状态） |
| PATCH | `/api/pigeons/:ringNo` | 改档（owner/fatherRing/motherRing/color/loft） |
| POST | `/api/pigeons/:ringNo/vaccines\|transfers\|races` | 录入疫苗/转让/成绩，同样触发凭据失效 |
| POST | `/api/enrollments` | 凭据报名 `{formId, raceEvent}` |
| GET | `/api/enrollments` | 报名列表（含原快照） |
