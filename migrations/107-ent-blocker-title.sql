-- 企业版卡点 11-01 改版：卡点加标题（老数据由启动后的一次性改版任务取描述前 20 字补上）。
-- 只放 ADD COLUMN（README 第 4 条）。同一版新加的认领明细、阻碍原因字典、原因关联三张表
-- 追加在 052-ent-blocker.sql 末尾（迁移编号只分到 107 一个，而加列文件里不许夹建表）。
ALTER TABLE "EntBlocker" ADD COLUMN "title" TEXT NOT NULL DEFAULT '';
