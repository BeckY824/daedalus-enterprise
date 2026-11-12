-- 企业版客户三态 · 沟通第一次被判为有效的时刻（2026-11-12，额度重置判「实时」用）：先存无效、后来改成有效的那条记改成有效的那一刻，写了不再改。
-- 没有这一行 = 按沟通建的时刻算（建的时候就有效的、存量老数据都是），所以不回填、迁移里也不许 INSERT。
-- 说明见 prisma/schema.prisma 的 EntFollowUpFirstValid。各版本都建这张表；沟通删了随沟通级联。
-- 规矩同 088：只加表、IF NOT EXISTS、每次启动整个重跑。
CREATE TABLE IF NOT EXISTS "EntFollowUpFirstValid" (
    "followUpId" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL,
    CONSTRAINT "EntFollowUpFirstValid_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "FollowUp" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
