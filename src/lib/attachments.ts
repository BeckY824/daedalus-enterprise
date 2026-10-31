/**
 * 商机 / 订单的附件（2026-10-22 D-24）：文件放在数据目录 attachments/<编号>，表 Attachment 只记名字、类型、大小。
 *
 *   - 文件名就是编号（只有字母数字），不带原名、不带扩展名：Windows 的长路径、奇怪字符都碰不到；原名在表里
 *   - 文件存进去以后不再改（要「换一张」就是删了再传）：备份可以硬链接、团队版可以按 sha256 认
 *   - 先写文件、再写行：行在文件不在 = 「文件不在这台电脑上」（团队版以后：还没下载），界面照样列出来
 *   - 不建外键：商机删了能撤销（同一个编号再建回来），所以父记录没了先不删，满 1 天再连文件清掉（清孤儿）
 *
 * 企业版联系人附件（2026-10-28）：也能挂在线索（leadId）、联系人（contactId）上——名片原图、联系人相关图片。
 * 线索转客户 / 并入时补上 contactId（线索附件转给联系人），两列任一条父记录在就不算孤儿。接口只在企业版认这两列。
 *
 * 个人版只存本机。团队版：行跟着范围同步走，文件走单独的密文通道（sync/attach-client.ts：同步一轮的最后加密上传、
 * 打开时才下载；删了行，云端收到删除就连密文一起删）。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { PrismaClient } from "@/generated/prisma";
import { 是附件编号, type 附件, type 归属 } from "./attachment-rules";

/**
 * 附件放哪：桌面端 = 数据目录（每个账号一个，和 crm.db 放一起，自动备份跟着走）；
 * 自部署 / 开发 = 库文件旁边（DATABASE_URL=file:/data/crm.db → /data/attachments）
 */
export function 附件目录(): string {
  const 数据 = process.env.CRM_DATA_DIR;
  if (数据) return path.join(数据, "attachments");
  const url = process.env.DATABASE_URL ?? "";
  const 库 = url.startsWith("file:") ? url.slice(5).split("?")[0] : "";
  return path.join(库 ? path.dirname(path.resolve(库)) : process.cwd(), "attachments");
}

export function 附件文件(id: string, 目录 = 附件目录()): string {
  if (!是附件编号(id)) throw new Error("附件编号不对");
  return path.join(目录, id);
}

export function 有文件(id: string, 目录 = 附件目录()): boolean {
  try { return fs.statSync(附件文件(id, 目录)).isFile(); } catch { return false; }
}

/**
 * 要用这个附件的文件时先问一句（取文件、打开都走这里）。
 * 个人版：有就是有，没有就是没有。团队版（范围同步）：本机没有就去云端取（sync/attach-client.ts），
 * 别人刚传、还没传完的回「还在上传」
 */
export async function 确保文件(id: string, 目录 = 附件目录()): Promise<"有" | "还在上传" | "没有"> {
  if (有文件(id, 目录)) return "有";
  if (!process.env.CRM_DATA_DIR) return "没有"; // 只有桌面端有团队同步
  const { 下载附件 } = await import("./sync/attach-client");
  return 下载附件(id, 目录);
}

type 行 = { id: string; name: string; mime: string; size: number; width: number | null; height: number | null; createdAt: Date };
export function 给界面(r: 行, 目录 = 附件目录()): 附件 {
  return { id: r.id, name: r.name, mime: r.mime, size: r.size, width: r.width, height: r.height, createdAt: r.createdAt.toISOString(), 有文件: 有文件(r.id, 目录) };
}

const 选列 = { id: true, name: true, mime: true, size: true, width: true, height: true, createdAt: true } as const;

/**
 * 分类：企业版联系人附件的 名片 / 相册（迁移 074）、项目附件的 合同 / 其它（10-31）。给了就只列这一类；
 * 相册、其它连没分类的老附件一起算（customer-v2.ts 附件分类们 / 项目附件分类们）
 */
export function 分类条件(分类: string | null | undefined) {
  if (!分类) return {};
  return 分类 === "相册" || 分类 === "其它" ? { OR: [{ tag: 分类 }, { tag: null }] } : { tag: 分类 };
}

