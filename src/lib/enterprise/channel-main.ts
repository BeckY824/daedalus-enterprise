/**
 * 企业版主渠道读写（2026-11-08）。规矩见 channel-main-core.ts。
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { 拆主子, 历史渠道分类, 是历史渠道, 历史渠道报错, 主渠道入口前缀, 是主渠道入口, type 主渠道行 } from "@/lib/enterprise/channel-main-core";
import { 负责人候选, 唯一负责人 } from "@/lib/owners";
import { recordAudit } from "@/lib/audit";

type 库 = Prisma.TransactionClient | typeof prisma;

const 选列 = { id: true, name: true, allowSub: true, selfDev: true, category: true, active: true, sort: true, ownerId: true, attr: true } as const;

/** 全部主渠道（含停用），按排序、名字；负责人名字一并带出（ownerId 不建外键，另查一趟，停用的人名字照给） */
export async function 读主渠道们(db: 库 = prisma): Promise<主渠道行[]> {
  const 们 = await db.entChannelMain.findMany({ select: 选列, orderBy: [{ sort: "asc" }, { name: "asc" }] });
  const ids = [...new Set(们.map((m) => m.ownerId).filter((x): x is string => Boolean(x)))];
  const 人 = new Map((ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
  return 们.map((m) => ({ ...m, ownerName: m.ownerId ? 人.get(m.ownerId) ?? null : null }));
}

/** 按名字找主渠道，没有就建一个（默认可设子渠道、不支持自拓），排在最后 */
export async function 找或建主渠道(name: string, db: 库 = prisma): Promise<主渠道行> {
  const n = name.trim();
  const 有 = await db.entChannelMain.findUnique({ where: { name: n }, select: 选列 });
  if (有) return 有;
  const 最后 = await db.entChannelMain.aggregate({ _max: { sort: true } });
  return db.entChannelMain.upsert({
    where: { name: n },
    create: { name: n, sort: (最后._max.sort ?? 0) + 1 },
    update: {},
    select: 选列,
  });
}

/**
 * 没挂主渠道的渠道补挂（渠道页每次打开时跑；可重复跑，挂好了就 0 条）：
 * 主渠道名 = 渠道名称（platform），没有就按全称第一个「|」/「｜」前那段，再没有就整个全称。
 * platform 空着的顺手补上主渠道名。客户、项目都挂在 Channel 上，不动
 */
export async function 补主渠道(db: 库 = prisma): Promise<number> {
  const 没挂 = await db.channel.findMany({ where: { mainId: null }, select: { id: true, name: true, platform: true } });
  for (const c of 没挂) {
    const 主名 = c.platform?.trim() || 拆主子(c.name).主 || c.name;
    const 主 = await 找或建主渠道(主名, db);
    await db.channel.update({ where: { id: c.id }, data: { mainId: 主.id, ...(c.platform?.trim() ? {} : { platform: 主.name }) } });
  }
  return 没挂.length;
}

/**
 * 新数据能不能选这个渠道（P-渠道-06，11-10）：不存在 / 停用的不行；挂在「历史渠道」组主渠道下的也不行（只承载历史客户）。
 * 能选给 null，不能选给报错。停用那句由调用处给（各处原来的话不一样），这里只回「停用」两个字让它认
 */
export async function 新数据渠道不行(id: string, db: 库 = prisma): Promise<"停用" | string | null> {
  const c = await db.channel.findUnique({ where: { id }, select: { name: true, active: true, main: { select: { category: true } } } });
  if (!c?.active) return "停用";
  return 是历史渠道(c.main?.category) ? 历史渠道报错(c.name) : null;
}

/** 列表查询里「不是历史渠道」的条件：没挂主渠道的、主渠道分类不是「历史渠道」的（分类空也算在售） */
export const 在售渠道条件 = {
  OR: [{ mainId: null }, { main: { is: { OR: [{ category: null }, { category: { not: 历史渠道分类 } }] } } }],
} satisfies Prisma.ChannelWhereInput;

/**
 * 来源选择里能列的渠道（P-渠道-13）：自己启用、不是历史渠道、主渠道也启用（主渠道停用，下面的子渠道一起不列；没挂主渠道的照列）。
 * 只管选择器的候选；导入按名字认渠道、老客户已挂着的不受影响
 */
export const 可选渠道条件 = {
  active: true,
  AND: [在售渠道条件, { OR: [{ mainId: null }, { main: { is: { active: true } } }] }],
} satisfies Prisma.ChannelWhereInput;

/** 来源选择里的一行（components/ChannelPicker.tsx 的 可选渠道 同一个形状；这里不从客户端组件 import） */
export type 来源选项 = { id: string; name: string; attr: string | null; platform: string | null; active: boolean };

/** 来源选择的清单要读的列：自己的几格 + 主渠道的属性（给 带主属性 用） */
export const 来源选项列 = { id: true, name: true, attr: true, platform: true, active: true, main: { select: { attr: true } } } as const;

/**
 * 来源选择器的属性沿用（迁移 118，P-渠道-11）：子渠道自己没填属性的，清单里带主渠道的（和渠道页 沿用主渠道属性 一个口径）。
 * 只是读的时候带出来，不回写库；自己填了的不动，主渠道也没填、没挂主渠道的还是原样
 */
export function 带主属性(行们: readonly (来源选项 & { main: { attr: string | null } | null })[]): 来源选项[] {
  return 行们.map(({ main, ...c }) => (c.attr?.trim() ? c : { ...c, attr: main?.attr?.trim() || c.attr }));
}

/**
 * 只有主渠道的那些，给来源选择摆的占位行（见 channel-main-core.ts 主渠道入口前缀）：
 * 主渠道启用、不是「历史渠道」组（P-渠道-06）、底下一条渠道都没有（停用的也算有：停掉的单一入口不再冒出来）。
 * 属性带主渠道自己的；按排序、名字排
 */
export async function 主渠道入口们(db: 库 = prisma): Promise<来源选项[]> {
  const 们 = await db.entChannelMain.findMany({
    where: { active: true, OR: [{ category: null }, { category: { not: 历史渠道分类 } }], channels: { none: {} } },
    select: { id: true, name: true, attr: true },
    orderBy: [{ sort: "asc" }, { name: "asc" }],
  });
  // 还没补挂主渠道的老渠道（mainId 空）名字正好等于主渠道名的：那条就是它的入口，不再摆占位
  const 撞名 = new Set((们.length ? await db.channel.findMany({ where: { name: { in: 们.map((m) => m.name) } }, select: { name: true } }) : []).map((c) => c.name));
  return 们.filter((m) => !撞名.has(m.name)).map((m) => ({ id: 主渠道入口前缀 + m.id, name: m.name, attr: m.attr?.trim() || null, platform: m.name, active: true }));
}

/** 这个主渠道的入口建出来挂谁：主渠道自己的负责人（还能当负责人的），否则全公司唯一能当负责人的那位；都没有 = null，建不了 */
async function 入口负责人(ownerId: string | null): Promise<string | null> {
  return (ownerId && (await 负责人候选()).some((u) => u.id === ownerId) ? ownerId : null) ?? (await 唯一负责人());
}

/**
 * 导入按名字认来源用：只有主渠道的那些里，现在就落得成渠道的（定得出负责人的）。名字 → 占位 id。
 * 落不成的不给：导入预览里照「库里没有这个渠道」留空、原文并进备注，不会预览说认得、落库时悄悄丢
 */
export async function 能落的主渠道入口(db: 库 = prisma): Promise<Map<string, string>> {
  const 们 = await 主渠道入口们(db);
  if (!们.length) return new Map();
  const 主们 = await db.entChannelMain.findMany({ where: { id: { in: 们.map((m) => m.id.slice(主渠道入口前缀.length)) } }, select: { id: true, ownerId: true } });
  const 负责人 = new Map(主们.map((m) => [m.id, m.ownerId]));
  const 出 = new Map<string, string>();
  for (const m of 们) if (await 入口负责人(负责人.get(m.id.slice(主渠道入口前缀.length)) ?? null)) 出.set(m.name, m.id);
  return 出;
}

/**
 * 交来的来源 id 落成真的渠道 id：普通渠道 id 原样回；「main:主渠道 id」占位的，在那个主渠道下找 / 建子渠道名留空的那条（全称 = 主渠道名）。
 * - 同一个主渠道只会有一条：Channel.name 唯一，两个人同时选，后到的撞唯一约束，回头读先到的那条
 * - 负责人、属性沿用主渠道的（迁移 118，同 saveChannel 新建子渠道）；主渠道没指定负责人、或那人已不能当负责人，
 *   退到「全公司只有一个能当负责人的」，再没有就报错让渠道管理员先指定——渠道负责人会带到客户身上，不拿录入的人顶
 * - 主渠道停用、成了历史渠道、或者期间已经加了子渠道：报错，让人刷新重选
 * 不看「能管渠道」：这不是建一个新来源，只是把主渠道表里已有的来源落成能挂客户的那一行。
 * 在事务外面调（留痕走全局连接）：存客户 / 项目后面哪步没过，这条留着也没事，它本来就该有
 */
export async function 落到渠道(
  id: string | null | undefined,
  操作人: { id: string; name?: string | null },
  db: 库 = prisma,
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  if (!id) return { ok: true, id: null };
  if (!是主渠道入口(id)) return { ok: true, id };
  const m = await db.entChannelMain.findUnique({ where: { id: id.slice(主渠道入口前缀.length) }, select: { id: true, name: true, active: true, category: true, ownerId: true, attr: true } });
  if (!m || !m.active) return { ok: false, error: "这个渠道不存在或已停用，换一个" };
  if (是历史渠道(m.category)) return { ok: false, error: 历史渠道报错(m.name) };
  const 读 = () => db.channel.findUnique({ where: { name: m.name }, select: { id: true, active: true } });
  const 用 = (c: { id: string; active: boolean }) => (c.active ? { ok: true as const, id: c.id } : { ok: false as const, error: "这个渠道不存在或已停用，换一个" });
  const 有 = await 读();
  if (有) return 用(有);
  // 「已经有子渠道」不算入口自己（全称 = 主渠道名的那条）：两个人同时选时，后到的在这里看到的是先到的刚建好的入口，
  // 不能当成「有子渠道了」报错，让它往下走建，撞唯一约束后回头读先到的那条
  if (await db.channel.count({ where: { mainId: m.id, name: { not: m.name } } })) return { ok: false, error: `主渠道「${m.name}」下已经有子渠道了，请刷新后选具体的子渠道` };
  const 负责人 = await 入口负责人(m.ownerId);
  if (!负责人) return { ok: false, error: `主渠道「${m.name}」还没指定负责人（或负责人已停用），请渠道管理员先在渠道页给它指定负责人` };
  try {
    const c = await db.channel.create({
      data: { name: m.name, platform: m.name, mainId: m.id, channelOwnerId: 负责人, attr: m.attr?.trim() || null, createdById: 操作人.id },
      select: { id: true },
    });
    const 名 = 操作人.name ?? (await db.user.findUnique({ where: { id: 操作人.id }, select: { name: true } }))?.name ?? "";
    await recordAudit({
      user: { id: 操作人.id, name: 名 }, action: "create", entity: "Channel", entityId: c.id,
      summary: `选来源时自动建渠道「${m.name}」（主渠道下没有子渠道，子渠道名留空）`,
    });
    return { ok: true, id: c.id };
  } catch (e) {
    // 别人刚好先建了（Channel.name 唯一）：用他那条
    const 先到 = (e as { code?: string })?.code === "P2002" ? await 读() : null;
    if (先到) return 用(先到);
    throw e;
  }
}
