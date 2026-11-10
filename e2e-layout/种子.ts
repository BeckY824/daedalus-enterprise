/**
 * 发版前排版闸门的「像真客户」数据（2026-10-19 团队版主动排查；总控：这几天的显示 bug 全是客户先发现的）。
 *
 * 照客户手上真有的样子造：商机名一整句英文（品名 + 条款 + 目的国 + 目标价 + 数量）、英国公司全大写长名、
 * T/T 30/70、US$ 1,234,567.89、一位客户挂好几个商机、几种状态和等级（供应商 / 订单 2026-10-29 连表删了）。
 * 名字、号码都是编的，不是任何真客户。id 固定前缀 gate-，重复跑先删后建。
 * 10-28 起排版闸门只跑企业版：长名字、长句给 e2e-layout/企业版.ts 造项目用。
 */

export const 长句商机 = "chicken breast BFQ. Exw. 10kg/Box. Country is Turkmenistan / Tadjikistan. Target price is 1300$, quantity 500 tons";
export const 客户们 = [
  { k: "scandi", name: "SCANDI PAK EUROPE LTD", country: "英国", level: "A 级", source: "展会获取", follow: "跟进中", decision: "意向强" },
  // 这一位的来源、职级、行业都用长选项（企业版.ts 起服务前写进业务配置；10-22 排版普查：长选项、长字段名才露出字压字、Tag 盖住旁边一列）
  { k: "long-uk", name: "THE INTERNATIONAL GROUP OF SCANDINAVIAN FOOD PACKAGING AND COLD CHAIN LOGISTICS HOLDINGS LIMITED (UK BRANCH)", country: "英国", level: "B 级", source: "LinkedInSalesNavigatorOutboundCampaignAutumn2026", follow: "待跟进", decision: "了解中",
    school: "THE INTERNATIONAL GROUP OF SCANDINAVIAN FOOD PACKAGING HOLDINGS LIMITED / شركة النور للأغذية المجمدة", grade: "SeniorProcurementManagerForFrozenPoultryAndSeafoodImports", major: "冷冻禽肉水产品及清真认证肉类产品进出口批发与零售连锁" },
  { k: "turkmen", name: "Türkmen Azyk Önümleri Hojalyk Jemgyýeti «Altyn Asyr Trading»", country: "土库曼斯坦", level: "A 级", source: "阿里国际站", follow: "跟进中", decision: "比价中" },
  { k: "nospace", name: "AlRashidTradingAndContractingCompanyLimitedJebelAliFreeZoneAuthority", country: "阿联酋", level: "C 级", source: "WhatsApp", follow: "已成交", decision: "已签约" },
  { k: "cn-long", name: "深圳市宝安区福永街道某某照明电器科技股份有限公司东莞分公司（外贸二部 / 中东大区）", country: "沙特阿拉伯", level: "B 级", source: "老客户返单", follow: "跟进中", decision: "意向强" },
  { k: "arabic", name: "شركة النور للتجارة والمقاولات الكهربائية المحدودة", country: "沙特阿拉伯", level: "A 级", source: "领英", follow: "待跟进", decision: "了解中" },
];

/**
 * D-25 验收后进闸门的长名字（2026-10-22）：一整段询盘、长网址、长中文、中英混排，各一条；再加一个长英文名的同事挂大额卡。
 * 10-28 商机页删了，这几条改作企业版闸门的项目名（e2e-layout/企业版.ts），项目看板 / 列表 / 详情都会量到。
 * 金额只放到 8 位（US$ 12,345,678.90）：9 位美元在 1280 一排五列时还会多出几像素，审 #87 时记成建议，没算进这批
 */
export const 长段商机 = "Inquiry from website form: We are looking for a reliable supplier of frozen chicken breast BFQ skinless boneless, IQF, 150-250g per piece, packed 10kg/carton, Halal certified, for monthly shipments of 4 x 40ft reefer containers to Mersin, Turkey, starting December. Please quote CIF and FOB with payment terms.";
export const 长网址商机 = "https://www.scandipak-europe.example.co.uk/procurement/rfq/2026/10/frozen-chicken-breast-bfq-exw-10kg-box-turkmenistan-tadjikistan?ref=whatsapp&lang=en";
export const 长中文商机 = "冷冻去骨去皮鸡胸肉单冻每块一百五十到二百五十克十公斤一箱清真认证每月四个四十尺冷柜发往土耳其梅尔辛港十二月开始要求报到岸价和离岸价并注明付款方式和交期";
export const 混排商机 = "【年度框架】Frozen chicken feet grade A 35g+ · 冷冻凤爪 A 级 · CIF 香港 HK$ · T/T 30/70 · 每月 2×40'RF · 客户编号 ALRASHID-JAFZA-2026-Q4-000987";
export const 长名同事 = { id: "gate-long-owner", 名: "Konstantin-Alexandrovich Vasilyev-Rimsky-Korsakov" };
