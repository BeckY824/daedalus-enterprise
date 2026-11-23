/**
 * 企业版录音点评 · 录音的判定（11-22，录音点评 PR2：录音存储与上传）。纯函数，不碰数据库、不碰磁盘。
 * 读写库在 coach-rec-db.ts，文件在 coach-rec-store.ts，接口在 app/api/coach-rec/**，都只认这里。
 *
 * 权限不新增规则，只沿用教练主题（方案-https与录音点评 §5 PR2、教练点评改版 §6）：
 *   - 开始、每传一片、传完：对这个项目 能发主题（coach-topic.ts，P-教练-11/12/13：教练、系统管理员、条线总管理、实线 / 虚线上级；
 *     负责人本人、只读管理员、组员、市场成员不能；公海、回收站里的项目不能）——三处服务端都判，开始以后丢了权限的下一片就拒
 *   - 看进度、放弃、看草稿：只有录的那个人
 *   - 听原声：发起人 + 项目负责人（负责人要等发出以后；草稿只有录的人能听），都得先看得到项目；只读管理员不能听
 *   - 切换视图时一律拒（路由里 视图拒绝响应，写盘不过 Prisma）
 * 录音和转写不进 AI 助手、导出、全局搜索（P-教练-15，同主题）。
 * 号码打码（§9 第 3 件）：给销售教练看的文件名过 notice-mask.ts 的 文件名打码——PR2 只有原文件名（安卓通话录音的文件名常带对方号码，和日期拼成一长串）。
 */
import { 能发主题, type 主题项目 } from "./coach-topic";
import { 能看项目, 是教练, type 谁 } from "./permissions";
import { 文件名打码, 通知文字打码 } from "./notice-mask";
import { 认格式 } from "@/lib/mic-test-echo";
import type { 组织 } from "./org-core";

/** 一片最多 5MB：低于 proxy 缓冲的 10MB 截断线，手机网络上一片也不容易超时 */
export const 片上限字节 = 5 * 1024 * 1024;
/** 传文件单个最多 200MB（腾讯云 URL 方式 1GB / 5 小时，有余量） */
export const 文件上限字节 = 200 * 1024 * 1024;
/** 单个最长 2 小时：时长 PR4 用 ffprobe 算了才判（不信客户端），这里只给界面写提示 */
export const 时长上限毫秒 = 2 * 60 * 60 * 1000;
/**
 * 一段最多几片：传文件 5MB 一片最多 40 片；按住说话、点按录音边录边传 15 秒一片（PR3），点按录音一段最长 2 小时 = 480 片，留到 600。
 * 总字节照样不超过 文件上限字节（收一片时判）
 */
