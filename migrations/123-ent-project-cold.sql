-- 企业版冷项目（2026-11-11，机制表 M-公海-22）：线索 / 商机项目太久没换节点、也没有挂在它上面的沟通，标「冷」，只点名、不自动收。
-- 有这一行 = 这个项目现在是冷的；不冷了删掉这一行。记从哪天冷的、提醒到第几级。
-- 说明见 prisma/schema.prisma 的 EntProjectCold。只在企业版写；桌面端、团队版也建这张空表，不读。
-- 规矩同 088：只加表、IF NOT EXISTS、每次启动整个重跑；项目删了随项目级联。日子存上海时间的 YYYY-MM-DD。
CREATE TABLE IF NOT EXISTS "EntProjectCold" (
    "projectId" TEXT NOT NULL PRIMARY KEY,
    "coldDay" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EntProjectCold_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
