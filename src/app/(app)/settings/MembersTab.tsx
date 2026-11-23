"use client";

import { useSettingsNote } from "./InlineNote";
import { 跳到第一处 } from "@/lib/form-validation";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Table, Button, Space, Tag, Modal, Form, Input, Select, Switch, Row as 行, Col, Alert, Typography, Grid, Popover, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, EditOutlined, StopOutlined, UndoOutlined, SafetyCertificateFilled, SafetyCertificateOutlined, SettingOutlined } from "@ant-design/icons";
import { UserCell } from "@/components/ui";
import { ROLES } from "@/lib/constants";
import { useBusiness } from "@/lib/business-client";
import { 外贸订单 } from "@/lib/business-config";
import type { SessionUser } from "@/lib/auth";
import { saveUser, deactivateUser, reactivateUser, 停用清点, 批量停用, 解绑飞书身份 } from "./actions";
import { 设不管设置, 设系统管理员 } from "./org-actions";
import { 按阶段说, 三阶段 } from "@/lib/project/member-count";
import { 角色名, 是只读角色们, 角色组合问题, type 业务角色 } from "@/lib/sync/dept-policy";
import BizRoleSelect from "./BizRoleSelect";
import { useConsequence } from "@/components/ConsequenceDialog";
import InlineConfirm from "@/components/InlineConfirm";

/** 设置 · 团队成员：谁能进、谁是管理员。新增、编辑、停用（停用要先把名下的客户转交出去） */

/** 系统管理员小盾牌的悬停说明：说清现在是什么、点了会怎样、为什么拨不动 */
function 系统管理员说明(x: { on: boolean; 有线: boolean }, 能拨: boolean): string {
  if (!x.有线) return "系统管理员（没设业务线的总管理就是）。要只管一条线，先在组织架构里给他设业务线";
  if (!能拨) return "系统管理员，同时是本业务线的条线总管理";
  return x.on ? "系统管理员，同时是本业务线的条线总管理。点一下取消，只管本业务线" : "只管本业务线（条线总管理）。点一下设为系统管理员，两个身份并存";
}

export type Row = {
  id: string;
  name: string;
  email: string;
  title: string;
  role: string;
  active: boolean;
  customerCount: number;
  oppCount: number;
  /** 企业版：在跟（没结局）的项目按阶段数（线索 / 商机 / 订单）；有它就不摆「商机数」 */
  项目阶段?: Record<string, number>;
  /** 企业版：组织架构里的业务角色（可多个，按固定顺序）；有它角色列就摆它，账号角色退到编辑框里叫「账号权限」 */
  业务角色?: 业务角色[];
  /** 企业版：总管理勾了「不管设置」——还是看全部、能转让，但进不了设置页、改不了后台设置（11-01 C1） */
  不管设置?: boolean;
  /** 企业版、在职的总管理才有（P-判定-06）：on = 是系统管理员；有线 = 设了业务线（没设线的总管理就是系统管理员，开关关不掉） */
  系统管理员?: { on: boolean; 有线: boolean };
  followCount: number;
  /** 企业版飞书登录：第一次用飞书登录时按姓名绑上了飞书身份 */
  飞书已绑?: boolean;
};

/** 管人的红、带团队的蓝，其余默认灰——跟账号角色那套颜色同一个意思 */
/** 设计语言 E4（D1 实测）：红只给出问题，「总管理」「管理员」不是出了问题——这两个用默认灰 */
const 业务角色色: Record<业务角色, string | undefined> = {
  director: undefined, admin: undefined, coach: "purple", sales_mgr: "blue", marketing_mgr: "blue",
  sales: undefined, channel_ops: undefined, project_ops: undefined,
};

