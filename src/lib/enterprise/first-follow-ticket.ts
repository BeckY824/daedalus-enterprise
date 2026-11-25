/**
 * 建档时首条沟通的截图 / 附件（11-18，22D）：上传发生在创建这一步、由录入人提交。
 *
 * 为什么要一张票：建档时常指定给别人 / 自动分配 / 进公海，建好那一刻录入人就管不了这个项目了，
 * 按沟通附件的原规矩（api/attachments/access.ts 认沟通：负责人能传，组员只能看）他传不上。原规矩不放宽——
 * 建档的那个请求（建档向导 / 客户页新增项目，交了 要传附件）当场签一张票给录入人，只认「这位录入人 + 这条首条沟通」，15 分钟有效；
 * 浏览器拿着它把建档弹窗里挑好的文件一个个传上去。大小、类型、条数照原来的附件规矩，过了时间、换了人、换了沟通都不认（退回原规矩）。
 *
 * 票走请求头（首条附件票头，lib/attachment-rules.ts），不进网址（请求日志里留不下）。
 * 票上不放 sub：会话票（lib/auth.ts）认 sub，这张票拿去当会话票认不出是谁
 */
import { SignJWT, jwtVerify } from "jose";
import { readSecret } from "@/lib/secret";
import { defaultClient } from "@/lib/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { getBusiness } from "@/lib/business";

/** 票有效多久（分钟）：建好之后浏览器马上接着传，够了；慢网传大录音也来得及 */
export const 首条附件票分钟 = 15;
const 票类 = "first-follow-att";
const 钥 = () => new TextEncoder().encode(readSecret());

/** 建档的那个请求里签：谁录的、首条沟通是哪条 */
export async function 签首条附件票(userId: string, followUpId: string): Promise<string> {
  return new SignJWT({ typ: 票类, fb: userId, ff: followUpId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${首条附件票分钟}m`)
    .sign(钥());
}

/** 签名对、没过期、类型对、签给的是这位 + 这条沟通 */
export async function 验首条附件票(票: string | null | undefined, userId: string, followUpId: string): Promise<boolean> {
  if (!票 || !userId || !followUpId) return false;
  try {
    const { payload } = await jwtVerify(票, 钥());
    return payload.typ === 票类 && payload.fb === userId && payload.ff === followUpId && payload.sub === undefined;
  } catch {
    return false;
  }
}

/**
 * 上传接口用：票认得、沟通还在、是这位录入人记的、挂在项目上（看附件走 认沟通，要挂项目）→ 给日志用的叫法；否则 null（调用方照原规矩认）
 */
export async function 凭票认首条沟通(票: string | null | undefined, userId: string, followUpId: string): Promise<{ 叫法: string } | null> {
  if (!票 || !企业版() || (await getBusiness()).projectMode !== true) return null;
  if (!(await 验首条附件票(票, userId, followUpId))) return null;
  // 建好就分走了，录入人可能已经看不到这条沟通、这个项目：不经限定层取，自己核「是他记的」
  const f = await defaultClient.followUp.findFirst({ where: { id: followUpId, ownerId: userId, deletedAt: null }, select: { id: true } });
  if (!f) return null;
  const 挂 = await defaultClient.followUpProject.findFirst({ where: { followUpId }, select: { project: { select: { name: true } } } });
  if (!挂) return null;
  // 查重领取只领旧项目那条路记的不是首条：统一叫「沟通记录」（日志里说准）
  return { 叫法: `项目「${挂.project?.name ?? "—"}」的沟通记录` };
}
