/**
 * 字段覆盖审计：表里有的字段，要么能改，要么说清为什么不能改。
 *
 * 起因是「渠道负责人」——schema 里有、列表和详情页都显示、却没有任何地方能改，
 * AI 被问到时只好编一个不存在的入口。这种"有字段却改不了"的缺口不该靠人肉发现。
 *
 * 这条测试把每个模型的标量字段分成四类，**四类之外的字段一律让测试挂掉**：
 *   可写      —— 有 server action 能写它（人和 AI 都走这条路）
 *   派生/只读 —— 由系统算出来或系统打上的，写它就是破坏一致性，逐个写明理由
 *   系统事实  —— 记「事情是怎么发生的」（来源、导入批次、分配方式这类）：该由系统在那一刻写，不靠人填。
 *                **必须列出写它的系统路径**（仓库里的文件），审计逐个核那个文件还在写它；一条写入方都没有的，单独报出来
 *   已知缺口  —— 明知有洞、还没补：也要写明，让它一直显眼，而不是悄悄躺着
 * 新加字段时必须归到某一类，否则这里就红。
 *
 * 系统事实这一类是 11-17 复盘第 6 类加的：「客户分配」能手改，审计只算它「可写」就放过了；
 * 可它记的是「客户怎么到销售手上」，该由系统在分配时写，却没有任何系统路径写它，导入也没这一列，
 * 正式库 8 万多位客户里只有 1 位有值。所以系统事实的字段即使也能手改（同时在 可写 里），照样要列系统写入方。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** 从 schema.prisma 读出每个模型的标量字段（去掉 id / 时间戳 / 关系对象） */
function 标量字段(): Record<string, string[]> {
  const s = fs.readFileSync(path.resolve(__dirname, "../prisma/schema.prisma"), "utf8");
  const models = [...s.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)];
  const names = new Set(models.map((m) => m[1]));
  const out: Record<string, string[]> = {};
  for (const [, name, body] of models) {
    out[name] = body
      .split("\n").map((l) => l.trim())
      .filter((l) => l && !l.startsWith("//") && !l.startsWith("@@"))
      .map((l) => l.split(/\s+/)).filter((p) => p.length >= 2)
      .filter((p) => !/^(id|createdAt|updatedAt)$/.test(p[0]))
      .filter((p) => !names.has(p[1].replace(/[\[\]?]/g, "")))
      .map((p) => p[0]);
  }
  return out;
}

/** 可写：对应的 server action 接收这个字段 */
const 可写: Record<string, string[]> = {
  // 企业版组织架构（2026-10-24）：设置 → 组织架构（settings/org-actions.ts）
  EntDept: ["name", "parentId"],
  EntMember: ["deptId", "bizRole", "line", "managerId", "dottedManagerId", "noSettings"],
  // 企业版线索分配（2026-10-24）：leads/assign-actions.ts 的 分配线索 / 设配额
  EntLeadAssign: ["leadId", "toUserId", "line", "kind"],
  EntLeadQuota: ["userId", "quota"],
  // 企业版卡点（11-01 改版）：projects/blocker-actions.ts 的 发布（类型、影响、标题、描述、资源申请）/ 我已完成（最后一位写解决方案、解决结果）
  EntBlocker: ["type", "impact", "title", "description", "resourceRequest", "solution", "result"],
  // 我已完成时写的备注（blocker-actions.ts 完成卡点Action）
  EntBlockerClaim: ["note"],
  // 阻碍原因字典：设置 → 项目模式 → 阻碍原因（blocker-actions.ts 新增 / 改名 / 改状态 / 合并）
  EntBlockerReason: ["name", "status"],
  // 记项目沟通填的下一步时间（projects/actions.ts 记项目沟通Action）
  EntFollowUpMeta: ["nextAt"],
  // 企业版教练主题（11-17）：发起时填主题、内容，回复时填内容（customers/[id]/coach-topic-actions.ts）；发出后都不能改
  EntCoachTopic: ["title", "body"],
  EntCoachReply: ["body"],
  // 企业版沟通标记（2026-10-26）：记项目沟通 / 建档向导一起写，沟通弹窗里选阶段、选客户是否明确回复
  EntFollowUpMark: ["phase", "replied"],
  // 企业版提成（2026-10-26）：projects/commission-actions.ts 的 存项目底价 / 存提成分配
  EntCommission: ["basePrice"],
  EntCommissionSplit: ["userId", "percent"],
  // 企业版线索有效性验证（2026-10-29，P12）：projects/actions.ts 的 线索初判 / 市场复核 / 销售终验 / 总管理终判 收的说明和无效原因
  EntLeadVerify: ["invalidReason", "verifyNote", "reviewNote", "disputeNote", "finalNote"],
  // 企业版项目回款（2026-10-31，迁移 100）：projects/payment-actions.ts 的 记回款（只加、删，不改）
  EntProjectPayment: ["paidAt", "currency", "amount"],
  Customer: ["name", "phone", "school", "grade", "major", "channelId", "referrerCustomerId", "salesOwnerId", "channelOwnerId", "followStatus", "decisionStatus", "custStatus", "expectedSignAt", "remark",
    // 企业版客户改版（2026-10-29，迁移 072）：客户表单 saveCustomer 的 企业资料
    "shortName", "addrCountry", "addrProvince", "addrCity", "addrDistrict", "assignWay",
    // 企业版客户类型（2026-10-29，迁移 092）：客户表单 / 行内改 / 导入
    "customerType",
    // 企业版客户属性（2026-10-31，迁移 104，F-客户-04）：客户表单 / 行内改
    "customerAttr",
    // 企业版客户地址第五格「客户地址」（2026-10-29，迁移 091，P14 第 7 条）：客户表单 saveCustomer 的 企业资料
    "addrDetail",
    // 企业版客户业务线（2026-11-01，迁移 106，清单 A1）：客户表单 saveCustomer 的 企业资料（内贸 / 外贸 / 暂不分配）
    "bizLine",
    // 企业版渠道触点（迁移 116，P-渠道-08）：客户表单 / 建档向导 / 首页 AI 建档的 saveCustomer（公司资源 / 客户介绍）
    "touchpoint"],
  // 渠道改版（2026-10-29）：渠道表单收 渠道属性 / 渠道名称 / 结束日期；全称还是 name
  Channel: ["name", "phone", "remark", "channelOwnerId", "active", "attr", "platform", "endDate", "strategies"],
  // 企业版主渠道（2026-11-08 渠道两层）：渠道页「主渠道」里建、改名、拨开关（channels/actions.ts 的 saveMainChannel / toggleMainChannel）
  // 11-10（迁移 118）：主渠道自己的负责人、渠道属性（获客方式），同一个 saveMainChannel 收
  EntChannelMain: ["name", "allowSub", "selfDev", "category", "active", "ownerId", "attr"],
  // 企业版渠道投入（2026-10-29）：渠道详情抽屉里录一笔（channels/actions.ts 的 addChannelInvest）
  EntChannelInvest: ["amount", "currency", "date", "remark"],
  Lead: ["name", "contact", "phone", "email", "industry", "source", "status", "remark", "ownerId"],
  Contract: ["customerId", "amount", "signedAt", "remark"],
  // 企业版联系人改版（2026-10-29，迁移 073）：联系人表单 saveContact 收性别 / 生日 / 爱好 / 地址
  Contact: ["name", "position", "phone", "email", "wechat", "isPrimary", "remark", "customerId", "gender", "birthday", "hobby", "address"],
  // 企业版联系人的联系方式（2026-10-29）：联系人表单 saveContact 的 号码们（号码类型 + 号码），整份换
  ContactMethod: ["kind", "value"],
  // 企业版关联客户（2026-10-29，迁移 075）：客户页「关联客户」卡（customers/[id]/link-actions.ts 的 关联客户 / 改关联说明）
  EntCustomerLink: ["otherId", "note"],
  // 企业版联系人挂多位客户（2026-10-29，迁移 090）：联系人卡「挂到别的客户」（customers/[id]/contact-link-actions.ts 的 挂到客户 / 改挂靠说明）
  ContactCustomer: ["customerId", "note"],
  // 企业版项目关联客户 / 联系人（2026-10-29 P17，迁移 094 / 095）：项目页「关联客户」「关联联系人」卡（projects/relate-actions.ts）
  ProjectCustomer: ["customerId", "roles"],
  ProjectContact: ["contactId", "roles", "stance"],
  // 未归属联系人：联系人页上点开改资料（saveUnassignedContact）
  UnassignedContact: ["name", "position", "phone", "email", "wechat", "remark"],
  // 商机（2026-11-11）：商机框 saveOpportunity 删了（企业版只用项目，走不到）；表和老数据留着，下一步删表时整组从这里拿掉
  Opportunity: ["name", "amount", "stage", "status", "probability", "expectedDealAt", "remark", "customerId", "ownerId"],
  // 币种（2026-10-03）：saveContract 收 currency，签约的精确金额跟着 amount 一起写（商机那边同上，入口已删、表还在）
  OpportunityMoney: ["currency"],
  ContractMoney: ["currency", "amountExact"],
  // 报价明细（2026-10-03）：一行五个字段。写入口连同开关 2026-11-11 删了（报价挂在商机上，企业版没有商机）；表留着等删表那一步
  QuoteLine: ["product", "spec", "qty", "unit", "unitPrice"],
  // 客户的外贸档案（2026-10-05）：客户表单 saveCustomer 的 extra、记录页 patchCustomer 单格改、导入、线索转客户
  // 2026-10-16 加客户等级、官网：同样走 saveCustomer 的 extra、patchCustomer、导入
  CustomerExtra: ["country", "whatsapp", "wechat", "email", "source", "level", "website", "alibabaId"],
  // 外贸订单 / 供应商整套 7 张表 2026-10-29 删了（迁移 066），这里和 派生 里都不再列
  // 团队版项目模式 1a（2026-10-23）：建档向导、项目详情（编辑项目 / 改节点 / 勾交付 / 项目组）、设置里的「项目模式」一栏
  Project: ["name", "contactId", "ownerId", "phase", "node", "result", "exceptionCategoryId", "exceptionReason", "balanceSettled", "acceptancePassed", "amount", "currency", "remark", "expectedDealAt", "channelId",
    // 指定回复时间（企业版 11-17，迁移 148）：新建时填、详情「指定回复」就地改（lib/project/db.ts 改项目）
    "replyStartAt", "replyEndAt",
    // 企业版项目画像（P11，迁移 087）：详情页「项目画像」卡改一项存一项（projects/actions.ts 改项目画像Action → lib/project/profile.ts）
    "budgetLevel", "priceSense", "decisionChain", "demandStatus", "productNeeds",
    // 企业版项目画像加 7 项单选（迁移 102）：同一张「项目画像」卡，同一条路径
    "purchaseCycle", "productFit", "valueFit", "decisionReach", "competitor", "deployFit", "siteStatus",
    // 企业版项目级别、所在地四格 + 详细地址（P11 定稿 -2 版，迁移 093；location 是 087 加的，现在当详细地址）：编辑项目框（编辑项目 → lib/project/db.ts 改项目）
    "level", "addrCountry", "addrProvince", "addrCity", "addrDistrict", "location",
    // 企业版项目标签（迁移 153，F-项目-14）：和级别各自一列，编辑项目框、详情就地改、完成节点框（编辑项目 → lib/project/db.ts 改项目）
    "projTag",
    // 企业版成交需求、合同金额 + 币种、定金金额 + 币种（迁移 097）：编辑项目框（编辑项目 → lib/project/db.ts 改项目），导入（enterprise-import/project-target.ts 建项目 / 改项目）
    "dealDemand", "contractAmount", "contractCurrency", "depositAmount", "depositCurrency",
    // 企业版痛点标注、合同状态（迁移 101）：编辑项目框（编辑项目 → lib/project/db.ts 改项目）；合同状态新建项目时写「起草中」
    "painPoints", "contractStatus",
    // 企业版备货状态、物流状态、物流单号（迁移 154，客户 11-19）：交付卡就地改、编辑项目框、完成节点框（编辑项目 → lib/project/db.ts 改项目）
    "stockStatus", "logisticsStatus", "trackingNo"],
  ProjectMember: ["roleId"],
  ProjectRole: ["name", "active"],
  ProjectExceptionCategory: ["name", "active"],
  // 企业版选项字典（2026-10-26）：设置 → 项目模式 → 企业选项（settings/ent-dict-actions.ts）
  EntDictItem: ["name", "active"],
  FollowUp: ["type", "title", "content", "status", "duration", "occurredAt", "dueAt", "participants", "customerId", "contactId", "opportunityId", "method", "initiator"],
  Task: ["title", "dueAt", "done", "customerId"],
  FollowPlan: ["subject", "plannedAt", "method", "done", "customerId"],
  // 对话历史：人能改的只有标题（重命名）。其余是系统打的，见下面「派生」
  AiConversation: ["title"],
};