export async function 列附件(db: PrismaClient, 挂在: 归属, 目录 = 附件目录(), 分类?: string | null): Promise<附件[]> {
  const 行们 = await db.attachment.findMany({ where: { ...挂在, ...分类条件(分类) }, orderBy: { createdAt: "asc" }, select: 选列 });
  return 行们.map((r) => 给界面(r, 目录));
}

/** 先写临时文件、改名到位，再插行；插行失败把文件删掉 */
export async function 存附件(
  db: PrismaClient,
  x: { 挂在: 归属; name: string; mime: string; 字节: Uint8Array; width?: number | null; height?: number | null; userId?: string | null; tag?: string | null },
  目录 = 附件目录(),
): Promise<附件> {
  fs.mkdirSync(目录, { recursive: true });
  const id = 新编号();
  const 文件 = 附件文件(id, 目录);
  const 临时 = path.join(目录, `.tmp-${id}`);
  fs.writeFileSync(临时, x.字节);
  fs.renameSync(临时, 文件);
  try {
    const r = await db.attachment.create({
      data: {
        id,
        ...x.挂在,
        name: x.name,
        mime: x.mime,
        size: x.字节.byteLength,
        width: x.width ?? null,
        height: x.height ?? null,
        sha256: crypto.createHash("sha256").update(x.字节).digest("hex"),
        userId: x.userId ?? null,
        tag: x.tag ?? null,
      },
      select: 选列,
    });
    return 给界面(r, 目录);
  } catch (e) {
    fs.rmSync(文件, { force: true });
    throw e;
  }
}

/** 删行、删文件。团队版：删行会作为一条删除同步上去，云端收到就删它那份密文（tenant/sync-attach.ts 删云端附件） */
export async function 删附件(db: PrismaClient, id: string, 目录 = 附件目录()): Promise<void> {
  await db.attachment.deleteMany({ where: { id } });
  fs.rmSync(附件文件(id, 目录), { force: true });
}

/** 导出 Excel 用：每个商机（企业版还有线索 / 联系人 / 项目）各几个附件 */
export async function 附件个数(
  db: PrismaClient,
  q: { opportunityIds?: string[]; leadIds?: string[]; contactIds?: string[]; projectIds?: string[] },
): Promise<{ 商机: Map<string, number>; 线索: Map<string, number>; 联系人: Map<string, number>; 项目: Map<string, number> }> {
  const 商机 = new Map<string, number>();
  const 线索 = new Map<string, number>();
  const 联系人 = new Map<string, number>();
  const 项目 = new Map<string, number>();
  if (q.opportunityIds?.length) {
    for (const g of await db.attachment.groupBy({ by: ["opportunityId"], where: { opportunityId: { in: q.opportunityIds } }, _count: { _all: true } })) {
      if (g.opportunityId) 商机.set(g.opportunityId, g._count._all);
    }
  }
  if (q.leadIds?.length) {
    for (const g of await db.attachment.groupBy({ by: ["leadId"], where: { leadId: { in: q.leadIds } }, _count: { _all: true } })) {
      if (g.leadId) 线索.set(g.leadId, g._count._all);
    }
  }
  if (q.contactIds?.length) {
    for (const g of await db.attachment.groupBy({ by: ["contactId"], where: { contactId: { in: q.contactIds } }, _count: { _all: true } })) {
      if (g.contactId) 联系人.set(g.contactId, g._count._all);
    }
  }
  if (q.projectIds?.length) {
    for (const g of await db.attachment.groupBy({ by: ["projectId"], where: { projectId: { in: q.projectIds } }, _count: { _all: true } })) {
      if (g.projectId) 项目.set(g.projectId, g._count._all);
    }
  }
  return { 商机, 线索, 联系人, 项目 };
}

/**
 * 企业版联系人附件分两格（名片 / 相册，2026-10-29 定稿 P5 待定 19）：联系人 id → 每格几张。没分类的老附件算相册（同 分类条件）。
 * 一张都没有的联系人不在里面
 */
export async function 联系人分类附件数(db: PrismaClient, contactIds: string[]): Promise<Record<string, { 名片: number; 相册: number }>> {
  const 结果: Record<string, { 名片: number; 相册: number }> = {};
  if (!contactIds.length) return 结果;
  for (const g of await db.attachment.groupBy({ by: ["contactId", "tag"], where: { contactId: { in: contactIds } }, _count: { _all: true } })) {
    if (!g.contactId) continue;
    const x = (结果[g.contactId] ??= { 名片: 0, 相册: 0 });
    x[g.tag === "名片" ? "名片" : "相册"] += g._count._all;
  }
  return 结果;
}

