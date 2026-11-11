-- 项目按创建时间的索引（2026-11-11，项目列表改服务端分页）。
-- 项目列表点「创建时间」表头在全部筛选结果里排（lib/project/list.ts 读项目列表，sort=created-asc / created-desc），
-- 渠道页点数字进来按创建时间段筛（createdFrom / createdTo）：原来 Project 上没有 createdAt 的索引，每翻一页都把能看的全排一遍。
-- 3 万个项目的测试库：按创建时间排那一页原来整表扫 + 临时排序（约 35 ms），加了以后 SCAN USING INDEX Project_createdAt_idx，只剩同一刻的按主键排。
-- 只加索引，重跑不抛。
CREATE INDEX IF NOT EXISTS "Project_createdAt_idx" ON "Project"("createdAt");