export const 每段片数上限 = 600;
/** 网页录边录边传：每片多少毫秒（MediaRecorder timeslice） */
export const 录音每片毫秒 = 15_000;
/** 按住说话一条最长（几段合计）10 分钟；点按录音一条最长 2 小时（11-22 Even 线下陪练要长录音） */
export const 按住上限毫秒 = 10 * 60 * 1000;
export const 点按上限毫秒 = 时长上限毫秒;
/** 不到 1 秒的不要 */
export const 最短录音毫秒 = 1_000;
/** 录着被打断的原因（前端认出来报上来，只收这几种；给人看「录音在 0:42 被打断（来电或话筒被占用），已录部分已保存」） */
export const 打断原因们 = ["锁屏或切到后台", "来电或话筒被占用", "录音出错"] as const;
export type 打断原因 = (typeof 打断原因们)[number];
export type 打断 = { 段: number; 秒: number; 原因: 打断原因 };
/** 传完时带上来的打断：原因在名单里、秒数 0–2 小时；不对的当没有 */
export function 认打断(x: unknown): { 秒: number; 原因: 打断原因 } | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (!(打断原因们 as readonly unknown[]).includes(o.原因)) return null;
  const 秒 = Number(o.秒);
  if (!Number.isFinite(秒) || 秒 < 0 || 秒 > 时长上限毫秒 / 1000) return null;
  return { 秒: Math.round(秒), 原因: o.原因 as 打断原因 };
}
export function 读打断们(x: string | null | undefined): 打断[] {
  if (!x) return [];
  try {
    const v = JSON.parse(x) as unknown;
    return Array.isArray(v) ? v.filter((t): t is 打断 => !!t && typeof t === "object" && Number.isInteger((t as 打断).段) && (t as 打断).段 >= 1 && !!认打断(t)) : [];
  } catch {
    return [];
  }
}
/** 一条最多几段（录音被打断后接着录的；传文件固定 1 段） */
export const 段数上限 = 20;
/** 每个进程同时最多收几片（每片边收边写盘，不整片放内存）；满了 429，浏览器隔几秒自己重试 */
export const 进程并发片数 = 4;
/** 每人同时最多收几片（浏览器按顺序一片一片传，正常只有 1 片在路上；多开窗口、脚本连发的挡在这里）；满了 429 */
export const 每人并发片数 = 2;
/** 收一片时多久没来新字节就算断了（慢网也不会 60 秒一个字节都不来）：停、删临时文件、回 408（浏览器按断网重试） */
export const 片读超时毫秒 = 60 * 1000;
/** 收一片从开始到收完最多多久（PR4 修 PR2 审查遗留）：只有空闲超时的话，每 59 秒滴一个字节能把一个收片名额占很久；
 *  5MB 在 2G 网（约 20KB/秒）上也就四分多钟，到点没收完一样停、删临时文件、回 408（浏览器按断网重试） */
export const 片总时长毫秒 = 5 * 60 * 1000;
/** 传完时在库里占位（endedAt 记上占位时刻）：这么久还没拼完的当占位的进程已经死了，别的请求可以接手 */
export const 拼合占位毫秒 = 10 * 60 * 1000;
/** 每人同时最多几条没传完的（上传中）：防一个人开一堆空的占盘 */
export const 每人未完成上限 = 5;
/** 大于这个提示「建议连 Wi-Fi」 */
export const 建议WiFi字节 = 20 * 1024 * 1024;

export const 录音状态 = ["上传中", "待提交", "转写中", "整理中", "待确认", "已发出", "已放弃", "整理失败"] as const;
export type 录音状态 = (typeof 录音状态)[number];
/** 草稿：录的人自己看得到、能放弃的 */
export const 草稿状态: readonly 录音状态[] = ["上传中", "待提交", "待确认", "整理失败"];
/** 能「再按住补一段」的：录的（不是传的文件）、待提交、段数没到上限（时长上限前端按 按住上限毫秒 / 点按上限毫秒 管，服务端 PR4 规整时按 2 小时判） */
export const 能补段 = (r: { status: string; sourceKind: string; segCount: number; deletedAt?: Date | null }) =>
  !r.deletedAt && r.status === "待提交" && r.sourceKind !== "上传" && r.segCount < 段数上限;
/** 正在转写、整理：放弃要等它跑完 */
const 处理中状态: readonly 录音状态[] = ["转写中", "整理中"];

/* ── PR6 清理（coach-rec-housekeep.ts 每小时一轮） ── */
const 天毫秒 = 24 * 60 * 60 * 1000;
/** 没发出的草稿（上传中 / 待提交 / 待确认 / 整理失败）放满几天自动删；前一天提醒 */
export const 草稿保留天 = 7;
export const 草稿提醒天 = 6;
/** 音频放几天（从录的那天算）：到期删音频文件，转写、主题要点留着 */
export const 音频保留天 = 180;
/**
 * 草稿从哪一刻算：上传中看最后一次动（updatedAt：开始、接着录、传第一段的片都会改）；
 * 别的看进这个状态的时刻（endedAt：传完、丢段退回待提交、整理好了、整理失败时记）
 */
