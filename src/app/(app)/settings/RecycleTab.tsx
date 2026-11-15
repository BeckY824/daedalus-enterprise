"use client";

/**
 * 设置 →「客户回收」（P-界面-19 ⑧，构想页 C16）：客户三态的总开关、三个天数（内贸、外贸各一套，M-公海-25）、有效沟通的占位词表。
 *
 * - 开关和天数存在组织规则的「三态」那一块，走现有的 改组织规则（谁能改同「各进程时限」：只有系统管理员，后台设置谁能改表）；
 *   打开是有后果的：打开后一分钟内夜扫就整库扫一遍（nightly.ts 每分钟看一眼，今天没扫过就扫），马上开始计时、给每位客户建状态；
 *   提醒按 tri-state-notice.ts 的 三态提醒时刻（北京 08:00）起一天一遍，过了 08:00 才打开的当天就发；到期自动收回。开关旁写明，打开时弹确认。默认关
 * - 占位词表走 三态存占位词（能改后台设置的人），整张换掉；服务端会去掉空白、标点、统一小写，存完按服务端回的显示
 * - 成交客户活跃段、继续持有、转让归零、冷项目这几块的数这里不摆（构想页只画了三个天数），照组织规则里存的 / 默认值
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, InputNumber, Space, Switch, Tag } from "antd";
import { 改组织规则, 预览客户回收 } from "@/app/(app)/projects/actions";
import { 三态存占位词 } from "@/app/(app)/customers/tri-state-actions";
import type { 三态规则, 三态天数 } from "@/lib/project/org-rules";
import { 三态显示名 } from "@/lib/enterprise/tri-state-label";
import { useConsequence } from "@/components/ConsequenceDialog";
import { showUndo } from "@/components/UndoBar";
import { useDirtyMark } from "@/lib/settings-dirty";
import { useSettingsNote } from "./InlineNote";

export type 客户回收设置 = {
  三态: 三态规则;
  /** 旧的「项目超时回收」开着没有：关客户回收时确认框要说清会改回按项目超时回收（db.ts 三态开着时超时回收不跑） */
  超时回收开?: boolean;
  /** 开关、天数这个人能不能改：null = 能改，否则是「只有……能改」那句 */
  挡: string | null;
  /** 占位词表；null = 这个人看不了（只有能改后台设置的人能看、能改，同 三态读占位词） */
  占位词: string[] | null;
};

/** 打开时说清后果（开关旁、确认框里同一句） */
const 打开后果 = "打开后立即开始按客户计时，几分钟内给每位客户建好状态：很久没有有效沟通的客户会进入沉睡待定、即将回收；系统每天 08:00（北京时间）起给负责人和上级发提醒，过了 08:00 才打开的当天就发第一遍；即将回收满期还没人处理的自动进客户公海。";
/** 关掉的后果（确认框里，PR10a）：关了夜扫整段不跑（三态夜扫 开着才扫），提醒、自动进公海都停 */
const 关掉后果 = "关掉后客户不再自动回收：不再按客户计时，不再发沉睡待定、即将回收的提醒，到期的客户也不会自动进客户公海。";

const 套们 = ["内贸", "外贸"] as const;
const 项们: { k: keyof 三态天数; 前: string; 后: string; 最小: number; 最大: number }[] = [
  { k: "沉睡", 前: "没有有效沟通满", 后: "天进入沉睡待定", 最小: 1, 最大: 3650 },
  { k: "待回收", 前: "没有有效沟通满", 后: "天进入即将回收", 最小: 2, 最大: 3650 },
  { k: "进公海", 前: "进入即将回收后再满", 后: "天自动进客户公海", 最小: 21, 最大: 365 },
];

