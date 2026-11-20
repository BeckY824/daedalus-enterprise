-- 跨类型查重（11-20：号码不分类型、全公司唯一）用的号键索引。说明见 src/lib/enterprise/contact-dedupe.ts 的「跨类SQL」。
-- 微信格、WhatsApp 格里存成「+34 690 74 35 55」「139-0000-0123」这类带分隔符写法的老号，要按号键（同 021 的 号键SQL）比；
-- 没索引的话每查一个号都把 CustomerExtra 7 万行整张扫一遍（c2 副本实测每次约 22ms，保存一个号要查 4 次左右）。
-- 联系人表只有几千行、老库迁移路径上没有 wechat 列，不加索引（contact-dedupe.ts 里先原样比、带分隔符的再按号键比）。
-- 式子必须和 号键SQL 原样一致（tests/ent-contact-dedupe.test.ts 钉着查询计划）。规矩同前：只加索引、IF NOT EXISTS、每次启动整个重跑。
CREATE INDEX IF NOT EXISTS "CustomerExtra_wechatPhoneKey_idx" ON "CustomerExtra"(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace("wechat", '０', '0'), '１', '1'), '２', '2'), '３', '3'), '４', '4'), '５', '5'), '６', '6'), '７', '7'), '８', '8'), '９', '9'), ' ', ''), '　', ''), '-', ''), '－', ''), '—', ''), '(', ''), ')', ''), '（', ''), '）', ''), '+', ''));
CREATE INDEX IF NOT EXISTS "CustomerExtra_whatsappPhoneKey_idx" ON "CustomerExtra"(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace("whatsapp", '０', '0'), '１', '1'), '２', '2'), '３', '3'), '４', '4'), '５', '5'), '６', '6'), '７', '7'), '８', '8'), '９', '9'), ' ', ''), '　', ''), '-', ''), '－', ''), '—', ''), '(', ''), ')', ''), '（', ''), '）', ''), '+', ''));
