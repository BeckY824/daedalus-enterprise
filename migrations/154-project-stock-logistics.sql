-- 企业版项目加「备货状态」「物流状态」「物流单号」（2026-11-19，客户 11-19：「生产备货」新增备货状态，「物流运输」新增物流状态、物流单号）。
-- stockStatus：备货状态（未生产 / 生产中 / 已备货，lib/project/proj-fields.ts 备货状态们）；
-- logisticsStatus：物流状态（字典 projLogistics 里的一项，默认 待发货 / 运输中 / 已签收，设置里可改）；trackingNo：物流单号（一行文字）。
-- 都可空，老项目从空开始，不回填。项目详情就地改、编辑项目框、完成节点框能填，也进节点必填目录。
-- 旧版本代码不读这三列照常能跑；只加不改。只放 ADD COLUMN（README 第 4 条）
ALTER TABLE "Project" ADD COLUMN "stockStatus" TEXT;
ALTER TABLE "Project" ADD COLUMN "logisticsStatus" TEXT;
ALTER TABLE "Project" ADD COLUMN "trackingNo" TEXT;