export function 草稿起点(r: { status: string; endedAt: Date | null; updatedAt: Date }): Date {
  return r.status === "上传中" ? r.updatedAt : r.endedAt ?? r.updatedAt;
}
export const 草稿到期 = (r: { status: string; endedAt: Date | null; updatedAt: Date }): Date => new Date(草稿起点(r).getTime() + 草稿保留天 * 天毫秒);
export const 草稿该提醒 = (r: { status: string; endedAt: Date | null; updatedAt: Date }, 现在: number): boolean => 现在 - 草稿起点(r).getTime() >= 草稿提醒天 * 天毫秒;
export const 草稿该删 = (r: { status: string; endedAt: Date | null; updatedAt: Date }, 现在: number): boolean => 现在 - 草稿起点(r).getTime() >= 草稿保留天 * 天毫秒;
export const 音频该删 = (r: { createdAt: Date }, 现在: number): boolean => 现在 - r.createdAt.getTime() >= 音频保留天 * 天毫秒;
/** 系统自动删的（到期、项目进公海 / 回收站、成员停用）：error 带这个头，清理一轮删完文件按它给录的人发通知 */
export const 自动删头 = "【自动删除】";
export const 自动删话 = {
  到期: `没发出的草稿放满 ${草稿保留天} 天，已自动删除`,
  项目没了: "项目进了公海或被删除，没发出的录音已自动删除",
  停用: "成员停用，没发出的录音已自动删除",
} as const;
/** 容量闸：录音目录超过 5GB 或者磁盘剩不到 3GB 就不让开始新的录音 / 传文件；磁盘剩不到 1GB 连正在传的片也不收 */
export const 录音目录上限字节 = 5 * 1024 ** 3;
export const 磁盘至少剩字节 = 3 * 1024 ** 3;
export const 收片磁盘至少剩字节 = 1024 ** 3;
export const 存储满了话 = "录音存储空间不够了，暂时不能录新的，请联系系统管理员";
/** 每月转写超过这么多秒，提醒系统管理员（防密钥被刷） */
export const 每月转写提醒秒 = 200 * 60 * 60;

export const 录音来源 = ["上传", "网页录", "飞书原生录"] as const;
export type 录音来源 = (typeof 录音来源)[number];

/** 传文件收的格式（方案 §4.3）：扩展名给 accept 用；服务端只认文件头（认得出的才收），不信扩展名和浏览器报的类型 */
export const 收的扩展名 = ["m4a", "mp3", "wav", "aac", "amr", "ogg", "flac", "mp4", "3gp", "webm"] as const;
export const 收的类型 = ["audio/mp4", "audio/x-m4a", "audio/m4a", "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/aac", "audio/x-aac", "audio/amr", "audio/ogg", "audio/flac", "audio/x-flac", "audio/webm", "audio/3gpp", "video/mp4", "video/3gpp", "video/webm"] as const;
/** <input accept>：类型和扩展名都写（手机浏览器对 m4a、amr 给的类型常是空的，attachment-rules.ts 同样的做法） */
export const 选文件accept = [...收的类型, ...收的扩展名.map((x) => `.${x}`)].join(",");

export type 录音格式 = "m4a" | "mp4" | "3gp" | "wav" | "webm" | "ogg" | "mp3" | "aac" | "amr" | "flac";
/** 文件头 → 格式；认不出（或是 caf 这类腾讯云不收、ffmpeg 规整也不打算收的）= null */
export function 认录音格式(头: Uint8Array): 录音格式 | null {
  const 字 = (from: number, to: number) => String.fromCharCode(...头.subarray(from, to));
  if (头.length >= 4 && 字(0, 4) === "fLaC") return "flac";
  if (头.length >= 12 && 字(4, 8) === "ftyp" && 字(8, 11) === "3gp") return "3gp";
  const f = 认格式(头);
  return f === "未知" || f === "caf" ? null : f;
}
/** 回放时给浏览器的类型（按认出的格式，不按客户端报的） */
export const 格式类型: Record<录音格式, string> = {
  m4a: "audio/mp4", mp4: "audio/mp4", "3gp": "audio/3gpp", wav: "audio/wav", webm: "audio/webm", ogg: "audio/ogg", mp3: "audio/mpeg", aac: "audio/aac", amr: "audio/amr", flac: "audio/flac",
};
export const 是录音格式 = (x: unknown): x is 录音格式 => typeof x === "string" && Object.hasOwn(格式类型, x);