/** 派生 / 只读：写明为什么不能直接改 */
const 派生: Record<string, Record<string, string>> = {
  EntDept: { sort: "新建时排在同一级最后，系统算" },
  EntMember: { userId: "哪个账号，一人一行；设成员时按账号定，不改" },
  EntLeadAssign: {
    fromUserId: "分之前线索在谁名下，分配时从线索上抄过来",
    byUserId: "点分配的那个人，当前登录账号",
    counted: "算不算进当月配额，按线索种类和设置算出来",
    month: "分配那一刻的年月，按业务钟算（企业版北京时间），每月清零靠它",
    projectId: "分的是哪个项目（企业版新线索=项目的线索阶段），从被分的那条项目上来",
  },
  EntLeadQuota: { setById: "最后改配额的人，当前登录账号" },
  Channel: {
    createdById: "新建时打上当前登录账号；批量导入时按表里「创建人」对上的员工，对不上留空",
    mainId: "按选的主渠道（platform）找到的那一行，表单里不直接交 id；客户表单就地建的按名字当场挂（channel-main.ts 建渠道挂主）",
  },
  EntChannelMain: { sort: "新建时排在最后，系统打的；清单顺序由落库脚本定，界面不改" },
  EntChannelInvest: { channelId: "哪个渠道，在那个渠道的详情里录，不改", userId: "录的那个人，当前登录账号" },
  EntFollowUpMark: { followUpId: "主键：标的是哪条沟通（一条沟通只挂一个项目，一行一条）", projectId: "哪个项目，记沟通时跟 FollowUpProject 一起写" },
  EntCommission: {
    projectId: "哪个项目，一个项目一行；存项目底价时按项目定，不改",
    updatedById: "最后改项目底价的人，当前登录账号",
    fixedAt: "赢单（进订单阶段）那一刻打上，企业版进了订单不能退，之后不变",
    fixedDeal: "赢单时的成交金额，从项目金额抄过来",
    fixedBase: "赢单时的项目底价",
    fixedRateBase: "赢单时设置里的底价比例",
    fixedRatePremium: "赢单时设置里的溢价比例",
    fixedTotal: "赢单时按上面几项算出来的实际提成",
  },
  EntCommissionSplit: {
    projectId: "哪个项目；分配按项目整份存",
    setById: "最后改这一份的人，当前登录账号",
  },
  EntLeadVerify: {
    projectId: "哪个项目，一个项目一行；第一次初判时按项目建，不改",
    verdict: "线索判定，按四步走到哪一步系统算（lib/project/lead-verify.ts），人点的是有效 / 无效 / 还需培育，不直接填",
    pending: "等哪一步，按判的结果、「市场复核」规则和组织里有没有市场管理系统算",
    verifiedById: "销售初判的人，当前登录账号",
    verifiedAt: "销售初判那一刻",
    reviewResult: "市场复核点的有效 / 无效，按按钮记，不是自由填",
    reviewedById: "市场复核的人，当前登录账号",
    reviewedAt: "市场复核那一刻",
    salesAck: "销售终验点的接受复核 / 提交异议，按按钮记",
    ackedAt: "销售终验那一刻",
    finalResult: "最终结果，市场判无效 / 总管理终判 / 直接判有效推进时系统写",
    finalById: "定最终结果的人，当前登录账号",
    finalAt: "定最终结果那一刻",
  },
  EntLeadVerifyLog: {
    projectId: "哪个项目，每一步系统记一行",
    step: "哪一步，系统按调用的是哪个 action 记",
    verdict: "这一步判的，按按钮记",
    reason: "无效原因，从判无效那一步抄过来",
    note: "这一步的说明，从那一步收的说明抄过来",
    userId: "点的那个人，当前登录账号",
    at: "点的那一刻",
  },
  EntLeadQuotaBonus: {
    userId: "加给谁：最终判无效那条线索的负责人",
    month: "加在哪个业务月（北京时间），每月清零靠它",
    count: "这个月因线索最终无效加了几条配额，系统累加",
  },
  Opportunity: { activityAt: "最近业务推进时间；转交负责人保留，业务字段/报价变化时刷新，老数据为空沿用原修改时间" },
  Customer: {
    expectedSignOn: "预计签约原日历日，随保存/导入/同步保留；旧数据未知为空",
    attributionChannelId: "推荐链往上两代算出来的，改推荐人它就跟着变",
    attributionCustomerId: "同上",
    lastFollowAt: "最近一条跟进的时间，记跟进时自动维护",
    deletedAt: "企业版删除时打上（进回收站），恢复时清掉；30 天后连行真删，不给改（lib/enterprise/soft-delete.ts）",
    poolInvalidAt: "企业版统一公海：pool/actions.ts 的 标无效客户 / 恢复有效客户打上和清掉，不随客户资料编辑",
    poolReturns: "企业版统一公海：主动退回公海时系统累加（放进公海 / 放回项目公海），撤销放进时减回，不许手工改",
    archiveTier: "企业版归档档位（迁移 114，M-导入-23）：只由导入写（enterprise-import 的「归档档位」列），详情页只读显示，空 = 不是归档导入来的",
    customerNo: "客户编号（迁移 146）：建客户时从计数表取号（lib/customer-no.ts），存量由回填脚本补；一经发出不改、不复用，导入也不收这一列",
  },
  // 客户编号计数（迁移 147）：只有一行，取号时 +1，回填脚本补完推到最大号；不给改，改了就会发重号
  CustomerNoSeq: { n: "客户编号计数：取号时系统 +1（lib/customer-no.ts 取客户编号），回填脚本推到最大号；不给改" },
  Lead: {
    convertedAt: "convertLead 转化时打上",
    customerId: "转化后指向新建的客户，由 convertLead 设置",
  },
  Task: { dueOn: "仅日期的原日历日，保存时派生并随同步保留", dueHasTime: "明确钟点选择；旧数据未知为空", doneAt: "toggleTask 完成时打上", ownerId: "创建者，不做转派" },
  OpportunityClose: {
    opportunityId: "哪个商机，变成赢单或丢单时一起写",
    closedAt: "赢单 / 丢单的那一刻，系统打上；回到进行中就删掉这一行",
  },
  OpportunityMoney: { opportunityId: "哪个商机，原来 saveOpportunity 新建 / 改币种时一起写（入口 2026-11-11 删了）" },
  ContractMoney: { contractId: "哪一笔签约，saveContract 保存时一起写" },
  // 2026-10-04 L-007：整行是登记签约勾了赢单时系统记下的，删签约时据此退回，没有单改某一格的入口
  ContractWin: {
    opportunityId: "哪个商机，saveContract 勾了赢单时一起记；商机之后离开赢单就删掉这一行",
    contractId: "哪一笔签约赢下的，删这笔签约时据此退回商机",
    prevStage: "赢单之前的阶段，系统记下，退回时用",
    prevProbability: "赢单之前的概率，同上",
  },
  Quote: {
    opportunityId: "哪个商机，saveOpportunity 带报价时一起写",
    quotedAt: "这一版报价记下的那一刻，系统打上；改价另记一版，不改旧的",
    currency: "报价那一刻商机的币种，跟着商机走",
  },
  QuoteLine: { quoteId: "属于哪一版报价", sort: "这一版里的第几行，按界面上的顺序打上" },
  CustomerExtra: { customerId: "哪位客户的档案，一位一行" },
  // 公海（第 6 块）：整行是「放进 / 领取」两个动作的结果，没有单改某一格的入口
  CustomerPool: {
    customerId: "哪位客户，有这一行 = 在公海；放进公海时建、领取时删",
    userId: "谁放进去的，放进公海时打上；自动掉进去的为空",
    reason: "手动 / N 天没跟进自动放进，系统打上",
    at: "放进去的那一刻，系统打上",
    phoneIncomplete: "企业版三态到期自动进公海时系统查号码，空的 / 不对的打上「号码不全」（迁移 130），公海按它筛",
  },
  CustomerClaim: {
    customerId: "哪位客户，领取时建 / 覆盖",
    userId: "谁领的，领取时打上",
    at: "领走的那一刻，自动掉公海从它算起",
  },
  // 合并重复（2026-10-20）：两张都是一个动作的结果，没有单改某一格的入口
  CustomerMerge: {
    fromId: "被合并掉的那位，合并时打上（= id）",
    intoId: "留下的那位，合并时打上",
    fromName: "被合并那位原来的名字，合并时打上，给人看",
    fromOwnerName: "被合并那位原来的负责人，合并时打上，给人看",
    userId: "谁合并的，合并时打上",
    at: "合并的那一刻，系统打上",
  },
  CustomerNotDupe: {
    customerId: "两位里编号小的那位，标「不是同一个人」时打上",
    otherId: "另一位，同上",
    userId: "谁标的，标的时候打上",
    at: "标的那一刻，系统打上",
  },
  ContractOwner: {
    contractId: "哪一笔签约，saveContract 新登记时一起建",
    salesOwnerId: "签约那一刻客户的销售负责人，新登记时打上；业绩按它算，之后不跟着换人",
    channelOwnerId: "签约那一刻客户的渠道负责人，同上",
  },
  UnassignedContact: {
    wasPrimary: "移出时保存原关键身份；空值表示旧数据未知，挂回原客户可预选恢复，换客户不默认接管关键身份",
    ownerId: "移出或保留联系人时记录操作者，权限隔离使用；不允许表单转派",
    fromCustomerId: "detachContact 移出时记下原来是谁的，挂回原处时接回跟进记录用",
    fromCustomerName: "同上，给人看（那位之后可能被删）",
    followUpIds: "detachContact 移出时记下原来指着他的跟进记录",
    detachedAt: "移出的时刻，系统打上",
  },
  FollowPlan: { plannedOn: "仅日期的原日历日，保存时派生并随同步保留", plannedHasTime: "明确钟点选择；旧数据未知为空", ownerId: "创建者，不做转派", doneAt: "实际完成时系统记录；撤销完成清空，旧记录未知则为空，不允许手工伪造" },
  Contact: { deletedAt: "企业版删除时打上（进回收站），恢复时清掉；30 天后连行真删，不给改（lib/enterprise/soft-delete.ts）", createdById: "只在受限客户详情新增时打上建的人（迁移 135，project-only-contact-actions.ts）；客户详情 saveContact 建的留空 = 不是从受限详情建的。受限详情认「自己建的才能改」，不给改" },
  FollowUp: { dueOn: "仅日期原日历日，随派生待办/撤销保存", dueHasTime: "明确钟点选择；旧数据未知为空", ownerId: "记录人，不做转派", deletedAt: "企业版删除时打上（进回收站），恢复时清掉；30 天后连行真删，不给改（lib/enterprise/soft-delete.ts）" },
  AiConversation: {
    ownerId: "问的人，落库时打上。对话只有自己看得见，转派没有意义",
    scope: "在哪一页问的，新建那条对话时打上。一条对话在哪一页开的，之后不会变——面板按它翻这一页的历史",
    lastAskedAt: "最后一次提问的时间，落一轮时自动维护——排序按它",
    projectId: "项目那一层这一版只有表没有界面（列必须现在就建，migrations 只能加表不能加列）",
    pinnedAt: "置顶。同上，列先留着，界面下一版再长出来",
    archivedAt: "归档。同上；眼下删对话是真删，不是归档",
  },
  AiMessage: {
    conversationId: "属于哪条对话，落库时定，之后不换",
    role: "user 还是 assistant，由落库那一刻决定",
    text: "问了什么、答了什么。**不给改**：能改的历史就不是历史了",
    model: "这一答用的哪个模型，系统记的",
    ms: "这一答用了多久，系统记的",
    steps: "工具调用轨迹，系统记的",
    refs: "这一答读到的记录，系统记的",
  },
  AiProject: {
    name: "这一版只有表、没有界面，见 AiConversation.projectId",
    brief: "同上",
    ownerId: "同上",
    archivedAt: "同上",
  },
  /*
    导入批次这两张表**整体只读**。它们是一次导入发生过什么的账，
    而账能改的话，撤销就不再可信——撤销照着这里的记录走，
    改一条 before 就能让撤销把别的值写进人家的档案。
    人在界面上能做的只有一件：撤销一整批（revertedAt）。
  */
  ImportBatch: {
    at: "导入发生的时刻，落库时打上。撤销要拿它和客户的 updatedAt 比，改了就比错了",
    userId: "谁导的，落库时打上",
    userName: "同上，冗余存一份，成员被删也还认得出是谁",
    fileName: "导的哪个文件，落库时打上。只存文件名，不存内容",
    sheetName: "第几张工作表。眼下只读第一张，这一列先留着（migrations 只能加表不能加列）",
    created: "这一批建了几条，执行完写一次",
    updated: "补空了几条，同上",
    skipped: "跳过几条，同上",
    failed: "没进来几条，同上",
    revertedAt: "撤销时打上。**这是这两张表上唯一一处人能触发的改动**，而且只能从没值变成有值",
  },
  ImportRow: {
    batchId: "属于哪一批，落库时定",
    customerId: "这一行落到了哪位客户身上，落库时定",
    kind: "create 还是 update，落库时定——撤销按它决定是删还是还原",
    before: "补空之前那几格是什么。**不给改**：撤销照着它还原，能改就等于能让撤销写任意值",
    writtenAt: "写完那一刻客户的 updatedAt，落库时定——撤销拿它判断之后有没有人改过",
  },
  /*
    企业版导入（2026-10-24，lib/enterprise-import/）：飞书 / 钉钉 / Excel 导进来的批次、对照、冲突、回收站、切换快照。
    跟上面的导入账一样是「账」：系统按导入 / 同步 / 撤回 / 定冲突的流程写，人在设置页「企业版导入」里能做的
    只有那几个动作（改映射重新试跑、正式导入、整批撤回 / 恢复、定冲突、开关同步、切换），没有直接改某一格的入口。
    能直接改的话撤回和三方比对就不再可信。
  */
  /*
    企业版交接中（2026-10-26）：一行一笔离职 / 转让交接，是「账」。发起时整行写好，之后只有确认 / 撤回 / 拒收
    三个动作把状态从「待确认」推走（带状态条件，只成一次）。没有直接改某一格的入口：改了接手人或客户名单，
    确认时转走的就不是发起人当时定的那份。
  */
  EntHandover: {
    kind: "离职还是转让，发起时定",
    fromUserId: "从谁那里交出去，发起时定",
    toUserId: "交给谁，发起时定；申请移交的发起人、离职交接的发起人或总管理可以改接手人（改接手人），别的要换人就撤回再发起一笔",
    byUserId: "谁发起的，发起时打上",
    way: "离职交接管哪些：老行 = 转交 / 公海，11-13 起 = 客户 / 项目 / 全部，发起时定，确认时照它转",
    customerIds: "转让时这一笔包含哪些客户，发起时定；确认时只转此刻还归原负责人的",
    projectIds: "离职交接单条交项目时这一笔是哪个项目，发起时定；确认时只转此刻还归离职那位、没进公海、没结局的",
    counts: "发起时清点的个数，给接手人看，不改",
    status: "待确认 → 已确认 / 已撤回 / 已拒收，只有确认、撤回、拒收三个动作能改",
    doneAt: "了结那一刻，系统打上",
    doneById: "谁了结的，系统打上",
    reason: "转让原因，发起时从字典「转让原因」里选（可不选），存当时的叫法，不改",
  },
  EntImportBatch: {
    source: "从哪来（excel / feishu / dingtalk），建批时定",
    kind: "首次 / 同步 / 定冲突，建批时定",
    status: "流程状态：试跑、写入、撤回、恢复各一步一步推进，只有这几个动作能改它",
    userId: "谁做的，建批时打上",
    report: "试跑报告，试跑和「改映射重新试跑」时整份重算",
    raw: "上传的表读出来的样子，建批时存；重新试跑从这里取，不给改",
    mapping: "人在报告上认过的映射，「改映射重新试跑」时整份重算，不单格改",
    plan: "清洗后的待写记录，跟着报告一起算，正式导入照它写——改了就和人看过的报告对不上",
    cursor: "正式导入 / 撤回写到第几条，续写用，系统推进",
    total: "这一批几条，试跑时算",
    created: "建了几条，写入时累加",
    updated: "更新了几条，同上",
    skipped: "没变跳过几条，同上",
    conflicts: "记了几笔冲突，同上",
    failed: "没写进去几条，同上",
    note: "写不进去的明细，写入时记",
    finishedAt: "写完那一刻",
    revertedAt: "整批撤回时打上，恢复时清掉",
    revertNote: "最近一次撤回 / 恢复的账（删掉、还原、留下几条），系统写",
  },
  EntImportRow: {
    batchId: "属于哪一批，写入时定",
    entity: "落到哪类记录，写入时定",
    externalId: "原系统 ID，写入时定",
    targetId: "落到我们这边哪条，写入时定",
    kind: "新建还是更新，撤回按它决定删还是还原",
    before: "更新之前那几格。**不给改**：撤回照着它还原，能改就等于能让撤回写任意值",
    written: "写进去的值，撤回时比对有没有人动过",
    refBefore: "写之前的对照行，撤回时退回去",
    undo: "整批撤回时这一行怎么处理的，撤回 / 恢复时系统写",
  },
  EntExternalRef: {
    source: "从哪来，第一次写入时定",
    entity: "哪类记录，同上",
    externalId: "原系统 ID，同上——同步按 来源 + 原系统 ID 认人，改了就认错",
    targetId: "对到我们这边哪条，写入时定",
    fingerprint: "原系统记录的指纹，每次写入时算，没变就跳过",
    written: "上次我们写进去的值，三方比对用，写入时更新",
    raw: "原系统最后一次给的原始记录，留档和切换快照用",
    batchId: "最近写它的是哪一批",
  },
  EntConflict: {
    source: "同步时记下，照原系统来的那条",
    entity: "同上",
    externalId: "同上",
    targetId: "同上",
    batchId: "哪一批同步记下的",
    fields: "三方的值（原系统 / 我们 / 上次），记下时定",
    incoming: "原系统这次给的整条，采用原系统时照它写",
    localDeleted: "记下时我们这边那条已经删了，系统判断",
    status: "人在冲突页点「采用原系统 / 保留我们」改；撤回、过时由系统改",
    resolvedById: "谁定的，定的时候打上",
    resolvedAt: "什么时候定的，同上",
    resolveBatchId: "定它的那一批，整批撤回时据此退回待定",
  },
  EntTrash: {
    batchId: "哪一批撤回时删的",
    entity: "哪类记录",
    targetId: "删掉的是哪条",
    data: "删之前的整条记录，恢复时照它建回；不给改",
    ref: "撤回时的对照行，恢复时照它建回",
    rowId: "对应哪一行导入账",
    restoredAt: "恢复时打上",
  },
  EntSnapshot: {
    source: "切换的是哪个来源，切换时定",
    userId: "谁点的切换",
    count: "快照里几条对照",
    data: "切换那一刻的全部对照和原始记录，留档，不给改",
  },
  // 企业版联系方式子表（2026-10-26）：建档时照客户 / 联系人上的号系统写；10-29 起联系人表单能改联系人的号（见 可写）
  ContactMethod: {
    customerId: "哪位客户，建档时系统写",
    contactId: "哪位联系人的号；客户本身的号为空，建档时系统写",
    numberKey: "查重用的规整值，从号算出来",
    formatStatus: "格式校验结果，系统判",
    region: "号码归属地，从离线号段库算出来",
  },
  /*
    商机的附件（2026-10-22 D-24，lib/attachments.ts）：文件存进去以后不再改，要换就是删了再传。
    传的时候 POST /api/attachments 落一整行，之后只能 DELETE，没有改的入口
  */
  Attachment: {
    opportunityId: "挂在哪个商机上，传的时候定",
    orderId: "老库里挂在订单上的那列；订单表 2026-10-29 删了（迁移 066），新传的不再写，列留着不删",
    leadId: "挂在哪条线索上（企业版名片建档 / 线索编辑框传的时候定），线索删了这列也不清",
    contactId: "挂在哪位联系人上（企业版传的时候定；线索转客户、并进老客户时补上）",
    projectId: "挂在哪个项目上（企业版项目详情页「附件」传的时候定，P11 迁移 086）",
    followUpId: "挂在哪条沟通记录上（企业版沟通弹窗传截图、录音时定，迁移 103），沟通删了这列也不清",
    name: "原文件名，传的时候定（去掉路径和 Windows 不认的字符）",
    mime: "文件类型，传的时候定。决定能不能在页面里显示，不给改",
    size: "文件字节数，存文件时量出来",
    width: "图片压完以后的宽，存文件时定",
    height: "图片压完以后的高，同上",
    sha256: "文件内容的指纹，存文件时算。团队版拿它去重和校验，改了就对不上",
    userId: "谁传的，落库时打上",
    tag: "联系人附件分类（名片 / 相册），传的时候按点的是哪一格定（企业版，迁移 074）",
  },
  // 企业版关联客户（2026-10-29）
  EntCustomerLink: {
    customerId: "一对客户里 id 小的那位，关联时按两边 id 排出来，不改",
    userId: "关联的那个人，当前登录账号",
  },
  // 企业版联系人挂多位客户（2026-10-29）
  ContactCustomer: {
    contactId: "挂的是哪位联系人，挂的时候定，不改（换人等于另挂一行）",
  },
  // 企业版项目关联客户 / 联系人（2026-10-29 P17）
  ProjectCustomer: { projectId: "关联到哪个项目，在项目页上加的时候定，不改" },
  ProjectContact: { projectId: "关联到哪个项目，在项目页上加的时候定，不改" },
  // 团队版项目模式 1a（2026-10-23）：系统打上的
  Project: {
    customerId: "建档向导里和客户一起建，不改（改了等于另一单生意）",
    creatorId: "实际建档的人，向导保存那一刻打上，不改",
    scheduledAssignAt: "新建时选「指定时间」分配那一刻定下（迁移 149）；到点前在项目详情「定时分配」那行改 / 取消（leads/schedule-actions.ts），到点执行、清了待分配、进回收站由后台清空（lib/enterprise/scheduled-assign.ts）",
    scheduledAssignTo: "同 scheduledAssignAt：指定分配的定时到点分给谁，新建时就是选的负责人，到点前能改（leads/schedule-actions.ts 改定时分配）",
    assignDir: "市场成员建档选自动分配时手动改的分配方向（迁移 152，审核 11-18 P0-1）：建档向导 / 客户页新增项目建的那一刻记下，不改；之后每次自动分配先认它（leads/assign-actions.ts 自动分给）",
    balanceSettledById: "勾尾款结清的那个人，系统打上",
    balanceSettledAt: "勾尾款结清的那一刻，系统打上",
    acceptancePassedById: "勾验收通过的那个人，系统打上",
    acceptancePassedAt: "勾验收通过的那一刻，系统打上",
    closedAt: "有结局的那一刻，系统打上；回到进行中清掉",
    pooledAt: "放回公海的那一刻，系统打上；有人领取或老板重新指派时清掉",
    nextStepAt: "记沟通时填的下一步时间，跟着最近一条沟通写；企业版超时回收用",
    nextStepText: "记沟通时填的下一步做什么，跟 nextStepAt 一起写、一起清",
    deletedAt: "企业版删除时打上（进回收站），恢复时清掉；30 天后连行真删，不给改（lib/enterprise/soft-delete.ts）",
    bizLine: "新建线索 / 项目时必选的业务线（内贸 / 外贸 / 暂不分配），建的那一刻记下，自动分配按它分线，之后不改（11-01 清单 A1，迁移 106，lib/enterprise/assign-line.ts）",
    awaitAssignAt: "建好没分出去（暂不分配、自动分配没人可分 / 业务线是「暂不分配」）那一刻系统打上；有人分出去时清掉（lib/enterprise/await-assign.ts）",
  },
  ProjectMember: { projectId: "哪个项目的组员，加人时定", userId: "哪位成员，加人时定；换人 = 删了再加", invitedById: "谁拉进来的，加人时打上" },
  ProjectRole: { sort: "加角色时排到最后，系统写；不做拖动排序" },
  ProjectExceptionCategory: { sort: "加类别时排到最后，系统写；不做拖动排序" },
  EntDictItem: { kind: "加选项时就定了是哪一类，不改", sort: "加选项时排到最后，系统写；不做拖动排序" },
  ProjectNodeLog: {
    projectId: "哪个项目，改节点时系统写", userId: "谁改的，系统写", at: "改的那一刻，系统写",
    fromPhase: "改之前的阶段，系统写", fromNode: "改之前的节点，系统写", fromResult: "改之前的结局，系统写",
    toPhase: "改之后的阶段，系统写", toNode: "改之后的节点，系统写", toResult: "改之后的结局，系统写",
    reason: "进异常状态时填的备注（可空），跟着那一次改节点写；只增不改",
    categoryId: "进异常状态时选的类别，跟着那一次改节点写；只增不改",
    kind: "这一行是改节点、转让负责人、放回公海还是领取，系统写",
    fromOwnerId: "转让 / 放回公海 / 领取前的负责人，那一刻系统写；改节点的行留空",
    toOwnerId: "转让 / 领取后的负责人，那一刻系统写；放回公海和改节点的行留空",
  },
  FollowUpProject: {
    followUpId: "哪条沟通记录，记的时候定", projectId: "挂在哪个项目，记的时候定", node: "记这条时项目在哪个节点，系统打上",
    withProjectCreate: "是不是建这个项目同一次操作带出的首条沟通，建项目的那几条路挂上时系统写、之后不改（迁移 166，三态额度重置用）",
  },
  CustomerCreator: { customerId: "哪位客户，一位一行", userId: "实际建档的人，向导保存那一刻打上，不改", at: "建档那一刻，系统打上" },
  EntBlocker: {
    code: "BLK + 日期 + 当天流水，发布时系统生成，不改", projectId: "从哪个项目的沟通发布，发布时定",
    followUpId: "从哪条沟通发布，发布时定", customerId: "发布那一刻项目的客户，系统照抄", contactId: "发布那一刻项目的联系人，系统照抄",
    phase: "发布那一刻项目的阶段，系统照抄", dueAt: "发布时间 + 解决时限，系统算",
    status: "待接受 / 处理中 / 已解决，按有没有人认领、认领人是不是都完成了系统写（11-01）",
    creatorId: "发布的人，当前登录账号", resolvedAt: "最后一位认领人点「我已完成」的那一刻，系统写",
    obstacle: "老的阻碍主体；11-01 起系统写第一个阻碍原因名，给老报表用",
    dueDays: "11-01 起不设解决时限，系统按类型默认值照写，界面不显示",
    assigneeId: "11-01 起不指认、不转让，改版时搬进认领表后清空，不再写",
    progress: "11-01 起不再改进度（各认领人的备注记在认领表），老数据留着只读",
  },
  EntBlockerClaim: {
    blockerId: "认领的哪个卡点，系统写", userId: "认领的人，当前登录账号；离职交接 / 项目换人时系统挪给接手的人",
    done: "点「我已完成」时系统写，不能撤回", doneAt: "点「我已完成」的那一刻，系统写",
  },
  EntBlockerReason: {
    sort: "新加的排在最后，系统写", mergedIntoId: "合并到哪个原因，合并时系统写", createdById: "新加原因的人，当前登录账号",
  },
  EntBlockerReasonLink: { blockerId: "哪个卡点，发布时系统写", reasonId: "挂的哪个原因，发布时按选的原因写；合并时系统改挂" },
  EntBlockerLog: {
    blockerId: "哪个卡点，系统写", userId: "谁做的，当前登录账号", at: "那一刻，系统写", action: "发布 / 认领 / 我已完成 / 解决 / 离职交接 / 项目换人接手（老数据还有指认、接受、转让、返回、改进度），系统写",
    fromUserId: "交出去的人，系统写", toUserId: "接过来的人，系统写", note: "返回看板的理由、解决结果等，跟着那一步写；只增不改",
  },
  EntFollowUpMeta: { followUpId: "哪条沟通，记的时候定", projectId: "挂在哪个项目，记的时候定", code: "FUL + 日期 + 当天流水，记的时候系统生成" },
  EntProjectPayment: { projectId: "记在哪个项目的回款卡上，记的时候定", userId: "记这笔的人，当前登录账号" },
  CustomerOwnerLog: {
    customerId: "哪位客户，换负责人时系统写", userId: "谁换的，系统写", at: "换的那一刻，系统写",
    fromOwnerId: "换之前的负责人（历史负责人），系统写", toOwnerId: "换之后的负责人，系统写",
    kind: "改负责人、公海领取 / 分配还是成员停用，系统写",
    clockReset: "企业版三态：这次转让归不归零，夜扫 / 三态按钮第一次算到时系统写，之后不改（迁移 127）",
  },
  // 企业版站内通知 + 飞书推送（2026-11-01，迁移 109）：lib/enterprise/notify.ts 系统写，用户只能点已读
  EntNotice: {
    userId: "收通知的人，事件发生时系统定", kind: "来源（自动分配 / 分配 / 卡点 / 交接……），系统写",
    title: "通知标题，按事件系统拼", body: "通知正文，按事件系统拼", link: "点开去哪，按事件系统写",
    dedupeKey: "同一事件不重复发的键，系统生成", readAt: "铃铛里点已读 / 全部已读时系统写",
    feishuStatus: "推飞书的结果，系统写", feishuError: "没推 / 失败的原因，系统写", feishuAt: "推飞书的时刻，系统写",
  },
  // 企业版教练主题（2026-11-17，迁移 144）：lib/enterprise/coach-topic-db.ts 系统写
  EntCoachTopic: {
    projectId: "发在哪个项目，发起时定", node: "发起那一刻项目在哪个节点，系统写", authorId: "填写人，当前登录账号（不能代别人发）",
    authorRole: "发起身份（销售教练 / 实线上级……），发起那一刻系统写，署名按它",
    status: "待回复 / 已回复 / 已关闭：负责人回复、发起人追问、关闭、项目进公海时系统改", closedById: "谁关的，当前登录账号；进公海自动关的留空",
    closedAt: "关闭的时刻，系统写", deletedAt: "系统管理员删除时系统写（只打记号）",
  },
  EntCoachReply: { topicId: "回在哪个主题下，系统定", userId: "回复人，当前登录账号" },
  // 企业版录音点评的录音（2026-11-22，迁移 162，录音点评 PR2）：lib/enterprise/coach-rec-db.ts 系统写，界面只传文件、点放弃
  EntCoachRecording: {
    projectId: "在哪个项目上开始的，开始时定", authorId: "录 / 传的人，当前登录账号（不能代别人）", status: "上传中 / 待提交 / 已放弃……：传完、放弃时系统改",
    sourceKind: "上传 / 网页录 / 飞书原生录，开始时按入口定", fileName: "传文件时浏览器给的原文件名，开始时记", mime: "浏览器报的类型，开始时记（只作参考）",
    format: "服务端按文件头认的格式，收第一片时系统写", bytes: "传文件开始时报的总字节数，传完系统核对", chunks: "收到几片，传完系统数",
    segCount: "几段，传完系统数", audioPath: "拼好的文件在数据目录下的相对路径，传完系统写", startedAt: "开始的时刻，系统写",
    endedAt: "传完的时刻，系统写", deletedAt: "放弃的时刻，系统写（文件当场删）",
  },
  // 企业版撞号台账（2026-11-10，迁移 115）：lib/enterprise/dupe-ledger.ts 系统写，用户只能点「申请挂靠」
  EntDupeHit: {
    userId: "查询人，当前登录账号", keyType: "撞的是哪种键（手机号 / 客户名……），查重时系统定", keyValue: "撞的值，查重时系统写",
    customerId: "撞到哪位客户，查重时系统定", ownerId: "那一刻的负责人，查重时系统写", sameGroup: "查询人在不在那位客户的项目组，系统算",
    action: "点「申请挂靠」时系统写", actionAt: "点的那一刻，系统写", result: "拦截 / 写进现有项目 / 同组提示，系统写",
    status: "申请挂靠后系统改成待处理，审批人批准 / 拒绝后系统改成已批准 / 已拒绝，待处理时客户进了公海系统改成客户已进公海", warnTier: "触发了第几档预警，系统写",
    approverId: "挂靠审批人，申请时系统定（客户现在的负责人），客户换负责人时跟着换（还没转过上级的），客户进公海时申请直接关，24 小时没处理系统转实线上级、没有上级转总管理，之后每 24 小时再往上一级到总管理为止（迁移 117，回填现有待处理行）",
    escalatedAt: "最近一次往上转审批人的时刻，系统写", decidedById: "点批准 / 拒绝的人，当前登录账号；客户进公海自动关的留空", decidedAt: "点批准 / 拒绝的时刻，或客户进公海自动关的时刻，系统写",
    unbuilt: "出口 C 挑不到人 / 负责人到持有上限整笔没建时系统写的待补建记录（迁移 165，P-公海-15）：客户编号、渠道、对接人、沟通、没建原因、通知了谁、交的人和时间，不写客户名；同一人 10 分钟内再交追加成数组（读走 读未建线索，两种都认）；补建按钮之后做",
  },
  // 企业版客户三态（2026-11-11，迁移 121–123）：三张表都由夜扫和三态按钮系统写，没有哪一列是用户直接填进表的
  // （继续持有的理由是点按钮时填的一句话，由动作连同次数、推后日一起写）
  EntCustomerClock: {
    customerId: "哪位客户，夜扫第一次算到他时系统建", state: "活跃 / 沉睡 / 待回收，夜扫按最近沟通、项目推进、换负责人算出来", enteredDay: "哪天进的这个状态，系统写",
    noticeCount: "本轮提醒了几次，发提醒时系统加、换状态清零", lastNoticeDay: "最近一次提醒是哪天，发提醒时系统写",
    holdCount: "继续持有累计用了几次，点「我还在跟 / 写理由继续持有」时系统加", holdDays: "继续持有合计顺延了几天，同上系统加",
    holdUntil: "推后到哪天，点继续持有时系统按组织规则的每次天数算", holdReason: "最后一次继续持有的理由，点按钮时连同次数一起由动作写，之后不能单独改",
    blocked: "到期被同事项目挡住的标记，夜扫写、裁决后系统清",
    dealDay: "成交成立日，夜扫首次判出「成交过」那天系统写，之后不改（迁移 124）",
    quotaResetDay: "额度上次重置日，有内容的沟通让继续持有额度回满时系统写（迁移 125）",
    progressDay: "项目推进底日，夜扫按算到的最近项目推进日系统写、只往后挪（迁移 131）",
    poolDueDay: "最早进公海日，待回收时写钟按完整事实系统算、列表读（迁移 133）",
  },
  EntCustomerStateLog: {
    customerId: "哪位客户，系统写", fromState: "变更前的状态，系统写", toState: "变更后的状态，系统写", userId: "谁改的，当前登录账号；自动的留空",
    via: "自动 / 本人 / 上级代选 / 总管理裁决，按谁点的系统定", reason: "理由，随那次动作写入，留痕只加不改", at: "变更的那一刻，系统写", holdDays: "这次继续持有顺延了几天，点按钮时按组织规则的每次天数系统写（迁移 126）",
    fromOwnerId: "撤销转让 / 标待交接那一行的原负责人，系统写（迁移 128）", toOwnerId: "撤销转让那一行被撤的那次转让转给了谁，系统写（迁移 129）",
  },
  EntProjectCold: {
    projectId: "哪个项目，标冷时系统建", coldDay: "从哪天冷的，系统算", level: "提醒到第几级，发提醒时系统写",
  },
  EntFollowUpFirstValid: {
    followUpId: "哪条沟通，存的时候无效、后来改成有效时系统建（迁移 132）", at: "改成有效的那一刻，系统写、之后不改",
  },
  EntLeadMakeup: {
    userId: "补给谁：判无效时线索的负责人，系统记（lib/enterprise/invalid-makeup.ts，迁移 155）",
    projectId: "哪条线索判了无效，判死时系统记",
    line: "分配方向，从那条线索算数的分配记录抄过来",
    usedAt: "自动分配用掉的那一刻，系统写；撤销自动分配时清掉",
    usedAssignId: "用在哪条分配记录上，自动分配写分配记录时系统写",
    usedProjectId: "用在哪个项目上，同上",
    voidAt: "判无效的线索被恢复时系统作废，不给改",
    kind: "哪种待补：空 = 判无效记的，giveup = 主动放弃记的，系统写（迁移 161）",
  },
  EntLeadGiveUp: {
    userId: "谁放弃的：点「放弃」那一刻的负责人，系统记（lib/enterprise/lead-giveup.ts，迁移 160）",
    month: "北京自然月，系统按点的那一刻算，每人每月 1 次靠它", projectId: "放弃的哪条线索，系统记",
    reason: "放弃原因，销售在框里选（外出 / 忙不过来 / 其他），记下后不改", note: "选「其他」时销售写的那句，记下后不改",
    toUserId: "转给了谁，转成时系统写", makeupId: "给放弃人记的那条待补，系统写",
  },
  EntRequiredBlock: {
    at: "被拦的那一刻，系统写（lib/project/required-block.ts，迁移 164）", userId: "谁被拦的，当前登录账号", projectId: "哪个项目，系统写",
    customerId: "那一刻项目挂的客户，系统照抄", phase: "被拦时项目的阶段，系统照抄", node: "被拦时项目的节点，系统照抄",
    toPhase: "想推到的阶段，系统按入口写；不知道的留空", toNode: "想推到的节点，同上",
    kind: "节点必填 / 线索验证 / 本节点沟通，按哪道关拦下系统写", missing: "缺哪几项（显示名），系统按那一刻的必填算",
    entry: "从哪儿推的（完成节点 / 看板拖动 / 首页AI 等），系统写", onBehalf: "直属上级代推被拦，系统按「仅上级推」判",
  },
  EntReplyOverdue: {
    projectId: "哪个项目，超时未跟进那条链起头时系统建（迁移 150）", anchorAt: "起链时的超时基准，系统按指定回复时间写", holderId: "链上眼下这一位，系统写",
    since: "这一位的计时起点，系统写", overdueAt: "超时提醒发出的那一刻，钟上系统写", tried: "这一轮超时过的人，自动转时系统写",
    transfers: "自动转了几次，系统加", stoppedAt: "记了有效沟通或出了范围、链停下的那一刻，系统写",
  },
};