export default function MembersTab({
  users,
  me,
  isAdmin,
  用邮箱登录,
  企业版 = false,
  下属可停用 = [],
}: {
  users: Row[];
  me: SessionUser;
  isAdmin: boolean;
  /** 托管版：成员的登录标识是邮箱，不是用户名。见下面表单里那段注释 */
  用邮箱登录: boolean;
  /** 企业版办离职先清点、名下原地不动（11-03 C4-4）；别的版本停用对话框和原来一样 */
  企业版?: boolean;
  /** 企业版：我是他们的直属上级，能给他们办离职（D-36）。管理员不看这个，全都能办 */
  下属可停用?: string[];
}) {
  const router = useRouter();
  // 就地提示（PR9：不弹顶部 message）
  const [就地, 提示条] = useSettingsNote();
  const [问后果, 后果框] = useConsequence();
  const b = useBusiness();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [解绑中, set解绑中] = useState(false);
  // 解绑后这一行就收起；不改 editing——改了会触发上面的回填，把弹窗里没保存的改动冲掉
  const [刚解绑, set刚解绑] = useState<string | null>(null);
  const [恢复中, set恢复中] = useState<string | null>(null);
  const [form] = Form.useForm();
  const 按业务角色 = users.some((u) => u.业务角色);
  /** 企业版新增成员：当场选业务角色（编辑已有成员的角色在「组织架构」里改） */
  const 新建带角色 = 企业版 && 按业务角色 && !editing;
  /**
   * 新增时选了总管理：提醒一句他建好就能管设置。系统管理员 = 总管理且没设业务线（或带标记），
   * 能管设置 = 系统管理员且没勾「不管设置」（lib/enterprise/org-core.ts 是系统管理员of / 能管设置of）；新建的人还没设业务线、不管设置默认关
   */
  const 选的角色 = Form.useWatch("业务角色", form) as string[] | undefined;
  const 新建总管理 = 新建带角色 && !!选的角色?.includes("director");
  const [改不管设置中, set改不管设置中] = useState<string | null>(null);
  /** 拨「系统管理员」：只有能管设置的系统管理员（服务端 org-actions 设系统管理员 再拦、不能关掉最后一位） */
  const on系统管理员 = async (r: Row, on: boolean) => {
    if (改不管设置中) return;
    // 设 / 撤系统管理员（原型 st.member，P-界面-40「设管理员」= 后果框）：原来小旗点一下立即提交，只有关自己的才问；
    // 现在一律先出后果框，确认了带 确认=true 交给服务端（关自己的那句后果写在框里，不再二次弹 modal.confirm）
    const 是我 = r.id === me.id;
    await 问后果({
      题: on ? `把「${r.name}」设为系统管理员` : 是我 ? "你将不再是系统管理员" : `「${r.name}」不再是系统管理员`,
      后果: on
        ? [
            { 标: "全部权限", 级: "警", 话: "看和改全部客户、项目；后台设置、成员管理、导入导出、切换视角、回收站彻底删除" },
            { 标: "同时", 话: "还是本业务线的条线总管理" },
            { 标: "能改回", 话: "随时可以再撤掉" },
          ]
        : [
            { 标: "收回", 级: "警", 话: `${是我 ? "你" : r.name}只管本业务线，进不了后台设置` },
            ...(是我 ? [{ 标: "自己", 级: "危" as const, 话: "撤掉自己以后要别的系统管理员才能给你加回来" }] : []),
          ],
      是: on ? "设为系统管理员" : "撤掉",
      危: !on,
      做: async () => {
        const res = await 设系统管理员(r.id, on, true);
        if (!res.ok) return { ok: false, error: res.error ?? "没改成，请稍后再试" };
        if (res.提示) 就地.warning(res.提示);
        else 就地.success(on ? `${r.name} 设为系统管理员，同时还是本线条线总管理` : `${r.name} 不再是系统管理员，只管本业务线`);
        router.refresh();
        return { ok: true };
      },
    });
  };
  /** 勾 / 取消「不管设置」：只有能改组织架构的总管理（服务端 org-actions 设不管设置 再拦一遍、保至少一位能管设置的总管理） */
  const on不管设置 = async (r: Row, on: boolean) => {
    if (改不管设置中) return;
    set改不管设置中(r.id);
    try {
      const res = await 设不管设置(r.id, on);
      if (!res.ok) 就地.error(res.error ?? "没改成，请稍后再试");
      else {
        就地.success(on ? `${r.name} 不再管设置` : `${r.name} 又能管设置了`);
        router.refresh();
      }
    } finally {
      set改不管设置中(null);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (editing) form.setFieldsValue({ ...editing, password: "" });
    else {
      form.resetFields();
      form.setFieldsValue({ role: "SALES", title: "销售", active: true });
    }
  }, [open, editing, form]);

  // 保存中不再收第二下：网慢、连着团队时连点几下会建出几条一样的（10-07 Sam 实测建出三条重复商机）
  const [存着, set存着] = useState(false);
  async function onOk() {
    if (存着) return;
    set存着(true);
    try {
      await 存();
    } finally {
      set存着(false);
    }
  }
  async function 存() {
    const v = await form.validateFields().catch(跳到第一处(form));
    if (!v) return;
    const 提交 = (force?: boolean) => saveUser({ id: editing?.id, ...v, force });

    const res = await 提交();
    if (res.ok) {
      就地.success(editing ? "已保存" : "成员已创建");
      setOpen(false);
      router.refresh();
      return;
    }
    if ("error" in res) {
      就地.error(res.error);
      return;
    }

    /**
     * 同名不硬拦：同名同事是正常情况，拦下来管理员就建不了人。
     * 但要让他知道系统里已经有一个，避免把「张三」错建成第二条而不自知。
     */
    const 同名 = res.duplicateName;
    // 同名提醒（原型 g.confirm3 / P-界面-40）：后果框写清是谁、怎么区分；确认了带 force 再交一次，没成原因写在框里
    void 问后果({
      题: "已有同名成员",
      危: false,
      后果: [
        { 标: "已有", 级: "警", 话: <>系统里已有一位<b>{同名.name}</b>，{用邮箱登录 ? "登录邮箱" : "登录用户名"} <b>{同名.email}</b></> },
        { 标: "另一个人", 话: "可以继续创建，各处负责人下拉会自动带上登录名区分" },
        { 标: "同一个人", 话: "点取消，不要再建一条" },
      ],
      是: "确实是另一个人，继续创建",
      做: async () => {
        const again = await 提交(true);
        if (!again.ok) return { ok: false, error: "error" in again ? again.error : "没保存上，请稍后再试" };
        就地.success(editing ? "已保存" : "成员已创建");
        setOpen(false);
        router.refresh();
        return { ok: true };
      },
    });
  }

  const [清点中, set清点中] = useState<string | null>(null);
  // 接手人同负责人候选（11-03 完成度 C3-1，lib/enterprise/permissions.ts 能当负责人）：企业版要有业务角色、不是只读管理员
  // 接手人要能当负责人：只读角色（管理员、销售教练，不兼总管理）不进下拉
  const 能接手 = (u: Row) => u.active && (!企业版 || (!!u.业务角色?.length && !是只读角色们(u.业务角色)));
  const 能停 = (r: Row) => r.active && (isAdmin ? r.id !== me.id : 下属可停用.includes(r.id));
  // 企业版批量离职：勾几个人，同一个接手人、同一种方式一次办完
  const [勾了, set勾了] = useState<string[]>([]);
  const 能批量 = 企业版 && (isAdmin || 下属可停用.length > 0);
  async function onBatchDeactivate() {
    const 们 = 勾了.filter((id) => users.some((u) => u.id === id && 能停(u)));
    if (!们.length) return;
    if (清点中) return;
    // 企业版办离职名下原地不动（11-03 C4-4）：清点的是停用后还留在他们名下、要到离职交接里交的
    set清点中("批量");
    const 各 = await Promise.all(们.map((id) => 停用清点(id).catch(() => null)));
    set清点中(null);
    const 坏 = 各.find((x) => !x?.ok);
    if (坏 !== undefined) {
      就地.error(坏 && "error" in 坏 ? 坏.error : "清点没成功，刷新再试");
      return;
    }
    const 合 = 各.reduce((和, x) => (x && x.ok ? { 客户: 和.客户 + x.原地.客户, 项目: 和.项目 + x.原地.项目 } : 和), { 客户: 0, 项目: 0 });
    const 录音 = 各.reduce((和, x) => 和 + (x && x.ok ? x.录音 : 0), 0);
    // PR9：停用成员 = 后果框（P-界面-40），清点结果放补充里；没成的原因写在框里
    void 问后果({
      题: `停用 ${们.length} 位成员`,
      宽: 480,
      后果: [
        { 标: "登不上", 级: "危", 话: "停用后这几位登不上，也不再出现在负责人、分配下拉里" },
        { 标: "名下不动", 级: "警", 话: "名下的客户、项目原地不动，到「项目 → 离职交接」里交给接手人" },
        ...录音后果(录音),
        { 标: "能恢复", 话: "在成员列表里点恢复可以再启用" },
      ],
      补充: <OffboardNote names={们.map((id) => users.find((u) => u.id === id)?.name ?? "")} 点={合} />,
      是: "确认停用",
      做: async () => {
        const res = await 批量停用(们, "").catch(() => null);
        if (!res) return { ok: false, error: "停用没成功，刷新再试" };
        if (!res.ok) return res;
        if (res.失败.length) {
          const 名 = (id: string) => users.find((u) => u.id === id)?.name ?? id;
          就地.warning(`停用了 ${res.停了} 位；${res.失败.map((f) => `「${名(f.id)}」${f.error}`).join("；")}`);
        } else 就地.success(`已停用 ${res.停了} 位成员，名下的到「项目 → 离职交接」里交给接手人`);
        set勾了([]);
        router.refresh();
        return { ok: true };
      },
    });
  }
  async function onDeactivate(r: Row) {
    if (清点中) return;
    // 企业版（11-03 C4-4 / B7-2）：不选接手人、不放公海，名下原地不动，停用后到「项目 → 离职交接」里交
    if (企业版) {
      set清点中(r.id);
      const 清 = await 停用清点(r.id).catch(() => null);
      set清点中(null);
      if (!清?.ok) {
        就地.error(清 && "error" in 清 ? 清.error : "清点没成功，刷新再试");
        return;
      }
      void 问后果({
        题: `停用成员「${r.name}」`,
        宽: 480,
        后果: [
          { 标: "登不上", 级: "危", 话: `停用后「${r.name}」登不上，也不再出现在负责人、分配下拉里` },
          { 标: "名下不动", 级: "警", 话: "名下的客户、项目原地不动，到「项目 → 离职交接」里交给接手人" },
          ...录音后果(清.录音),
          { 标: "能恢复", 话: "在成员列表里点恢复可以再启用" },
        ],
        补充: <OffboardNote names={[r.name]} 点={清.原地} />,
        是: "确认停用",
        做: async () => {
          const res = await deactivateUser(r.id, "");
          if (res.ok) {
            就地.success(`已停用「${r.name}」，名下的到「项目 → 离职交接」里交给接手人`);
            router.refresh();
          }
          return res;
        },
      });
      return;
    }
    const others = users.filter((u) => 能接手(u) && u.id !== r.id);
    if (!others.length) {
      就地.error("没有可接手的成员");
      return;
    }
    // 接手人默认空、必须选（11-03 C4-3）：停用 = 后果框（P-界面-40），接手人在框里选；没选点确认，原因写在框里、框不关
    let target = "";
    void 问后果({
      题: `停用成员「${r.name}」`,
      宽: 480,
      后果: [
        { 标: "登不上", 级: "危", 话: `停用后「${r.name}」登不上，也不再出现在负责人、分配下拉里` },
        // 说清转交的是往后要跟的活、历史业绩不动（排查 B2）
        { 标: "转交", 级: "警", 话: `${r.customerCount} 位${b.customer}，连同进行中的商机、没做完的计划和待办、线索、渠道，一起转交给下面选的人` },
        { 标: "不动", 话: `${外贸订单(b) ? "已经下的订单、转了订单和丢单的商机" : "已经签下的业绩、赢单和丢单的商机"}，还算在「${r.name}」头上` },
      ],
      补充: (
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="选接手人"
          aria-label="接手人"
          style={{ width: "100%" }}
          onChange={(v: string) => { target = v; }}
          options={others.map((u) => ({ value: u.id, label: u.name }))}
        />
      ),
      是: "确认停用",
      做: async () => {
        if (!target) return { ok: false, error: "先选接手人" };
        const res = await deactivateUser(r.id, target);
        if (!res.ok) return res;
        就地.success("已停用并转交");
        router.refresh();
        return { ok: true };
      },
    });
  }

  const 屏 = Grid.useBreakpoint();
  // 列宽三档（11-23）：设置正文封顶——浮层 1040 框里正文 732、整页最宽 782，Windows 再让出 10 左右的滚动条；
  // 原来的宽屏列宽合计 744，1200 以上浮层里任何窗口宽都放不下（员工截图 1264 宽横滚）、1024 整页正文 460–494 更放不下。
  //   手机（< 768）：照旧，表本来就横滚
  //   窄屏 768–1199：六列合计 ≤ 452（1024 整页最窄 460 − 8），行尾动作只留字不带图标
  //   桌面 ≥ 1200：八列合计 644（1200 整页 Windows 正文约 660 − 8 以内），动作「图标 + 字」（D09）
  // 桌面两档格子左右内边距 4、标签内边距 4（globals.css .member-table 同一断点）
  const 手机 = 屏.md === false;
  const 窄 = 屏.md === true && !屏.xl;
  /** 行尾动作：「图标 + 字」（D09，.row-act 文字款；窄屏只留字） */
  const 行钮 = (字: string, 图标: ReactNode) => ({ className: "row-act", size: "small" as const, children: 字, icon: 窄 ? undefined : 图标 });
  const columns: ColumnsType<Row> = [
    // 姓名这一列只放姓名（11-01 用户：「系统清除掉小字。只留姓名即可」）：权限只看「角色」那一栏，
    // 职位、登录名这些小字容易被误当成权限。登录名在编辑弹窗里看；职位数据不动，只是不显示
    {
      title: "姓名",
      dataIndex: "name",
      // 手机照旧：行尾动作带字（D09），操作列宽 44、姓名列让出 44；桌面两档见上面「列宽三档」
      width: 手机 ? 146 : 窄 ? 96 : 124,
      render: (v) => <UserCell name={v} size={30} />,
    },
    按业务角色
      ? {
          title: "角色",
          key: "业务角色",
          width: 手机 ? 120 : 窄 ? 108 : 124,
          render: (_: unknown, r: Row) => (
            <div className="member-roles">
              {/* 角色标签一行，放不下「…」，悬停看全部（11-04 用户：待定第 5 点按优化来）；系统管理员、不管设置两个小图标不截 */}
              {/* 一个标签：第一个角色 + 「+N」，放不下标签自己带「…」（Tag 是 inline-block，外层的 text-overflow 管不到它），悬停看全部。
                  「+N」并进同一个标签：分开摆时窄格里第一个标签只剩半个字、连「…」都放不下 */}
              {/* 悬停全文走全站的 TruncTip（截了才浮、显示 title）；没截但有「+N」时浏览器原生提示也是全部角色 */}
              {(r.业务角色 ?? []).length > 0 && (
                <span className="member-roles-tags">
                  {/* 「+N」单独一格不截（11-23 审查：窄格里「渠道运营 +1」的「+1」被截掉，看不出还有别的角色），只截第一个角色名；
                      title 挂在两小格上不挂标签：TruncTip 量到截了的是角色名那格，浮出它的 title（全部角色），不和标签的原生提示叠两层 */}
                  <Tag color={业务角色色[r.业务角色![0]]} className="member-role-tag">
                    <span className="member-role-main" title={(r.业务角色 ?? []).map((x) => 角色名[x]).join("、")}>{角色名[r.业务角色![0]]}</span>
                    {r.业务角色!.length > 1 && <span className="member-role-more" title={(r.业务角色 ?? []).map((x) => 角色名[x]).join("、")}>+{r.业务角色!.length - 1}</span>}
                  </Tag>
                </span>
              )}
              {/* 「系统管理员」（P-判定-06）：和业务线并存。角色标签旁一个小盾牌，不加宽角色列（全站一行、不多出横向滚动）。
                  实心 = 是系统管理员；空心 = 只管本业务线。没设业务线的总管理本来就是，实心、拨不动 */}
              {企业版 && r.系统管理员 &&
                (isAdmin || r.系统管理员.on) && (
                  <Tooltip title={系统管理员说明(r.系统管理员, isAdmin)}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={r.系统管理员.on}
                      aria-label={`${r.name} 系统管理员`}
                      data-testid="member-sysadmin"
                      // 拨不动用 aria-disabled 不用 disabled：原生 disabled 的按钮收不到悬停，说明就弹不出来
                      className={`member-flag-btn member-sysadmin${r.系统管理员.on ? " is-on" : ""}${!isAdmin ? " is-readonly" : ""}`}
                      aria-disabled={!isAdmin || 改不管设置中 !== null || !r.系统管理员.有线}
                      onClick={() => { if (isAdmin && 改不管设置中 === null && r.系统管理员?.有线) void on系统管理员(r, !r.系统管理员.on); }}
                    >
                      {r.系统管理员.on ? <SafetyCertificateFilled /> : <SafetyCertificateOutlined />}
                    </button>
                  </Tooltip>
                )}
              {/* 「不管设置」只对总管理有意义（11-01 C1）：能改设置的人拨，别人只在勾上时看到标记。
                  和系统管理员小盾牌一样做成角色标签旁的小图标：原来的「☐ 不管设置」勾选框占掉 84px，120 宽的角色列里总管的角色标签被挤没了 */}
              {/* 只给当前是系统管理员的人摆（不管设置只管系统管理员进不进设置；条线总管理本来就进不了） */}
              {r.系统管理员?.on && 企业版 && (isAdmin || r.不管设置) && (
                <Tooltip title={r.不管设置 ? `不管设置：进不了设置页、改不了后台设置，别的权限照旧${isAdmin ? "。点一下取消" : ""}` : "管设置。点一下设为「不管设置」：进不了设置页，别的权限照旧"}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!r.不管设置}
                    aria-label={`${r.name} 不管设置`}
                    data-testid="member-no-settings"
                    className={`member-flag-btn member-no-settings${r.不管设置 ? " is-on" : ""}${!isAdmin ? " is-readonly" : ""}`}
                    aria-disabled={!isAdmin || 改不管设置中 !== null}
                    onClick={() => { if (isAdmin && 改不管设置中 === null) void on不管设置(r, !r.不管设置); }}
                  >
                    <SettingOutlined />
                  </button>
                </Tooltip>
              )}
            </div>
          ),
        }
      : {
          title: "角色",
          dataIndex: "role",
          width: 90,
          render: (v: string) => (
            <Tag color={v === "ADMIN" ? "red" : v === "MANAGER" ? "blue" : "default"} style={{ margin: 0 }}>
              {ROLES.find((r) => r.value === v)?.label ?? v}
            </Tag>
          ),
        },
    // 1024 宽时设置页右边只剩约 490，两个次要的数先收起，1200 以上才出（10-27）
    { title: `负责${b.customer}`, dataIndex: "customerCount", width: 手机 ? 80 : 64, responsive: ["xl"] },
    users.some((u) => u.项目阶段)
      ? {
          // 只摆总数，点开看各阶段（10-30）：三个数挤一格在 1366 宽时折两行
          title: "项目数",
          key: "项目数",
          width: 手机 ? 72 : 52,
          render: (_: unknown, r: Row) => {
            const 总 = 三阶段.reduce((a, ph) => a + (r.项目阶段?.[ph] ?? 0), 0);
            return 总 ? (
              <Popover trigger="click" content={按阶段说(r.项目阶段 ?? {})}>
                <Button type="link" size="small" style={{ padding: 0 }} aria-label={`${r.name} 的项目分阶段`}>{总}</Button>
              </Popover>
            ) : 0;
          },
        }
      : { title: "商机数", dataIndex: "oppCount", width: 手机 ? 80 : 52 },
    { title: "跟进数", dataIndex: "followCount", width: 手机 ? 70 : 52, responsive: ["xl"] },
    {
      title: "状态",
      dataIndex: "active",
      // 「已停用」标签内边距 4 时 50 宽，格子 64 − 8 = 56 放得下（11-23 审查：60 时 56 宽的标签伸出格子）
      width: 手机 ? 84 : 64,
      render: (v) => (
        <Tag color={v ? "success" : "default"} style={{ margin: 0 }}>
          {v ? "在职" : "已停用"}
        </Tag>
      ),
    },
    {
      title: "",
      key: "act",
      // 两个图标按钮（手机上各撑到 44，globals.css .row-act）；120 时 1366 宽下整张表比设置页宽，最右这列被截（10-30 交互规则 G）。
      // 手机宽（< md）两颗 44 加间距要 96、再加格子内边距放不下 96，伸出格子（11-17 手机排版闸门 2H）：手机上给 128，表本来就横滚
      // 设计语言 E4（D09）：「图标 + 字」（L-B 的 .row-act 款：蓝字、不带框），两颗 + 间距 + 格子内边距要 132，CI（Linux 字体）实测伸出 4px，给到 140；手机宽各撑到 44 高要 136
      // 窄屏只留字：两颗「编辑」「停用」各 38、触屏各撑到 44（.row-act），加间距和 4+4 内边距要 98；
      // 按下停用 / 恢复时转圈盖在字上、不加宽（globals.css），不会顶出格子。桌面「图标 + 字」各 60（转圈顶替图标，宽不变）+ 间距 + 内边距 130，给 132
      width: 手机 ? 136 : 窄 ? 98 : 132,
      // 行上不标红（10-30 交互规则 D）：停用要先清点、再在弹窗里确认，红色留给弹窗
      render: (_, r) =>
        !isAdmin && 能停(r) ? (
          <Button
            {...行钮("办离职", <StopOutlined />)}
            aria-label={`给 ${r.name} 办离职`}
            loading={清点中 === r.id}
            onClick={() => onDeactivate(r)}
          />
        ) : isAdmin ? (
          <Space size={2}>
            <Button
              {...行钮("编辑", <EditOutlined />)}
              aria-label={`编辑 ${r.name}`}
              onClick={() => {
                setEditing(r);
                setOpen(true);
              }}
            />
            {r.active ? (
              <Button
                {...行钮("停用", <StopOutlined />)}
                aria-label={`停用成员 ${r.name}`}
                disabled={r.id === me.id}
                loading={清点中 === r.id}
                onClick={() => onDeactivate(r)}
              />
            ) : (
              <Button
                {...行钮("恢复", <UndoOutlined />)}
                aria-label={`恢复成员 ${r.name}`}
                loading={恢复中 === r.id}
                disabled={恢复中 !== null}
                onClick={async () => {
                  if (恢复中) return;
                  set恢复中(r.id);
                  try {
                    const result = await reactivateUser(r.id);
                    if (!result.ok) { 就地.error(result.error); return; }
                    就地.success("已恢复");
                    router.refresh();
                  } catch {
                    就地.error("恢复失败，请稍后重试");
                  } finally {
                    set恢复中(null);
                  }
                }}
              />
            )}
          </Space>
        ) : null,
    },
  ];

  return (
    <>
      {后果框}
      {提示条}
      {!isAdmin && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          title={下属可停用.length
            ? `只有${企业版 ? "负责设置的总管理" : "系统管理员"}可以新增成员；你可以给直属下属办离职。`
            : `只有${企业版 ? "负责设置的总管理" : "系统管理员"}可以新增或停用成员，你可以在此查看团队构成。`}
        />
      )}
      {isAdmin && (
        <Button
          type="primary"
          icon={<PlusOutlined />}
          style={{ marginBottom: 14 }}
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          新增成员
        </Button>
      )}
      {能批量 && 勾了.length > 0 && (
        <Button danger icon={<StopOutlined />} style={{ marginBottom: 14, marginLeft: isAdmin ? 8 : 0 }} loading={清点中 === "批量"} onClick={onBatchDeactivate}>
          批量停用（{勾了.length}）
        </Button>
      )}
      <Table<Row>
        rowKey="id"
        className="member-table"
        rowSelection={能批量 ? {
          selectedRowKeys: 勾了,
          onChange: (keys) => set勾了(keys as string[]),
          getCheckboxProps: (r) => ({ disabled: !能停(r) }),
        } : undefined}
        size="middle"
        dataSource={users}
        columns={columns}
        pagination={false}
        // 按列宽排、窄了横滚：不给的话长名字按全长把姓名列撑到 400 多，整张表伸出设置页（排版闸门 10-28）。
        // 名字在 UserCell 里自带省略号和 title；xl 以下那两列不显示，不算进宽度
        tableLayout="fixed"
        scroll={{ x: columns.reduce((和, c) => (c.responsive && !屏.xl ? 和 : 和 + (Number(c.width) || 0)), 能批量 ? 32 : 0) }}
      />

      <Modal
        open={open}
        title={editing ? `编辑成员 · ${editing.name}` : "新增成员"}
        onCancel={() => setOpen(false)}
        onOk={onOk} confirmLoading={存着}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <行 gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="姓名" rules={[{ required: true, message: "请填写姓名" }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              {/*
                两种部署，这一栏的含义不同：

                自部署版存的是**登录用户名**，不是邮箱——登录页填的就是它，
                既有账号是 admin / zhangsan / lisi。之前挂着 email 格式校验，
                导致管理员按既有惯例建「lisi」时被前端直接挡死。

                托管版存的是**邮箱**：那边登录校验的是控制面账号，账号按邮箱认，
                而且他忘了密码要用它收验证码——填用户名的话 /forgot 那条路对他是断的。
                建好之后不能改：它同时是控制面账号的标识，改一边不改另一边就对不上。

                两种都强制小写并在输入时归一，服务端登录也会 toLowerCase，
                否则填了 LiSi 会出现「我填的名字登不进去」。
              */}
              <Form.Item
                name="email"
                label={用邮箱登录 ? "登录邮箱" : "登录用户名"}
                normalize={(v?: string) => v?.trim().toLowerCase()}
                rules={
                  用邮箱登录
                    ? [
                        { required: true, message: "请填写邮箱" },
                        { type: "email" as const, message: "这个邮箱看起来不对" },
                      ]
                    : [
                        { required: true, message: "请填写登录用户名" },
                        {
                          pattern: /^[a-z0-9._-]{2,32}$/,
                          message: "只能用小写字母、数字和 . _ -，长度 2–32 位",
                        },
                      ]
                }
                extra={
                  用邮箱登录
                    ? editing?.id
                      ? "登录邮箱建好之后不能改"
                      : "他用它登录，也用它找回密码。建好之后不能改"
                    : "登录时输入的就是它，如 lisi"
                }
              >
                <Input placeholder={用邮箱登录 ? "如：lisi@qiming.com" : "如：lisi"} disabled={Boolean(用邮箱登录 && editing?.id)} />
              </Form.Item>
            </Col>
            <Col span={12}>
              {/* 职位不再填也不显示（11-01）：老数据留着不动 */}
              <Form.Item name="title" hidden>
                <Input />
              </Form.Item>
            </Col>
            {/*
              企业版新增成员当场选业务角色（11-19：原来只有「账号权限」那一栏，没有销售教练可选，要建完再去组织架构里设）。
              选项、灰掉的规则和组织架构那一格是同一个 BizRoleSelect；服务端 saveUser 按同一个 角色组合问题 再挡一遍。
              编辑已有成员不在这里改角色：组织架构那一格还连着系统管理员标记、留一位系统管理员这些守卫，只留一处改
            */}
            {新建带角色 && (
              <Col span={24}>
                <Form.Item
                  name="业务角色"
                  label="业务角色"
                  extra={
                    <>
                      能做什么只看业务角色，可多选；销售教练不兼销售类角色。部门、业务线、上级建好后在「组织架构」里设。不选 = 什么都做不了
                      {新建总管理 && (
                        <div className="member-director-note" role="note">
                          没设业务线的总管理就是系统管理员，能管设置。新建时还没设业务线，所以他建好就能管设置
                        </div>
                      )}
                    </>
                  }
                  rules={[{ validator: (_, v?: string[]) => { const 问题 = v?.length ? 角色组合问题(v) : null; return 问题 ? Promise.reject(new Error(问题)) : Promise.resolve(); } }]}
                >
                  <BizRoleSelect aria-label="业务角色" placeholder="选业务角色（如销售成员、销售教练）" allowClear />
                </Form.Item>
              </Col>
            )}
            <Col span={12}>
              <Form.Item
                name="role"
                label={按业务角色 ? "账号权限" : "角色"}
                extra={
                  按业务角色
                    ? 新建带角色
                      ? "企业版这一栏不多给权限，能做什么只看上面的业务角色。"
                      : "能做什么只看业务角色（总管理、销售管理、销售教练……在「组织架构」里设）；没设业务角色的人什么都做不了。"
                    : "销售主管与销售目前使用相同业务权限；职位仅用于展示，管理权限由角色决定。"
                }
              >
                <Select options={ROLES.map((r) => ({ value: r.value, label: r.label }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="password"
                label={editing ? "重置密码（留空不改）" : "初始密码"}
                rules={editing ? [] : [{ required: true, message: "请设置初始密码" }, { min: 8, message: "至少 8 位" }]}
              >
                <Input.Password placeholder={editing ? "留空则不修改" : "至少 8 位"} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="active" label="账号状态" valuePropName="checked">
                <Switch checkedChildren="在职" unCheckedChildren="停用" />
              </Form.Item>
            </Col>
          </行>
          {editing?.飞书已绑 && 刚解绑 !== editing.id && (
            <div className="member-feishu">
              <Typography.Text type="secondary">已绑定飞书：他用飞书登录会直接进这个账号。换了飞书号或绑错了人，解绑后下次按姓名重新认。</Typography.Text>
              {/* 解绑飞书（原型 st.member）：原来直接执行；改成原地确认，一行写明后果 */}
              <InlineConfirm
                问="解绑后他下次用飞书登录按姓名重新认"
                是="解绑"
                中性
                做={async () => {
                  set解绑中(true);
                  try {
                    const r = await 解绑飞书身份(editing.id);
                    if (!r.ok) { 就地.error(r.error); return r; }
                    set刚解绑(editing.id);
                    router.refresh();
                    return r;
                  } finally {
                    set解绑中(false);
                  }
                }}
              >
                <Button size="small" loading={解绑中}>解绑飞书</Button>
              </InlineConfirm>
            </div>
          )}
        </Form>
      </Modal>
    </>
  );
}

/**
 * 企业版停用对话框的正文（11-03 C4-4 / B7-2）：不选接手人、没有「放进公海」，照清点说清停用后名下原地不动、去哪交。
 * 别的版本停用对话框照原来（选接手人、当场转交）
 */
/** 停用确认框里的录音那一条（录音点评跟进 11-22）：有没发出的录音点评才提——停用时自动删掉、不能恢复 */
function 录音后果(数: number) {
  return 数 > 0 ? [{ 标: "录音", 级: "警" as const, 话: `还有 ${数} 条没发出的录音点评，停用时自动删掉，不能恢复` }] : [];
}

function OffboardNote({ names, 点 }: { names: string[]; 点: { 客户: number; 项目: number } }) {
  const b = useBusiness();
  const 谁 = names.length === 1 ? `「${names[0]}」` : "他们";
  return (
    <div style={{ marginTop: 12 }}>
      {names.length > 1 && (
        <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ fontSize: 13, marginBottom: 8 }}>
          {names.map((n) => `「${n}」`).join("")}
        </Typography.Paragraph>
      )}
      <Typography.Paragraph style={{ fontSize: 13, marginBottom: 8 }}>
        停用后{谁}登录不了；名下 {点.客户} 位{b.customer}{点.项目 ? `、${点.项目} 个项目` : ""}，连同商机、没做完的待办、线索、渠道，原地不动（负责人还是 TA）。
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 0 }}>
        之后由 TA 的直属上级或系统管理员在「项目 → 离职交接」里交给接手人；手上没解决的卡点先给直属上级。重新启用的话，没交走的还在 TA 名下。
      </Typography.Paragraph>
    </div>
  );
}