/** 录音编号（cuid）：只有这样的才拿去拼路径 */
export const 是录音编号 = (x: unknown): x is string => typeof x === "string" && /^[a-z0-9]{20,32}$/.test(x);
/** 段号 1..段数上限、片号 0..每段片数上限-1，都只收纯数字 */
export function 读段片(seg: unknown, seq: unknown): { 段: number; 片: number } | null {
  if (typeof seg !== "string" || typeof seq !== "string" || !/^\d{1,3}$/.test(seg) || !/^\d{1,4}$/.test(seq)) return null;
  const 段 = Number(seg);
  const 片 = Number(seq);
  if (段 < 1 || 段 > 段数上限 || 片 < 0 || 片 >= 每段片数上限) return null;
  return { 段, 片 };
}

export type 录音行 = { authorId: string; status: string; projectId: string; deletedAt?: Date | null; audioPurgedAt?: Date | null };

/** 能不能在这个项目上开始录 / 传：就是 能发主题（不新增规则） */
export function 能开始录音(me: 谁, p: 主题项目, org: 组织 | null): boolean {
  return 能发主题(me, p, org);
}
export function 不能开始话(me: 谁, p: 主题项目, org: 组织 | null): string | null {
  if (能开始录音(me, p, org)) return null;
  if (p.pooledAt) return "公海里的项目没有负责人，不能发起录音点评";
  if (p.deletedAt) return "项目在回收站里，不能发起录音点评";
  if (p.ownerId === me.id) return "这是你负责的项目：点评由教练、上级发起，你在主题下回复";
  return "你不能对这个项目发起录音点评";
}

/** 传片、传完：录的人本人、还在上传中、而且现在仍能对这个项目发（开始以后被停了角色、项目进了公海的，下一片就拒） */
export function 能传片(me: 谁, r: 录音行, p: 主题项目, org: 组织 | null): boolean {
  return !r.deletedAt && r.authorId === me.id && r.status === "上传中" && 能开始录音(me, p, org);
}
export function 不能传片话(me: 谁, r: 录音行, p: 主题项目, org: 组织 | null): string | null {
  if (能传片(me, r, p, org)) return null;
  if (r.deletedAt || r.status === "已放弃") return "这条录音已经放弃了";
  if (r.authorId !== me.id) return "只有录的人能接着传";
  if (r.status !== "上传中") return "这条录音已经传完了";
  return 不能开始话(me, p, org) ?? "你不能对这个项目发起录音点评";
}

/** 看进度、看草稿：只有录的人（第一版没有「替别人接着传」） */
export function 能看录音进度(me: 谁, r: 录音行): boolean {
  return !r.deletedAt && r.authorId === me.id;
}

/** 放弃：只有录的人；已发出的不能（那是主题了），正在转写 / 整理的等跑完 */
export function 能放弃录音(me: 谁, r: 录音行): boolean {
  if (r.deletedAt || r.authorId !== me.id) return false;
  return (草稿状态 as readonly string[]).includes(r.status);
}
export function 不能放弃话(me: 谁, r: 录音行): string | null {
  if (能放弃录音(me, r)) return null;
  if (r.deletedAt || r.status === "已放弃") return null; // 已经放弃了：当成功（两个窗口、连点）
  if (r.authorId !== me.id) return "只有录的人能删掉这条录音";
  if ((处理中状态 as readonly string[]).includes(r.status)) return "正在整理，等整理完再删";
  return "已经发出的录音点评不能删";
}