/** 企业版项目附件分两格（合同 / 其它，10-31）：这个项目每格几个。没分类的老附件算其它（同 分类条件） */
export async function 项目分类附件数(db: PrismaClient, projectId: string): Promise<{ 合同: number; 其它: number }> {
  const x = { 合同: 0, 其它: 0 };
  for (const g of await db.attachment.groupBy({ by: ["tag"], where: { projectId }, _count: { _all: true } })) {
    x[g.tag === "合同" ? "合同" : "其它"] += g._count._all;
  }
  return x;
}

/**
 * 线索转客户 / 并入客户以后，线索上的附件（名片原图）补挂到联系人上（企业版联系人附件）。
 * leadId 留着：线索页上照样看得到；线索后来删了，图片跟着联系人留下来（清孤儿两列任一在就留）。
 * 已经挂了别的联系人的不动。返回补了几个
 */
export async function 线索附件转给联系人(db: Pick<PrismaClient, "attachment">, leadId: string, contactId: string): Promise<number> {
  const r = await db.attachment.updateMany({ where: { leadId, contactId: null }, data: { contactId } });
  return r.count;
}

/**
 * 导出客户用：每位客户的商机上挂了几个附件（D-24：Excel 不带文件，写明个数）。
 * 含联系人（企业版联系人附件）：再数这位的联系人上挂的，加上转成这位客户的线索上、还没挂到联系人的（线索没写联系人时转的）；
 * 有才带「联系人」这一格，关着时结果和原来一模一样。
 * db 传加了限定的 prisma：业务员看不到的商机，它的附件也不算进去。分批查，不拼一条超长的 in
 */
export async function 客户附件个数(db: PrismaClient, customerIds: string[], 含联系人 = false): Promise<Map<string, { 商机: number; 联系人?: number }>> {
  const 结果 = new Map<string, { 商机: number; 联系人?: number }>();
  if (!customerIds.length || !(await db.attachment.findFirst({ select: { id: true } }))) return 结果;
  const 记 = (客户: string, 类: "商机" | "联系人", n: number) => {
    const x = 结果.get(客户) ?? { 商机: 0 };
    x[类] = (x[类] ?? 0) + n;
    结果.set(客户, x);
  };
  for (let i = 0; i < customerIds.length; i += 500) {
    const 这批 = customerIds.slice(i, i + 500);
    const 商机们 = await db.opportunity.findMany({ where: { customerId: { in: 这批 } }, select: { id: true, customerId: true } });
    for (let j = 0; j < 商机们.length; j += 500) {
      const 数 = await 附件个数(db, { opportunityIds: 商机们.slice(j, j + 500).map((o) => o.id) });
      for (const o of 商机们.slice(j, j + 500)) { const n = 数.商机.get(o.id); if (n) 记(o.customerId, "商机", n); }
    }
    if (含联系人) {
      const 联系人们 = await db.contact.findMany({ where: { customerId: { in: 这批 } }, select: { id: true, customerId: true } });
      for (let j = 0; j < 联系人们.length; j += 500) {
        const 段 = 联系人们.slice(j, j + 500);
        const 数 = await 附件个数(db, { contactIds: 段.map((c) => c.id) });
        for (const c of 段) { const n = 数.联系人.get(c.id); if (n) 记(c.customerId, "联系人", n); }
      }
      const 线索们 = await db.lead.findMany({ where: { customerId: { in: 这批 } }, select: { id: true, customerId: true } });
      for (let j = 0; j < 线索们.length; j += 500) {
        const 段 = 线索们.slice(j, j + 500);
        for (const g of await db.attachment.groupBy({ by: ["leadId"], where: { leadId: { in: 段.map((l) => l.id) }, contactId: null }, _count: { _all: true } })) {
          const 客户 = 段.find((l) => l.id === g.leadId)?.customerId;
          if (客户) 记(客户, "联系人", g._count._all);
        }
      }
    }
  }
  return 结果;
}