/**
 * 系统事实：记「事情怎么发生的」，由系统在那一刻写。每个字段写明：
 *   写入方 —— 仓库里写它的文件（相对仓库根）；审计核这个文件还在写这个字段（粗查：文件里有 `字段: 值` 或 `.字段 = 值`，`字段: true` 那种 select 不算）
 *   说明   —— 什么时候写、写什么
 *   仓库外 —— 写入方为空时必填：现在是谁在写（比如一次性回填脚本），为什么仓库里没有；这类字段审计单独报出来，清单钉死
 *   漏写   —— 可选：已知哪些建法 / 路径不写它（复盘查出来的），留在这里显眼，补上就删
 * 同时能手改的（客户分配、渠道负责人）照样在 可写 里，这里另外要求它有系统写入方。
 */
type 系统事实项 = { 写入方: string[]; 说明: string; 仓库外?: string; 漏写?: string };
const 系统事实: Record<string, Record<string, 系统事实项>> = {
  Customer: {
    flowLine: {
      写入方: ["src/lib/enterprise/flow-line.ts"],
      说明: "流转线（迁移 158，32G）：名下线索最近一次写的流转线，跟着 Project.flowLine 一起写（flow-line.ts 写流转线，裸 SQL 不碰 updatedAt）；公海按线可见用它",
      仓库外: "老数据由一次性定线脚本回填（r20-按线定线）",
    },
    assignWay: {
      写入方: ["src/lib/enterprise/customer-assign-way.ts", "src/lib/enterprise-import/clean.ts"],
      说明: "客户分配（怎么到销售手上）：分配 / 领取 / 市场转销售时系统按字典「客户分配」当时的叫法写（customer-assign-way.ts）；导入时按「分配方式」一列写（clean.ts）；表单上也能手改",
    },
    channelOwnerId: {
      写入方: ["src/lib/attribution.ts", "src/app/(app)/customers/actions.ts", "src/lib/enterprise-import/apply.ts"],
      说明: "渠道负责人：按来源渠道当时的负责人系统带出（attribution.ts 算，保存客户 / 导入时写）；表单上也能手改",
      漏写: "11-17 复盘第 6 类：正式库 1,658 位客户有来源渠道、渠道负责人是空的，推断是迁移脚本直接写库漏的（仓库里的路径都会写）",
    },
  },
  Project: {
    flowLine: {
      写入方: ["src/lib/enterprise/flow-line.ts"],
      说明: "流转线（迁移 157，32G）：内贸 / 外贸，市场分配那一刻按方向写、销售 / 市场新增按新增人事业部写、管理手动指定按接收人事业部改；超时转、公海领取不改（规则见 flow-line-core.ts）；超时转只在这条线里转",
      仓库外: "老数据由一次性定线脚本回填（r20-按线定线）",
    },
    assignMode: {
      写入方: ["src/lib/project/proj-fields.ts", "src/lib/enterprise/market-transfer.ts"],
      说明: "新建线索 / 项目时选的分配方式，建的那一刻记下，之后不改（11-01 会议 §3，lib/project/after-create-assign.ts）；市场转销售带走的线索补写。" +
        "线索转化（project/from-lead.ts 按建给谁）、导入建项目（enterprise-import/apply.ts 导入分配方式，按原表那一行）也经 proj-fields.ts 新项目默认值 写（11-17 复盘第 5 类补上）",
      漏写: "仓库里的建项目路径都写了；仓库外的潜客培育补数脚本（fill-nurture.mjs，按 nurture.ts 约定）建的项目不写，补写之前的存量也没回填：11-17 补数前正式库 6,799 个项目里只有 124 个有值",
    },
    sourceLeadId: {
      写入方: ["src/lib/project/from-lead.ts"],
      说明: "线索转项目时系统记下是哪条线索来的，之后不改",
    },
    source: {
      写入方: [],
      说明: "项目来源（迁移 151）：「历史沟通分析」= history-analysis（lib/project/system-created.ts 历史分析来源），建好不改；项目详情只读显示「数据来源：历史分析」标签",
      仓库外: "只有一次性回填脚本写（客户目录里的脚本直接写库，照 system-created.ts 的回填约定），仓库里的建项目路径都不写；空 = 系统里建的",
    },
    repeatOfCustomerId: {
      写入方: ["src/lib/enterprise/dedupe-claim.ts"],
      说明: "老客户重复咨询的原始客户（迁移 163，客户 E-218）：出口 C、查重领取建带「老客户重复咨询」标记的线索时系统写撞上的那位客户，之后不改、没有编辑入口；详情只读显示原始客户编号，检索 / 统计读它不读名字",
    },
    repeatSeq: {
      写入方: ["src/lib/enterprise/dedupe-claim.ts"],
      说明: "这位客户的第几次重复咨询（迁移 163）：只有出口 C 建时系统按已有非空最大号 + 1 写（含回收站、已结束的），查重领取建的写空、不占号；(原始客户, 序号) 唯一；项目名第 2 次起的「-2」「-3」按它取，之后不改",
    },
    importBatch: {
      写入方: [],
      说明: "回填批次号（迁移 151）：同一次回填同一个值，按批核对、撤回用，界面不改",
      仓库外: "同 source：只有一次性回填脚本写，仓库里没有写入方",
    },
  },
  EntLeadAssign: {
    way: {
      写入方: ["src/app/(app)/leads/assign-actions.ts"],
      说明: "分配方式（字典「分配方式」当时的叫法），按谁点的系统记：手动分=指定分配，自动分=自动分配，不让人填",
    },
  },
};