/**
 * 听原声（教练点评改版 §4.7【11-19 评估后改】）：录的人自己（草稿也能听）；项目负责人要等发出以后；都得先看得到项目。
 * 只读管理员、上级、组员都听不了（录音里可能有被点评的销售、客户的声音）；音频到期删了的谁都听不了。
 * 项目在公海 / 回收站（冻结）里：能听的照样能听（只读，同主题冻结了照样看得到）
 */
export function 能听原声(me: 谁, r: 录音行, p: 主题项目, org: 组织 | null): boolean {
  if (r.deletedAt || r.audioPurgedAt || !org || !能看项目(me, p, org)) return false;
  if (r.authorId === me.id) return r.status !== "已放弃";
  return r.status === "已发出" && p.ownerId === me.id;
}

/** 给这个人看的文件名：销售教练看到的号码打码（§9 第 3 件，录的人自己是教练也照打；文件名打码 连号码带日期的长串也认）；别的人原样 */
export function 给人看的文件名(name: string | null | undefined, me: 谁, org: 组织 | null): string | null {
  if (!name) return null;
  return org && 是教练(me, org) ? 文件名打码(name) : name;
}

/**
 * 给这个人看的转写、要点、确认框里的草稿（PR5，§9 第 3 件「转写给销售教练时电话号码打码」）：销售教练看到的号码打码（通知文字打码，
 * 日期、时间、金额不动；录的人自己是教练也照打）；别的人原样。库里存原文，只在出给教练时打；原声照旧能听
 */
export function 给人看的文字(s: string | null | undefined, me: 谁, org: 组织 | null): string | null {
  if (!s) return s ?? null;
  return org && 是教练(me, org) ? 通知文字打码(s) : s;
}

/** 原文件名规整：只留最后一段、去控制字符、最长 120 字（只是给人看的，不拿来拼路径） */
export function 规整文件名(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const 名 = x.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
  return 名 || null;
}

/** 开始时报的大小：传文件必填、1 字节到 200MB；录音不填 */
export function 开始输入问题(x: { sourceKind?: unknown; bytes?: unknown; fileName?: unknown }): string | null {
  if (!(录音来源 as readonly unknown[]).includes(x.sourceKind)) return "录音来源不对";
  if (x.sourceKind !== "上传") return null;
  const n = x.bytes;
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) return "文件大小不对";
  if (n > 文件上限字节) return `文件超过 ${文件上限字节 / 1024 / 1024}MB，传不了；可以用录音机 App 分成几段再传`;
  if (!规整文件名(x.fileName)) return "没有文件名";
  return null;
}

/**
 * 片们齐不齐：每段从 0 号起连着、没有空洞；传文件还要总字节对得上开始时报的。齐了回 null，否则回一句。
 * 已有段数（PR3「再按住补一段」）：前面已经拼好的段数，这回的片要从下一段起连着
 */
export function 片们问题(片们: readonly { 段: number; 片: number; 字节: number }[], 来源: string, 报的字节: number | null, 已有段数 = 0): string | null {
  if (!片们.length) return "还没传任何内容";
  const 按段 = new Map<number, number[]>();
  for (const x of 片们) 按段.set(x.段, [...(按段.get(x.段) ?? []), x.片]);
  const 段们 = [...按段.keys()].sort((a, b) => a - b);
  if (段们.some((s, i) => s !== 已有段数 + i + 1)) return "录音的段不连续，有一段没传上来";
  for (const s of 段们) {
    const 号 = 按段.get(s)!.sort((a, b) => a - b);
    if (号.some((q, i) => q !== i)) return "还有片没传上来";
  }
  if (来源 === "上传") {
    if (段们.length !== 1) return "传文件只有一段";
    const 总 = 片们.reduce((a, x) => a + x.字节, 0);
    if (报的字节 !== null && 总 !== 报的字节) return "还没传完";
  }
  return null;
}

/** 数据目录下按月分的子目录（按开始时刻的 UTC 年月，写进路径后不再变） */
export const 录音月份 = (at: Date): string => at.toISOString().slice(0, 7).replace("-", "");
