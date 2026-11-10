/**
 * 企业版主渠道读写（2026-11-08）。规矩见 channel-main-core.ts。
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { 拆主子, 历史渠道分类, 是历史渠道, 历史渠道报错, type 主渠道行 } from "@/lib/enterprise/channel-main-core";

type 库 = Prisma.TransactionClient | typeof prisma;

const 选列 = { id: true, name: true, allowSub: true, selfDev: true, category: true, active: true, sort: true } as const;

/** 全部主渠道（含停用），按排序、名字 */
export async function 读主渠道们(db: 库 = prisma): Promise<主渠道行[]> {
  return db.entChannelMain.findMany({ select: 选列, orderBy: [{ sort: "asc" }, { name: "asc" }] });
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
