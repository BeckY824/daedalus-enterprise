-- 企业版选项字典（2026-10-26）：分配方式、回收原因、无效原因、转让原因、验证结果、客户状态、项目标签，一张表按 kind 分。
-- 说明见 prisma/schema.prisma 的 EntDictItem。默认值由 lib/enterprise/dict.ts 第一次读时补，这里不 INSERT；
-- 桌面端、团队版也建这张空表，不读。规矩同 044-ent-org：只加表、IF NOT EXISTS、每次启动整个重跑、不建外键。
CREATE TABLE IF NOT EXISTS "EntDictItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "EntDictItem_kind_name_key" ON "EntDictItem"("kind", "name");
