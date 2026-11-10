-- 项目留痕按「种类 + 原负责人」查的索引（2026-11-10，代码质量体检 5.3 / C 组）。
-- 原负责人回避名单（lib/project/pool-owner.ts 公海里历史负责人是：每次项目列表、每次算可见范围都查）、统一公海页、
-- 渠道看板进公海数都是 kind = 'pool-release' 起头，原来只有 (projectId, at) 一条索引，只能整表扫或从项目那头绕。
-- projectId 放最后：范围里「宽挡多出的项目」那句按项目逐个 EXISTS，三列都等值、不用回表。
-- 演示库副本（5446 个项目、6603 条留痕）实测：回避名单 0.92 → 0.015 ms，统一公海 0.22 → 0.03 ms，渠道看板 0.75 → 0.03 ms。
-- 只加索引，重跑不抛。
CREATE INDEX IF NOT EXISTS "ProjectNodeLog_kind_fromOwnerId_projectId_idx" ON "ProjectNodeLog"("kind", "fromOwnerId", "projectId");
