"use server";

/**
 * 教练主题的动作（11-17，销售教练角色 PR2）：发起、回复、关闭、系统管理员软删。
 * 判定、落库、通知都在 lib/enterprise/coach-topic-db.ts（判定在 coach-topic.ts），这里只认人、兜错。
 * 填写人 = 当前登录的人（Q5）：发起只收标题和内容，传来的别的字段（authorId 之类）一概不认。
 */
import { requireUser } from "@/lib/auth";
import { 不在了 } from "@/lib/not-there";
import { 发主题, 回复主题, 关闭主题, 删主题 } from "@/lib/enterprise/coach-topic-db";

type 结果 = { ok: true } | { ok: false; error: string };

export async function 发主题动作(projectId: string, 输入: { title?: unknown; body?: unknown }): Promise<结果> {
  try {
    const me = await requireUser();
    // 只取这两格：填写人不从前端来
    const r = await 发主题(me, projectId, { title: 输入?.title, body: 输入?.body });
    return r.ok ? { ok: true } : r;
  } catch (e) {
    return 不在了(e);
  }
}

export async function 回复主题动作(topicId: string, body: unknown): Promise<结果> {
  try {
    const r = await 回复主题(await requireUser(), topicId, body);
    return r.ok ? { ok: true } : r;
  } catch (e) {
    return 不在了(e);
  }
}

export async function 关闭主题动作(topicId: string): Promise<结果> {
  try {
    return await 关闭主题(await requireUser(), topicId);
  } catch (e) {
    return 不在了(e);
  }
}

export async function 删主题动作(topicId: string): Promise<结果> {
  try {
    return await 删主题(await requireUser(), topicId);
  } catch (e) {
    return 不在了(e);
  }
}
