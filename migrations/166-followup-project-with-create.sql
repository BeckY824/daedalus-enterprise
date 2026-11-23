-- 建项目同一次操作带出的首条沟通（2026-11-23，M-公海-54「建项目 + 首条沟通合计 1 次」）：新建项目、建档向导、只建客户、线索转项目、号码查重新建线索项目
-- 挂项目时写 1，之后不改；别的路（项目里记沟通、导入、同号留痕）一直是 0。三态额度重置判补录的首条沟通时，跳过同一次操作里先写下的建项目、首个节点。
-- 老数据一直是 0（行为同改前）；旧版本代码不读这一列照常能跑；只加不改。只放 ADD COLUMN（README 第 4 条）
ALTER TABLE "FollowUpProject" ADD COLUMN "withProjectCreate" BOOLEAN NOT NULL DEFAULT false;
