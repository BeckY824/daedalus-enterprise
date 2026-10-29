-- 外贸订单 / 供应商整套 7 张表删掉（2026-10-29）。企业版只用项目，这几张表没有入口、也不再有代码读写。
-- 这是迁移目录里唯一许可的删除：只许 DROP TABLE IF EXISTS，而且只许这 7 张（tests/migrations.test.ts、
-- tests/migration-files-guard.test.ts 按白名单钉住）。别的表、别的列一律不动。
-- 每次启动整个目录重跑：016 / 017 / 023 会先把空表建回来（023 给新建的空表加列也不抛），到这里再删掉；
-- 删的都是空表，IF EXISTS 也不会抛。第一次升级时删的才是带数据的老表。
-- 先删子表再删父表：外键开着的话，删父表会先隐式清空它，子表还在就会被外键挡住。
-- 留着的表没有一张对它们建了外键：Attachment.orderId 那一列不带外键（041），列和索引都留着。
DROP TABLE IF EXISTS "FollowUpOrder";
DROP TABLE IF EXISTS "TradeOrderNode";
DROP TABLE IF EXISTS "TradeOrderDoc";
DROP TABLE IF EXISTS "TradeOrderPurchase";
DROP TABLE IF EXISTS "SupplierQuote";
DROP TABLE IF EXISTS "TradeOrder";
DROP TABLE IF EXISTS "Supplier";
