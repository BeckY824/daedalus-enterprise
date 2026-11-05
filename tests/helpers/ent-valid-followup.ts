/**
 * 企业版三大阶段测试共用：给项目记一条沟通（直接写库，跳过记沟通的校验），并让项目满足「有效沟通」。
 * 11-05 起有效沟通 = 「线索验证」节点配的必填项都齐（没配看需求状态选了没有），不再看沟通勾没勾「客户明确回复了」；
 * replied=true 时顺手把需求状态选成「明确需求」，线索阶段就能越过「线索验证」往前推（lib/project/stage-gates.ts 企业版推进关）。
 */
import { prisma } from "@/lib/prisma";

export async function 记有效沟通(projectId: string, replied = true, phase = "线索"): Promise<string> {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { customerId: true, ownerId: true, node: true } });
  const f = await prisma.followUp.create({ data: { type: "PHONE", title: "沟通", content: "聊了", customerId: p.customerId, ownerId: p.ownerId } });
  await prisma.followUpProject.create({ data: { followUpId: f.id, projectId, node: p.node } });
  await prisma.entFollowUpMark.create({ data: { followUpId: f.id, projectId, phase, replied } });
  if (replied) await prisma.project.update({ where: { id: projectId }, data: { demandStatus: "明确需求" } });
  return f.id;
}
