"use client";

/**
 * 设置 →「客户回收」（P-界面-19 ⑧，构想页 C16）：客户三态的总开关、三个天数（内贸、外贸各一套，M-公海-25）、有效沟通的占位词表。
 *
 * - 开关和天数存在组织规则的「三态」那一块，走现有的 改组织规则（谁能改同「各进程时限」：只有系统管理员，后台设置谁能改表）；
 *   打开是有后果的：当晚夜扫起开始计时、发提醒、到期自动收回，开关旁写明，打开时弹确认。默认关
 * - 占位词表走 三态存占位词（能改后台设置的人），整张换掉；服务端会去掉空白、标点、统一小写，存完按服务端回的显示
 * - 成交客户活跃段、继续持有、转让归零、冷项目这几块的数这里不摆（构想页只画了三个天数），照组织规则里存的 / 默认值
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Input, InputNumber, Space, Switch, Tag } from "antd";
import { 改组织规则 } from "@/app/(app)/projects/actions";
import { 三态存占位词 } from "@/app/(app)/customers/tri-state-actions";
import type { 三态规则, 三态天数 } from "@/lib/project/org-rules";

export type 客户回收设置 = {
  三态: 三态规则;
  /** 开关、天数这个人能不能改：null = 能改，否则是「只有……能改」那句 */
  挡: string | null;
  /** 占位词表；null = 这个人看不了（只有能改后台设置的人能看、能改，同 三态读占位词） */
  占位词: string[] | null;
};

/** 打开时说清后果（开关旁、确认框里同一句） */
const 打开后果 = "打开后，当晚起按客户计时：很久没有有效沟通的客户会进沉睡、待回收，系统给负责人和上级发提醒，待回收满期还没人处理的自动进客户公海。";

const 套们 = ["内贸", "外贸"] as const;
const 项们: { k: keyof 三态天数; 前: string; 后: string; 最小: number; 最大: number }[] = [
  { k: "沉睡", 前: "没有有效沟通满", 后: "天进沉睡", 最小: 1, 最大: 3650 },
  { k: "待回收", 前: "没有有效沟通满", 后: "天进待回收", 最小: 2, 最大: 3650 },
  { k: "进公海", 前: "进待回收后再满", 后: "天自动进客户公海", 最小: 21, 最大: 365 },
];

export default function RecycleTab({ value }: { value: 客户回收设置 }) {
  const router = useRouter();
  const { message, modal } = App.useApp();
  const [忙, set忙] = useState(false);
  const { 三态, 挡 } = value;
  const [天, set天] = useState<Record<(typeof 套们)[number], 三态天数>>({ 内贸: { ...三态.内贸 }, 外贸: { ...三态.外贸 } });
  const 改了 = 套们.some((t) => 项们.some(({ k }) => 天[t][k] !== 三态[t][k]));

  const 存 = async (改: Parameters<typeof 改组织规则>[0], 成了: string) => {
    set忙(true);
    try {
      const r = await 改组织规则(改);
      if (!r.ok) return void message.error(("error" in r && r.error) || "没改成，请稍后再试");
      message.success(成了);
      router.refresh();
    } catch {
      message.error("没改成，请稍后再试");
    } finally {
      set忙(false);
    }
  };

  const 切开关 = (开: boolean) => {
    if (!开) return void 存({ 三态: { 开: false } }, "已关客户回收");
    modal.confirm({
      title: "打开客户回收？",
      content: 打开后果,
      okText: "确认打开",
      cancelText: "再想想",
      onOk: () => 存({ 三态: { 开: true } }, "已打开客户回收，当晚起开始计时"),
    });
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card
        title="客户回收"
        extra={
          <Space>
            {挡 && <span style={{ color: "var(--text-muted)" }}>{挡}</span>}
            <span style={{ color: "var(--text-muted)" }}>{三态.开 ? "开" : "关"}</span>
            <Switch aria-label="客户回收（沉睡 → 待回收 → 自动进公海）" checked={三态.开} disabled={!!挡 || 忙} onChange={切开关} />
          </Space>
        }
      >
        <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>
          沉睡 → 待回收 → 自动进客户公海。{打开后果}负责人是市场成员的客户不计时。默认关。
        </div>
        {套们.map((t) => (
          <div key={t} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 500, marginBottom: 8 }}>{t}客户</div>
            {项们.map(({ k, 前, 后, 最小, 最大 }) => (
              <div key={k} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                <span className="nowrap">{k}：{前}</span>
                <InputNumber
                  aria-label={`${t}客户${后.replace(/^天/, "")}的天数`}
                  min={最小} max={最大} precision={0} style={{ width: 96 }}
                  disabled={!!挡 || 忙}
                  value={天[t][k]}
                  onChange={(v) => typeof v === "number" && set天((m) => ({ ...m, [t]: { ...m[t], [k]: v } }))}
                />
                <span className="nowrap">{后}</span>
              </div>
            ))}
          </div>
        ))}
        <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>
          客户名下内贸、外贸项目都有时取较长的一套；没有项目或项目都是「暂不分配」的按内贸。待回收期间提醒负责人 3 次。改了天数当晚按新的重算。
        </div>
        {!挡 && (
          <Button type="primary" disabled={忙 || !改了} onClick={() => void 存({ 三态: { 内贸: 天.内贸, 外贸: 天.外贸 } }, "已保存")}>保存</Button>
        )}
      </Card>
      <WordsCard 词们={value.占位词} />
    </div>
  );
}

