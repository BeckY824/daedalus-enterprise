/**
 * 客户只读卡（企业版，客户负责人第一批 E①，机制总表 P-看-10 / P-看-13 / X-15）。
 *
 * 只负责项目、不负责客户的人进不了客户详情（放开详情会连带手机号、合同金额、同事的沟通），
 * 从自己的项目详情单点打开这张卡，看客户资料和联系人。
 *
 *   - 谁能开：这个项目的负责人、负责人的实线直属上级；项目创建人、虚线上级都不行（第五节 5，上级档待确认，先做实线）。
 *     进门先过项目详情同一套（限定层、能看项目、市场挡详情），只收窄不放宽；公海项目、公海客户一律不开，
 *     看得到公海的人走原来的客户详情，要回避的也不因这张卡露出。
 *   - 给什么：客户资料白名单 + 联系人姓名、职务；只有这位负责人自己项目（这家客户名下、没进公海）关联的联系人才给联系方式，
 *     上级看到的和下属同一张卡。不给客户负责人、级别、状态，也不给联系人和客户的编号，拿着卡接不到别的接口。
 *   - 不改限定层：客户列表、全局搜索、导出、批量拉取、AI 查询、待办范围都不因此多一条。卡内容只从这里点开时取。
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 号码脱敏器 } from "@/lib/enterprise/phone-mask";
import { 企业版 } from "./switch";
import { 权限组织 } from "./org";
import { 直属上级of, type 组织 } from "./org-core";
import { 能看项目, type 权限项目, type 谁 } from "./permissions";
import { 市场进不了详情 } from "./market-view-db";
import { 拼地址 } from "./customer-v2";
import { 号码种类表, 种类叫法, 联系人号码们 } from "./customer-v2-db";

export type 只读卡联系人 = {
  name: string;
  position: string | null;
  /** 这位在不在负责人自己的项目上：false = 下面几格都是空的，界面说明为什么没有号码 */
  给联系方式: boolean;
  phone: string | null;
  email: string | null;
  wechat: string | null;
  号码们: { 叫法: string; value: string }[];
};

export type 客户只读卡 = {
  客户: {
    name: string;
    shortName: string | null;
    school: string | null;
    customerType: string | null;
    customerAttr: string | null;
    地区: string;
    addrDetail: string | null;
    website: string | null;
  };
  联系人: 只读卡联系人[];
};

/** 号码类的几种过脱敏器，微信、邮箱这些照旧（同客户详情页联系人的口径） */
const 打码种类 = new Set(["phone", "landline", "whatsapp", "fax"]);

/**
 * 能不能开这张卡。项目详情页已经查过项目和组织，直接传进来，读卡和页面入口共用这一份规则。
 * 前提：p 是从带限定的 prisma 查出来的（看不到的项目到不了这里）
 */
export async function 只读卡放行(
  me: 谁,
  p: 权限项目 & { id: string; pooledAt?: Date | null; 已加入?: readonly string[]; 客户在公海: boolean },
  org: 组织 | null,
): Promise<boolean> {
  if (!企业版() || !org || p.pooledAt || p.客户在公海) return false;
  if (p.ownerId !== me.id && 直属上级of(org, p.ownerId) !== me.id) return false;
  if (!能看项目(me, p, org)) return false;
  return !(await 市场进不了详情(me.id, p.id, { ownerId: p.ownerId, pooledAt: p.pooledAt ?? null, 已加入: p.已加入 }));
}