/** cuid 风格：c + 时间 + 随机，只有小写字母数字 */
function 新编号(): string {
  return "c" + Date.now().toString(36) + crypto.randomBytes(10).toString("hex");
}

const 一天 = 24 * 3600 * 1000;
const 十分钟 = 10 * 60 * 1000;
const g = globalThis as unknown as { __附件清理?: number };

/**
 * 清孤儿：
 *   - 行在、商机 / 线索 / 联系人 / 项目（企业版 P11）都不在了（只挂过订单的也算：订单表 2026-10-29 删了，企业版老数据清理早已删过这些附件）：第一次看到记下来（attachments/.orphans.json），满 1 天还不在（没撤销）就连文件删掉
 *   - 文件在、行不在（存到一半断了、从备份恢复了更早的库）：文件 10 分钟没动过就删
 * db 要传**不加限定的**（defaultClient 包在 看全部 里）：业务员那台看不到的商机不等于没了。
 * 列附件时顺手跑，一小时最多一次；出错不往外抛
 */
export async function 清孤儿(db: PrismaClient, 目录 = 附件目录(), 现在 = Date.now(), 强制 = false): Promise<{ 删行: number; 删文件: number }> {
  const 结果 = { 删行: 0, 删文件: 0 };
  if (!强制 && g.__附件清理 && 现在 - g.__附件清理 < 3600 * 1000) return 结果;
  g.__附件清理 = 现在;
  try {
    const 行们 = await db.attachment.findMany({ select: { id: true, opportunityId: true, leadId: true, contactId: true, projectId: true } });
    const 商机在 = new Set((await db.opportunity.findMany({ where: { id: { in: [...new Set(行们.flatMap((r) => (r.opportunityId ? [r.opportunityId] : [])))] } }, select: { id: true } })).map((x) => x.id));
    // 企业版联系人附件：线索、联系人。两列都有（线索转过客户）的，任一条在就留
    const 线索在 = new Set((await db.lead.findMany({ where: { id: { in: [...new Set(行们.flatMap((r) => (r.leadId ? [r.leadId] : [])))] } }, select: { id: true } })).map((x) => x.id));
    const 联系人在 = new Set((await db.contact.findMany({ where: { id: { in: [...new Set(行们.flatMap((r) => (r.contactId ? [r.contactId] : [])))] } }, select: { id: true } })).map((x) => x.id));
    // 企业版项目附件（P11）：项目还在就留
    const 项目在 = new Set((await db.project.findMany({ where: { id: { in: [...new Set(行们.flatMap((r) => (r.projectId ? [r.projectId] : [])))] } }, select: { id: true } })).map((x) => x.id));
    const 记录文件 = path.join(目录, ".orphans.json");
    let 记: Record<string, number> = {};
    try { 记 = JSON.parse(fs.readFileSync(记录文件, "utf8")); } catch { /* 没有 / 坏了就从头记 */ }
    const 新记: Record<string, number> = {};
    for (const r of 行们) {
      const 在 = (!!r.opportunityId && 商机在.has(r.opportunityId))
        || (!!r.leadId && 线索在.has(r.leadId)) || (!!r.contactId && 联系人在.has(r.contactId))
        || (!!r.projectId && 项目在.has(r.projectId));
      if (在) continue;
      const 首次 = typeof 记[r.id] === "number" ? 记[r.id] : 现在;
      if (现在 - 首次 >= 一天) {
        await 删附件(db, r.id, 目录);
        结果.删行++;
      } else 新记[r.id] = 首次;
    }
    if (fs.existsSync(目录)) {
      if (Object.keys(新记).length || fs.existsSync(记录文件)) fs.writeFileSync(记录文件, JSON.stringify(新记));
      const 有行 = new Set(行们.map((r) => r.id));
      for (const f of fs.readdirSync(目录)) {
        const 临时 = f.startsWith(".tmp-");
        if (!临时 && (!是附件编号(f) || 有行.has(f))) continue;
        const p = path.join(目录, f);
        try {
          if (现在 - fs.statSync(p).mtimeMs > 十分钟) { fs.rmSync(p, { force: true }); 结果.删文件++; }
        } catch { /* 刚被删 */ }
      }
    }
  } catch (e) {
    console.warn("[附件] 清孤儿没跑完", e);
  }
  return 结果;
}
