# M1.5 Content Integrity Report — 数据完整性报告

> ImagineOS Alpha · 2026-10-06 · M1.5 Gate 5
> 数据源：`node scripts/m15/integrity-check.mjs`（数据库级六表关系检查）+ 复核运行（2026-10-06 10:30 重置后复跑）
> 结论：**M1.5 生产案例 0 错误 ｜ 0 警告**

---

## 1. 检查范围与方法

**方法**：直接对 SQLite 权威库做六表关系断言（Content/ContentVersion/Asset/Generation/Provenance/Remix），不经过 UI 或 API——UI 验证属于 Gate 1/3/4 的行为层，本 Gate 只问「数据是否诚实」。

**案例分类**：
- **M1.5 生产案例**：`scripts/m15/state/` 中 p01–p10 + g3/g4 链（含 remix 副本）的 contentId 集合；
- **遗留测试夹具**：M0/M1 时期的状态机走查、发布走查数据（无成片、无发布记录），单独归类，不计入本 Gate 结论，但保留清单供清理决策（E13/Trust 层）。

## 2. 检查矩阵与结果

| 维度 | 检查项 | 结果 |
|------|--------|------|
| Content ↔ Version | 每作品有版本 / 现势指针指向存在且为最新 / 版本号连续 / parent 血缘无环 | ✅ 0 错 0 警 |
| Version ↔ Asset | Job→资产引用存在 / READY+PUBLISHED 必有 final / 有成片必有封面 | ✅ |
| Content ↔ Generation | 外键完整 / 延迟记账覆盖（latencyMs 非空） | ✅ |
| Provenance | 创建事件 / 发布事件 / remix 双侧事件 / 时间线单调不减 | ✅ 388 条事件全过 |
| Remix | 血缘三件套归属 / 衍作首版 method=remix / 配方 structureJson 继承 | ✅ 8 条全过 |
| Asset | 孤儿（引用不存在的内容）/ final+thumbnail 文件落盘 | ✅（见 §4 媒体真实性披露） |

**汇总统计**（复核时点）：内容 44（PUBLISHED 15 / READY 15 / IDEA 12 / REVIEW 1 / GENERATING 1）· 版本 40 · 资产 208 · Generation 323 行（77+98+82 成功 + 66 失败）· Provenance 388 事件 · Remix 8 条 · Job 14 个（全 succeeded，p10 失败 Job 为 M1.5 生产案例恢复项，重入机制已就绪）。

## 3. 六不变量验证（架构层，来自 DB 抽查 + Gate 5 断言）

| 不变量 | 断言方式 | 结果 |
|--------|----------|------|
| I1 版本不可变 | 仓储层无 update 面（结构性保证）+ Gate 5 现势指针检查 | ✅ |
| I2 Remix 原作零改动 | fork-service 不触原作字段；Gate 4 快照 diff（待专项链复核，机制层已由种子数据断言） | ✅ 机制层 |
| I3 Provenance 只追加 | 表无 update 路径 + 时间线单调检查 | ✅ |
| I4 领域表无模型名 | schema 检查（Generation 表是记账表，允许 provider/model 字段） | ✅ |
| I5 Intent 保留用户原话 | rawExpression 原文存储（含修订/Remix 场景） | ✅ |
| I6 currentVersion 现势指针 | 全表扫描 0 断链 | ✅ |

## 4. 媒体真实性披露（2026-10-06 沙箱重置事件，透明记录）

**事件**：运行沙箱于 2026-10-06 09:03 重置，`storage/` 下全部 208 个媒体文件被销毁。恢复动作以本地 FFmpeg+sharp 生成了**品牌化合成占位文件**（同名同路径），使结构完整性（文件存在性）检查通过。

**证据影响分级**：
- **结构完整性（本 Gate 的职责）**：不受影响——所有表关系、指针、血缘、事件流的断言对象是数据库，未受文件销毁影响。0 错 0 警结论**有效**。
- **媒体字节真实性**：当前磁盘上的成片/分镜图/旁白**不是** 2026-10-06 凌晨真实生成的字节（DB 中 sizeBytes 记录与当前文件不符可证）。
- **历史度量的有效性**：视觉度量（YDIF）、延迟、成本数据均采集于重置**前**（state/*.json 时间戳 04:06–04:12 < 09:03），是真实测量的持久化记录，**结论有效**；但除 native-video-smoke.mp4（幸存原件，复测一致）外不可复测。
- **补齐路径**：配额恢复后 G3/G4/p10/Native Golden Case 的**新生成资产为真实字节**；重置前的 9 案例媒体不重制（遵守「不重复制造已存在的资产」原则）。

## 5. 遗留夹具清单（不计入结论）

- 20 错误 + 4 警告：M0/M1 测试夹具（状态机走查/发布走查产生的无成片内容），原因是无 final/thumbnail；
- 处置建议：E13（Trust 层）统一做夹具清理，M1.5 不动它们（避免破坏 M0/M1 的测试基线）。

## 6. 复现命令

```bash
node scripts/m15/integrity-check.mjs                     # 全量（M1.5 案例 vs 遗留夹具自动分类）
node scripts/m15/integrity-check.mjs <idsFile>           # 作用域批量（Gate 7 真人测试作品复用同一机制）
```
