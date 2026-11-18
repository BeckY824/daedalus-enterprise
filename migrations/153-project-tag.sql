-- 项目标签（2026-11-18，F-项目-14）：字典 projTag 里的一项（A 重点推进 / B 潜力跟进 / C 正常培育），存在 Project.projTag。
-- 和项目级别 level（迁移 093）是两列、各自填、互不关联（11-08 定）；老数据一律从空开始，不从 level 推、不迁数据。
-- 旧版本代码不读这一列照常能跑；只加不改。只放 ADD COLUMN（README 第 4 条）
ALTER TABLE "Project" ADD COLUMN "projTag" TEXT;