/** 读卡：不让看 = null。只在项目详情里点开时调 */
export async function 读客户只读卡(me: 谁, projectId: string): Promise<客户只读卡 | null> {
  if (!企业版()) return null;
  const p = await prisma.project.findFirst({
    where: { id: projectId },
    select: {
      id: true, customerId: true, ownerId: true, creatorId: true, pooledAt: true, bizLine: true,
      members: { where: { inviteStatus: "JOINED" }, select: { userId: true } },
    },
  });
  if (!p) return null;
  // 客户本身多半看不到（这张卡就是给这种情况的），从这往下绕开限定层，所以字段全部写明，只取白名单
  const [org, 底] = await Promise.all([权限组织(), 读卡底子(p.customerId, p.ownerId)]);
  if (!底) return null;
  const 放行 = await 只读卡放行(me, { ...p, 已加入: p.members.map((m) => m.userId), 客户在公海: 底.在公海 }, org);
  if (!放行) return null;
  return 拼卡(me, p.customerId, 底);
}

type 卡底子 = NonNullable<Awaited<ReturnType<typeof 读卡底子>>>;

/**
 * 卡的底子：客户白名单字段 + 「谁的项目」上的联系人（只有这些给联系方式）。客户删了 = null。
 * 项目详情点开的卡按项目负责人算；挂靠批准后的卡（attach-approval.ts）按申请人自己算（P-看-13）
 */
export async function 读卡底子(customerId: string, 项目负责人: string) {
  const [客户, 自己项目] = await Promise.all([
    看全部(() => prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: {
        name: true, shortName: true, school: true, customerType: true, customerAttr: true,
        addrCountry: true, addrProvince: true, addrCity: true, addrDistrict: true, addrDetail: true,
        pool: { select: { customerId: true } },
        extra: { select: { website: true } },
      },
    })),
    看全部(() => prisma.project.findMany({
      where: { customerId, ownerId: 项目负责人, pooledAt: null, deletedAt: null },
      select: { contactId: true, contactLinks: { select: { contactId: true } } },
    })),
  ]);
  if (!客户) return null;
  const 自己项目的人 = new Set(自己项目.flatMap((x) => [...(x.contactId ? [x.contactId] : []), ...x.contactLinks.map((l) => l.contactId)]));
  return { 客户, 自己项目的人, 在公海: !!客户.pool };
}

/** 放行之后拼卡：客户白名单 + 联系人（不在自己项目上的只给姓名、职务） */
export async function 拼卡(me: 谁, customerId: string, { 客户, 自己项目的人 }: 卡底子): Promise<客户只读卡> {
  // 这家客户的联系人，含挂靠过来的（同客户详情页）；只隶属别家、没挂到这家的不列
  const [联系人行, 号, 种类表] = await Promise.all([
    看全部(() => prisma.contact.findMany({
      where: { deletedAt: null, OR: [{ customerId }, { customerLinks: { some: { customerId } } }] },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      select: {
        id: true, name: true, position: true, phone: true, email: true, wechat: true,
        contactMethods: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { kind: true, value: true } },
      },
    })),
    号码脱敏器(me.id),
    号码种类表(),
  ]);

  const { name, shortName, school, customerType, customerAttr, addrCountry, addrProvince, addrCity, addrDistrict, addrDetail } = 客户;
  return {
    客户: {
      name, shortName, school, customerType, customerAttr, addrDetail,
      地区: 拼地址({ addrCountry, addrProvince, addrCity, addrDistrict }),
      website: 客户.extra?.website ?? null,
    },
    联系人: 联系人行.map((c) => {
      if (!自己项目的人.has(c.id)) return { name: c.name, position: c.position, 给联系方式: false, phone: null, email: null, wechat: null, 号码们: [] };
      const 号码们 = 联系人号码们(c, c.contactMethods).map((x) => ({ kind: x.kind, value: 打码种类.has(x.kind) ? 号(x.value) : x.value }));
      const 第一 = (kind: string) => 号码们.find((x) => x.kind === kind)?.value ?? null;
      return {
        name: c.name, position: c.position, 给联系方式: true,
        phone: 第一("phone"), email: 第一("email"), wechat: 第一("wechat"),
        号码们: 号码们.map((x) => ({ 叫法: 种类叫法(种类表, x.kind), value: x.value })),
      };
    }),
  };
}