export default function RecycleTab({ value }: { value: 客户回收设置 }) {
  const router = useRouter();
  // 反馈都在原地（原型 g.save）：存成了保存键里写「✓ 已保存」，没成写在键旁边；不弹顶部提示
  const [刚存, set刚存] = useState(false);
  const [错, set错] = useState("");
  // 确认用 PR5a 后果框（PR9：设置各页签的 modal.confirm 都换成它），不确认不存
  const [问后果, 后果框] = useConsequence();
  // 打开成了照实说一句「已开始计时」（打开即计时），写在页签底部的就地提示条里（g.save，不弹顶部）
  const [提示, 提示条] = useSettingsNote();
  const [忙, set忙] = useState(false);
  const { 三态, 挡 } = value;
  const [天, set天] = useState<Record<(typeof 套们)[number], 三态天数>>({ 内贸: { ...三态.内贸 }, 外贸: { ...三态.外贸 } });
  const 改了几项 = 套们.reduce((n, t) => n + 项们.filter(({ k }) => 天[t][k] !== 三态[t][k]).length, 0);
  const 改了 = 改了几项 > 0;
  // 没存就关先问（原型 st.dirty）：登记给设置浮层；改了就浮出保存条（贴底，不跟着滚走）
  useDirtyMark("recycle-days", 改了几项);

  /**
   * 存；回结果给后果框（没成原因写在框里、框不关）。不经后果框的（关着时改天数）没成写在保存键旁边。
   * 存天数成了保存键里亮「✓ 已保存」；关掉成了看开关本身，不另提示；打开成了在页签底部就地说一句「已开始计时」
   */
  const 存 = async (改: Parameters<typeof 改组织规则>[0], 是天数: boolean, 框里 = true): Promise<{ ok: boolean; error?: string }> => {
    set忙(true);
    set错("");
    try {
      const r = await 改组织规则(改);
      if (!r.ok) {
        const 话 = ("error" in r && r.error) || "没改成，请稍后再试";
        if (!框里) set错(话);
        return { ok: false, error: 话 };
      }
      if (是天数) {
        set刚存(true);
        setTimeout(() => set刚存(false), 1400);
      }
      router.refresh();
      return { ok: true };
    } catch {
      if (!框里) set错("没改成，请稍后再试");
      return { ok: false, error: "没改成，请稍后再试" };
    } finally {
      set忙(false);
    }
  };

  const 切开关 = (开: boolean) => {
    // 关也有后果（P-界面-40 组织规则开关 = 后果确认框），不确认不生效（PR10a）
    if (!开) {
      return void 问后果({
        题: "关掉客户回收？",
        后果: [
          { 标: "全员", 级: "警", 话: 关掉后果 },
          ...(value.超时回收开 ? [{ 标: "改回", 话: "「超时回收」开着：关掉后改回按项目超时回收，线索、商机阶段超时的项目回线索公海。" }] : []),
        ],
        是: "确认关掉",
        做: () => 存({ 三态: { 开: false } }, false),
      });
    }
    void 问后果({
      题: "打开客户回收？",
      后果: [{ 标: "全员", 级: "警", 话: 打开后果 }],
      是: "确认打开",
      危: false,
      做: async () => {
        const r = await 存({ 三态: { 开: true } }, false);
        if (r.ok) 提示.success("已打开客户回收，已开始计时");
        return r;
      },
    });
  };

  /**
   * 存天数（PR10a）：客户回收开着时改了天数，今晚的夜扫按新天数对全员重算——先数一遍会变几位，确认了才存；
   * 数不出来（超时、出错）就不写数字。关着时改天数不重算任何人，一次存完不弹框（能一次做完的不加确认）
   */
  const 存天数 = async () => {
    const 改: Parameters<typeof 改组织规则>[0] = { 三态: { 内贸: 天.内贸, 外贸: 天.外贸 } };
    if (!三态.开) return void 存(改, true, false);
    set忙(true);
    // 预览要整库算一遍，客户多时可能慢：最多等 5 秒，过时就不写数字、照常弹确认
    const 看 = await Promise.race([
      预览客户回收(改).catch(() => null),
      new Promise<null>((ok) => setTimeout(() => ok(null), 5000)),
    ]);
    set忙(false);
    // 没权限、天数不对这类服务端明说不行的，直接说，不弹确认
    if (看 && !看.ok) return void set错(("error" in 看 && 看.error) || "没改成，请稍后再试");
    const 数 = 看?.ok ? 看.预览 : null;
    const 改了的 = 套们.flatMap((t) => 项们.filter(({ k }) => 天[t][k] !== 三态[t][k]).map(({ k }) => `${t}客户${k === "进公海" ? `${三态显示名("待回收")}后进公海` : `进入${三态显示名(k)}`}：${三态[t][k]} → ${天[t][k]} 天`));
    void 问后果({
      题: "改客户回收天数？",
      后果: [
        { 标: "改了", 话: `${改了的.join("；")}。` },
        { 标: "全员", 级: "警", 话: "今晚（北京时间 0 点后）起按新天数对全员重算，白天有人记了沟通的客户当场按新天数算。" },
        ...(数 ? [{ 标: "影响", 级: "警" as const, 话: 数.变 ? `按现在的数据，约 ${数.变} 位客户的状态会变${数.进公海 ? `，其中约 ${数.进公海} 位会到期自动进客户公海` : ""}。` : "按现在的数据，没有客户的状态会变。" }] : []),
        { 标: "能改回", 话: "改回原来的天数，当晚再按原来的算一次；已经进公海的不会回来" },
      ],
      是: "确认修改",
      危: false,
      宽: 480,
      做: () => 存(改, true),
    });
  };

  return (
    <div className="tri-recycle">
      {后果框}
      <Card
        title="客户回收"
        extra={
          <Space>
            {挡 && <span className="tri-muted">{挡}</span>}
            <span className="tri-muted">{三态.开 ? "开" : "关"}</span>
            <Switch aria-label="客户回收（沉睡待定 → 即将回收 → 自动进公海）" checked={三态.开} disabled={!!挡 || 忙} onChange={切开关} />
          </Space>
        }
      >
        <div className="tri-note">
          沉睡待定 → 即将回收 → 自动进客户公海。{打开后果}负责人是市场成员的客户不计时。默认关。
        </div>
        {套们.map((t) => (
          <div key={t} className="tri-set">
            <div className="tri-set-t">{t}客户</div>
            {项们.map(({ k, 前, 后, 最小, 最大 }) => (
              <div key={k} className="tri-set-row">
                <span className="nowrap">{三态显示名(k)}：{前}</span>
                <InputNumber
                  aria-label={`${t}客户${后.replace(/^天/, "")}的天数`}
                  min={最小} max={最大} precision={0} className="tri-num"
                  disabled={!!挡 || 忙}
                  value={天[t][k]}
                  onChange={(v) => typeof v === "number" && set天((m) => ({ ...m, [t]: { ...m[t], [k]: v } }))}
                />
                <span className="nowrap">{后}</span>
              </div>
            ))}
          </div>
        ))}
        <div className="tri-note">
          客户名下内贸、外贸项目都有时取较长的一套；没有项目或项目都是「暂不分配」的按内贸。即将回收期间提醒负责人 3 次。改了天数当晚按新的重算。
        </div>
        {!挡 && (
          <div className={`tri-save${改了 ? " tri-dirty" : ""}`}>
            {改了 && <span className="tri-dirty-t">改了 {改了几项} 项，还没保存</span>}
            {改了 && <Button disabled={忙} onClick={() => { set天({ 内贸: { ...三态.内贸 }, 外贸: { ...三态.外贸 } }); set错(""); }}>放弃</Button>}
            <Button type="primary" disabled={(忙 || !改了) && !刚存} onClick={() => void 存天数()} className={刚存 ? "tri-saved" : undefined}>
              {刚存 ? "✓ 已保存" : "保存"}
            </Button>
            {错 && <span className="tri-err" role="alert">{错}</span>}
          </div>
        )}
      </Card>
      <WordsCard 词们={value.占位词} />
      {提示条}
    </div>
  );
}

