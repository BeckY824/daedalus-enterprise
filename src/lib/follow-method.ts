/**
 * 企业版跟进记录的沟通方式（2026-10-31）。纯函数，客户端表单和服务端都 import。
 *
 * 企业版选的是企业字典 followMethod 里的选项名（19 种，存 FollowUp.method）；type 照旧存，
 * 按方式对出来——首页、统计、提醒、颜色图标还认 type。对不上的（其他方式、Telegram、人自己加的……）记 OTHER。
 * 方式按名字对：人在设置里把「手机通话」改了名，改名后选它记 OTHER——只影响颜色和按类型统计，显示的名字照旧对。
 * 个人版、团队版不填 method，只有 type。
 */
import { FOLLOW_TYPE_MAP } from "./constants";

const 对类型: Record<string, string> = {
  手机通话: "PHONE",
  线上会议: "MEETING",
  线下拜访: "VISIT",
  客户来访: "VISIT",
  邮件沟通: "EMAIL",
  手机短信: "SMS",
  WhatsApp: "WHATSAPP",
  微信沟通: "WECHAT",
};

const 对方式: Record<string, string> = {
  PHONE: "手机通话",
  MEETING: "线上会议",
  VISIT: "线下拜访",
  EMAIL: "邮件沟通",
  SMS: "手机短信",
  WHATSAPP: "WhatsApp",
  WECHAT: "微信沟通",
  OTHER: "其他方式",
};

/** 选的方式对哪个 type */
export function 方式对类型(方式: string): string {
  return 对类型[方式] ?? "OTHER";
}

/** 没选方式的老记录按 type 补一个；任务、提醒不是沟通，没有方式 */
export function 类型对方式(type: string): string | null {
  return 对方式[type] ?? null;
}

/** 列表、时间线上显示的叫法：企业版有方式显示方式，没有（个人版、团队版、任务提醒）显示类型名 */
export function 跟进方式名(f: { type: string; method?: string | null }): string {
  return f.method || FOLLOW_TYPE_MAP[f.type]?.label || f.type;
}

/** 表单上的方式还对得上类型才交（AI 解析、默认 WhatsApp 这些只改了类型）；对不上交 undefined，服务端按类型补 */
export function 对得上的方式(type: string | undefined, method: string | null | undefined): string | undefined {
  return method && type && 方式对类型(method) === type ? method : undefined;
}
