-- 手动选的分配方向（2026-11-18，审核 11-18 P0-1）：市场成员建档选自动分配时手动改成的内贸 / 外贸，存在 Project.assignDir；
-- 空 = 没改过（老数据一直是空，按 区域 → 电话 → 本人事业部 现算，和改之前一样）。旧版本代码不读这一列照常能跑；只加不改，不动旧数据。
-- 只放 ADD COLUMN（README 第 4 条）
ALTER TABLE "Project" ADD COLUMN "assignDir" TEXT;
