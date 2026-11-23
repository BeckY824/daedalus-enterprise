-- 企业版必填拦截记录（2026-11-23）：往前推节点被「缺必填」拦下时记一行，只记不报警。说明见 prisma/schema.prisma 的 EntRequiredBlock、lib/project/required-block.ts。
-- 规矩同 160：只加表、IF NOT EXISTS、每次启动整个重跑；指向人、项目、客户的列都不建外键（项目真删后行留着，导出写「已删」）。
-- 编号跳过 163（重复咨询分支已占）。
CREATE TABLE IF NOT EXISTS "EntRequiredBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "customerId" TEXT,
    "phase" TEXT NOT NULL,
    "node" TEXT NOT NULL,
    "toPhase" TEXT,
    "toNode" TEXT,
    "kind" TEXT NOT NULL,
    "missing" TEXT NOT NULL,
    "entry" TEXT NOT NULL,
    "onBehalf" BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS "EntRequiredBlock_at_idx" ON "EntRequiredBlock"("at");
CREATE INDEX IF NOT EXISTS "EntRequiredBlock_projectId_at_idx" ON "EntRequiredBlock"("projectId", "at");