/** 系统事实里「仓库里没有任何写入方」的字段，钉死在这里：多一个（新加的系统事实没人写）或少一个（补上了写入方）都要来改这里 */
const 系统事实无写入方 = ["Project.importBatch", "Project.source"];

/** 名字一看就是系统事实的字段（分配方式、导入批次），不管在哪个模型，都得进 系统事实 */
const 像系统事实 = /^(assignWay|assignMode|importBatch)$/;

/** 粗查：这个文件里有没有写这个字段（`字段: 值` 或 `.字段 = 值`；`字段: true` 是 select，不算） */
function 写了(文件: string, 字段: string): boolean {
  const t = fs.readFileSync(path.resolve(__dirname, "..", 文件), "utf8");
  return new RegExp(`\\b${字段}\\s*:\\s*(?!true\\b)[^\\s,}]|\\.${字段}\\s*=(?!=)`).test(t);
}

/** 已知缺口：有字段、没写入路径。留在这里是为了让它一直显眼 */
/** 已知缺口：有字段、没写入路径。留在这里是为了让它一直显眼。
 *  2026-09-14 清空：FollowUp.attachment / attachSize 是纯死字段，已从 schema 删除
 *  （已有库里的列留着不读，迁移规矩只加不删）。 */
const 已知缺口: Record<string, Record<string, string>> = {
  // 团队版项目模式 1a：进组状态 1a 拉人一律 JOINED（系统写），等 1b 进组邀请补上「已邀请 / 没接受」
  ProjectMember: { inviteStatus: "1a 拉人一律写 JOINED；用户能动它要等 1b 进组邀请（团队版会话）" },
  // 企业版组织架构（2026-10-24）：这一步只有表和 helper，设置里的「组织架构」页在下一个 PR，到时挪进 可写
  EntDept: { name: "设置里的组织架构页在下一个 PR 才有写入口", parentId: "设置里的组织架构页在下一个 PR 才有写入口", sort: "设置里的组织架构页在下一个 PR 才有写入口" },
  // 企业版录音点评（2026-11-22，迁移 162）：表在 PR2 一次建全（迁移只加表），这几列等后面的 PR 才写
  EntCoachRecording: {
    durationMs: "PR4 转写前服务端用 ffprobe 算（不信客户端）", sampleRate: "PR4 转写前服务端用 ffprobe 读出来，定用哪个引擎", interrupts: "PR3 按住说话 / 点按录音被打断时系统写",
    transcript: "PR4 腾讯云转写回来的全文，系统写", segments: "PR4 腾讯云转写回来的分段，系统写", speakers: "PR4 腾讯云转写认出的说话人数，系统写",
    engine: "PR4 提交转写时系统写用的哪个引擎", asrTaskId: "PR4 提交转写时系统写腾讯云任务号", asrSubmittedAt: "PR4 提交转写时系统写提交时刻",
    draftTitle: "PR5 AI 整理出的主题、确认框里改过的也存这里", draftBody: "PR5 AI 整理出的要点、确认框里改过的也存这里", error: "PR4 / PR5 转写或整理失败时系统写给人看的原因",
    topicId: "PR5 确认发出时系统写对应的主题", remindedAt: "PR6 草稿到期前一天提醒时系统写", audioPurgedAt: "PR6 录音 180 天到期删音频时系统写",
  },
  EntMember: {
    userId: "设置里的组织架构页在下一个 PR 才有写入口", deptId: "设置里的组织架构页在下一个 PR 才有写入口", bizRole: "设置里的组织架构页在下一个 PR 才有写入口",
    line: "设置里的组织架构页在下一个 PR 才有写入口", managerId: "设置里的组织架构页在下一个 PR 才有写入口", dottedManagerId: "设置里的组织架构页在下一个 PR 才有写入口",
  },
};

