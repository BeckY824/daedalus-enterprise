-- 企业版客户属性（2026-10-31 会议，F-客户-04）：自用非商用 / 个人投资者……，选项在企业版字典 custAttr，客户看板按它分列。别的版本一直是空。
-- 只放 ADD COLUMN（README 第 4 条）。已部署库里字典项的启用 / 停用 / 排序不在这里改，见 scripts/sync-cust-attr.mjs
ALTER TABLE "Customer" ADD COLUMN "customerAttr" TEXT;