/** 有效沟通的占位词表（T2）：一条沟通整条只是这些词时，不算有效沟通 */
function WordsCard({ 词们 }: { 词们: string[] | null }) {
  const router = useRouter();
  const [表, set表] = useState<string[]>(词们 ?? []);
  // 就地提示（不弹顶部）：已在表里 / 没改成
  const [提示, set提示] = useState("");
  const [新, set新] = useState("");
  const [忙, set忙] = useState(false);
  if (!词们) {
    return (
      <Card title="占位词表">
        <div className="tri-muted">只有系统管理员能看、能改占位词表。</div>
      </Card>
    );
  }
  const 存 = async (下一版: string[]): Promise<{ ok: boolean; error?: string }> => {
    set忙(true);
    set提示("");
    try {
      const r = await 三态存占位词(下一版);
      if (!r.ok) {
        set提示(r.error);
        return r;
      }
      set表(r.词们);
      router.refresh();
      return { ok: true };
    } catch {
      set提示("没改成，请稍后再试");
      return { ok: false, error: "没改成，请稍后再试" };
    } finally {
      set忙(false);
    }
  };
  const 加 = () => {
    const w = 新.trim();
    if (!w) return;
    if (表.includes(w)) return void set提示(`「${w}」已经在表里`);
    set新("");
    void 存([...表, w]);
  };
  // 删一个词：一步做完，底部撤销条可撤（P-界面-40 一步完成 + 撤销 = 反着做）
  const 删 = async (w: string) => {
    const 原 = 表;
    if ((await 存(表.filter((x) => x !== w))).ok) showUndo({ 话: `已删「${w}」`, 撤销: () => 存(原) });
  };
  return (
    <Card title="占位词表" extra={<span className="tri-muted">{表.length} 个</span>}>
      <div className="tri-note">一条沟通整条只是这些词时，不算有效沟通，不会重置回收倒计时。</div>
      <div className="tri-words">
        {表.length ? 表.map((w) => (
          <Tag key={w} closable={!忙} onClose={(e) => { e.preventDefault(); void 删(w); }} className="tri-word">
            <span className="clamp-1 tri-word-t" title={w}>{w}</span>
          </Tag>
        )) : <span className="tri-muted">一个都没有：只按下面那几条判</span>}
      </div>
      <Space.Compact className="tri-word-add">
        <Input aria-label="加一个占位词" placeholder="加一个词" maxLength={20} value={新} onChange={(e) => set新(e.target.value)} onPressEnter={加} disabled={忙} />
        <Button onClick={加} disabled={忙 || !新.trim()}>添加</Button>
      </Space.Compact>
      {提示 && <div className="tri-err" role="status">{提示}</div>}
      <div className="tri-note-top">
        其他不算有效沟通的情况（已定，不用设置）：中文去掉空白和标点后不足 4 个字；英文不足 2 个单词；只有素材没有文字。
      </div>
    </Card>
  );
}