const 不审 = new Set(["User", "WorkspaceAccount", "FollowUpSource", "AuditLog", "Setting"]);

describe("每个模型的每个字段都有归属", () => {
  const 全部 = 标量字段();
  for (const [model, fields] of Object.entries(全部)) {
    if (不审.has(model)) continue;
    it(`${model}：${fields.length} 个字段都能改，或者说清为什么不能`, () => {
      const 没归类 = fields.filter(
        (f) => !可写[model]?.includes(f) && !派生[model]?.[f] && !系统事实[model]?.[f] && !已知缺口[model]?.[f],
      );
      expect(没归类, `${model} 里这些字段既不能改、也没说明为什么：${没归类.join("、")}`).toEqual([]);
    });
  }

  it("可写清单里不能有 schema 里根本没有的字段——那是改了表忘了改这里", () => {
    const 全部 = 标量字段();
    for (const [model, fields] of Object.entries(可写)) {
      const 多出 = fields.filter((f) => !全部[model]?.includes(f));
      expect(多出, `${model} 的可写清单里有 schema 没有的字段：${多出.join("、")}`).toEqual([]);
    }
  });

  it("系统事实：每个字段都在 schema 里，不和 派生 重复列", () => {
    const 全部 = 标量字段();
    for (const [model, fs_] of Object.entries(系统事实)) {
      for (const f of Object.keys(fs_)) {
        expect(全部[model]?.includes(f), `系统事实里的 ${model}.${f} schema 里没有`).toBe(true);
        expect(派生[model]?.[f], `${model}.${f} 同时列在 派生 和 系统事实 里，留一处（系统事实）`).toBeUndefined();
      }
    }
  });

  it("系统事实：列出的写入方文件都在、而且还在写这个字段", () => {
    const 不对: string[] = [];
    for (const [model, fs_] of Object.entries(系统事实)) {
      for (const [f, 项] of Object.entries(fs_)) {
        expect(项.说明.length, `${model}.${f} 没写说明`).toBeGreaterThan(10);
        for (const 文件 of 项.写入方) {
          if (!fs.existsSync(path.resolve(__dirname, "..", 文件))) 不对.push(`${model}.${f}：${文件} 不存在`);
          else if (!写了(文件, f)) 不对.push(`${model}.${f}：${文件} 里找不到写它的地方`);
        }
      }
    }
    expect(不对, `系统事实的写入方对不上（文件搬了 / 不再写了就改清单，真没人写了就是缺口）：\n${不对.join("\n")}`).toEqual([]);
  });

  it("系统事实：没有任何写入方的字段单独报出来，清单钉死（新加的没人写 / 补上了写入方都要来改）", () => {
    const 没写入方 = Object.entries(系统事实)
      .flatMap(([model, fs_]) => Object.entries(fs_).filter(([, 项]) => 项.写入方.length === 0).map(([f]) => `${model}.${f}`))
      .sort();
    for (const k of 没写入方) {
      const [model, f] = k.split(".");
      expect((系统事实[model][f].仓库外 ?? "").length, `${k} 没有任何写入方，也没写现在是谁在写（仓库外）`).toBeGreaterThan(10);
    }
    expect(没写入方, `这些系统事实字段仓库里没有任何写入方：${没写入方.join("、")}`).toEqual(系统事实无写入方);
  });

  it("名字像系统事实的字段（分配方式 / 导入批次）都进了 系统事实，不能只算「可写」或「派生」就放过", () => {
    const 漏 = Object.entries(标量字段())
      .filter(([model]) => !不审.has(model))
      .flatMap(([model, fields]) => fields.filter((f) => 像系统事实.test(f) && !系统事实[model]?.[f]).map((f) => `${model}.${f}`));
    expect(漏, `这些字段记的是「怎么发生的」，要列系统写入方：${漏.join("、")}`).toEqual([]);
  });

  it("已知缺口是要还的债：每条都要有说明", () => {
    for (const [model, gaps] of Object.entries(已知缺口)) {
      for (const [f, why] of Object.entries(gaps)) expect(why.length, `${model}.${f} 没写为什么`).toBeGreaterThan(10);
    }
  });
});