/** 有效沟通的占位词表（T2）：一条沟通整条只是这些词时，不算有效沟通 */
function WordsCard({ 词们 }: { 词们: string[] | null }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [表, set表] = useState<string[]>(词们 ?? []);
  const [新, set新] = useState("");
  const [忙, set忙] = useState(false);
  if (!词们) {
    return (
      <Card title="占位词表">
        <div style={{ color: "var(--text-muted)" }}>只有系统管理员能看、能改占位词表。</div>
      </Card>
    );
  }
  const 存 = async (下一版: string[], 成了: string) => {
    set忙(true);
    try {
      const r = await 三态存占位词(下一版);
      if (!r.ok) return void message.error(r.error);
      set表(r.词们);
      message.success(成了);
      router.refresh();
    } catch {
      message.error("没改成，请稍后再试");
    } finally {
      set忙(false);
    }
  };
  const 加 = () => {
    const w = 新.trim();
    if (!w) return;
    if (表.includes(w)) return void message.info(`「${w}」已经在表里`);
    set新("");
    void 存([...表, w], `已加「${w}」`);
  };
  return (
    <Card title="占位词表" extra={<span style={{ color: "var(--text-muted)" }}>{表.length} 个</span>}>
      <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>一条沟通整条只是这些词时，不算有效沟通，不会重置回收倒计时。</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {表.length ? 表.map((w) => (
          <Tag key={w} closable={!忙} onClose={(e) => { e.preventDefault(); void 存(表.filter((x) => x !== w), `已删「${w}」`); }} style={{ marginInlineEnd: 0, maxWidth: 240 }}>
            <span className="clamp-1" style={{ display: "inline-block", verticalAlign: "bottom", maxWidth: 200 }} title={w}>{w}</span>
          </Tag>
        )) : <span style={{ color: "var(--text-muted)" }}>一个都没有：只按下面那几条判</span>}
      </div>
      <Space.Compact style={{ maxWidth: 320, width: "100%" }}>
        <Input aria-label="加一个占位词" placeholder="加一个词" maxLength={20} value={新} onChange={(e) => set新(e.target.value)} onPressEnter={加} disabled={忙} />
        <Button onClick={加} disabled={忙 || !新.trim()}>添加</Button>
      </Space.Compact>
      <div style={{ color: "var(--text-muted)", marginTop: 12 }}>
        其他不算有效沟通的情况（已定，不用设置）：中文去掉空白和标点后不足 4 个字；英文不足 2 个单词；只有素材没有文字。
      </div>
    </Card>
  );
}
