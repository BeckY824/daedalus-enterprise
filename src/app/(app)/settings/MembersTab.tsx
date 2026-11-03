"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Table, Button, Space, Tag, Modal, Form, Input, Select, Switch, Row as 行, Col, App, Alert, Typography, Grid, Popover, Checkbox } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, EditOutlined, StopOutlined, UndoOutlined } from "@ant-design/icons";
import { UserCell } from "@/components/ui";
import { ROLES } from "@/lib/constants";
import { useBusiness } from "@/lib/business-client";
import { 外贸订单 } from "@/lib/business-config";
import type { SessionUser } from "@/lib/auth";
import { saveUser, deactivateUser, reactivateUser, 停用清点, 批量停用, 解绑飞书身份 } from "./actions";
import { 设不管设置 } from "./org-actions";
import { 按阶段说, 三阶段 } from "@/lib/project/member-count";
import { 角色名, type 业务角色 } from "@/lib/sync/dept-policy";

/** 设置 · 团队成员：谁能进、谁是管理员。新增、编辑、停用（停用要先把名下的客户转交出去） */

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
  followCount: number;
  /** 企业版飞书登录：第一次用飞书登录时按姓名绑上了飞书身份 */
  飞书已绑?: boolean;
};

/** 管人的红、带团队的蓝，其余默认灰——跟账号角色那套颜色同一个意思 */
const 业务角色色: Record<业务角色, string | undefined> = {
  director: "red", admin: "red", sales_mgr: "blue", marketing_mgr: "blue",
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
  const { message, modal } = App.useApp();
  const b = useBusiness();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [解绑中, set解绑中] = useState(false);
  // 解绑后这一行就收起；不改 editing——改了会触发上面的回填，把弹窗里没保存的改动冲掉
  const [刚解绑, set刚解绑] = useState<string | null>(null);
  const [恢复中, set恢复中] = useState<string | null>(null);
  const [form] = Form.useForm();
  const 按业务角色 = users.some((u) => u.业务角色);
  const [改不管设置中, set改不管设置中] = useState<string | null>(null);
  /** 勾 / 取消「不管设置」：只有能改组织架构的总管理（服务端 org-actions 设不管设置 再拦一遍、保至少一位能管设置的总管理） */
  const on不管设置 = async (r: Row, on: boolean) => {
    if (改不管设置中) return;
    set改不管设置中(r.id);
    try {
      const res = await 设不管设置(r.id, on);
      if (!res.ok) message.error(res.error ?? "没改成，请稍后再试");
      else {
        message.success(on ? `${r.name} 不再管设置` : `${r.name} 又能管设置了`);
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
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    const 提交 = (force?: boolean) => saveUser({ id: editing?.id, ...v, force });

    const res = await 提交();
    if (res.ok) {
      message.success(editing ? "已保存" : "成员已创建");
      setOpen(false);
      router.refresh();
      return;
    }
    if ("error" in res) {
      message.error(res.error);
      return;
    }

    /**
     * 同名不硬拦：同名同事是正常情况，拦下来管理员就建不了人。
     * 但要让他知道系统里已经有一个，避免把「张三」错建成第二条而不自知。
     */
    const 同名 = res.duplicateName;
    modal.confirm({
      title: "已有同名成员",
      content: (
        <>
          <div>
            系统里已有一位<b>{同名.name}</b>
，{用邮箱登录 ? "登录邮箱" : "登录用户名"} <b>{同名.email}</b>。
          </div>
          <div style={{ marginTop: 8 }}>
            如果这是另一个人，可以继续创建，各处负责人下拉会自动带上登录名区分；
            如果是同一个人，请点取消。
          </div>
        </>
      ),
      okText: "确实是另一个人，继续创建",
      cancelText: "取消",
      async onOk() {
        const again = await 提交(true);
        if (again.ok) {
          message.success(editing ? "已保存" : "成员已创建");
          setOpen(false);
          router.refresh();
        } else if ("error" in again) {
          message.error(again.error);
        }
      },
    });
  }

  const [清点中, set清点中] = useState<string | null>(null);
  // 停用对话框：选了接手人才能点确认（11-03 C4-3），选的时候回头改确认按钮
  const 停用框 = useRef<ReturnType<typeof modal.confirm> | null>(null);
  // 接手人同负责人候选（11-03 完成度 C3-1，lib/enterprise/permissions.ts 能当负责人）：企业版要有业务角色、不是只读管理员
  const 能接手 = (u: Row) => u.active && (!企业版 || (!!u.业务角色?.length && (!u.业务角色.includes("admin") || u.业务角色.includes("director"))));
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
      message.error(坏 && "error" in 坏 ? 坏.error : "清点没成功，刷新再试");
      return;
    }
    const 合 = 各.reduce((和, x) => (x && x.ok ? { 客户: 和.客户 + x.原地.客户, 项目: 和.项目 + x.原地.项目 } : 和), { 客户: 0, 项目: 0 });
    modal.confirm({
      title: `停用 ${们.length} 位成员`,
      width: 480,
      content: <OffboardNote names={们.map((id) => users.find((u) => u.id === id)?.name ?? "")} 点={合} />,
      okText: "确认停用",
      okButtonProps: { danger: true },
      cancelText: "取消",
      async onOk() {
        const res = await 批量停用(们, "").catch(() => null);
        if (!res) { message.error("停用没成功，刷新再试"); return; }
        if (!res.ok) { message.error(res.error); return; }
        if (res.失败.length) {
          const 名 = (id: string) => users.find((u) => u.id === id)?.name ?? id;
          message.warning(`停用了 ${res.停了} 位；${res.失败.map((f) => `「${名(f.id)}」${f.error}`).join("；")}`);
        } else message.success(`已停用 ${res.停了} 位成员，名下的到「项目 → 离职交接」里交给接手人`);
        set勾了([]);
        router.refresh();
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
        message.error(清 && "error" in 清 ? 清.error : "清点没成功，刷新再试");
        return;
      }
      modal.confirm({
        title: `停用成员「${r.name}」`,
        width: 480,
        content: <OffboardNote names={[r.name]} 点={清.原地} />,
        okText: "确认停用",
        okButtonProps: { danger: true },
        cancelText: "取消",
        async onOk() {
          const res = await deactivateUser(r.id, "");
          if (res.ok) {
            message.success("已停用，名下的到「项目 → 离职交接」里交给接手人");
            router.refresh();
          } else message.error(res.error);
        },
      });
      return;
    }
    const others = users.filter((u) => 能接手(u) && u.id !== r.id);
    if (!others.length) {
      message.error("没有可接手的成员");
      return;
    }
    // 接手人默认空、必须选（11-03 C4-3）
    let target = "";
    const 可确认 = () => 停用框.current?.update({ okButtonProps: { danger: true, disabled: !target } });
    停用框.current = modal.confirm({
      title: `停用成员「${r.name}」`,
      width: 480,
      content: (
        <div style={{ marginTop: 12 }}>
          {/* 说清转交的是往后要跟的活、历史业绩不动（排查 B2）。原来只写「名下 N 个客户、N 个商机」，叫法还写死成「客户」 */}
          <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 8 }}>
            {r.customerCount} 位{b.customer}，连同进行中的商机、没做完的计划和待办、线索、渠道，一起转交给：
          </Typography.Paragraph>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="选接手人"
            style={{ width: "100%" }}
            onChange={(v: string) => { target = v; 可确认(); }}
            options={others.map((u) => ({ value: u.id, label: u.name }))}
          />
          <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}>
            {外贸订单(b) ? "已经下的订单、转了订单和丢单的商机" : "已经签下的业绩、赢单和丢单的商机"}，还算在「{r.name}」头上。
          </Typography.Paragraph>
        </div>
      ),
      okText: "确认停用",
      okButtonProps: { danger: true, disabled: true },
      cancelText: "取消",
      async onOk() {
        if (!target) { message.error("先选接手人"); return; }
        const res = await deactivateUser(r.id, target);
        if (res.ok) {
          message.success("已停用并转交");
          router.refresh();
        } else message.error(res.error);
      },
    });
  }

  const 屏 = Grid.useBreakpoint();
  const columns: ColumnsType<Row> = [
    // 姓名这一列只放姓名（11-01 用户：「系统清除掉小字。只留姓名即可」）：权限只看「角色」那一栏，
    // 职位、登录名这些小字容易被误当成权限。登录名在编辑弹窗里看；职位数据不动，只是不显示
    {
      title: "姓名",
      dataIndex: "name",
      width: 190,
      render: (v) => <UserCell name={v} size={30} />,
    },
    按业务角色
      ? {
          title: "角色",
          key: "业务角色",
          width: 120,
          render: (_: unknown, r: Row) => (
            <div className="member-roles">
              {(r.业务角色 ?? []).map((x) => (
                <Tag key={x} color={业务角色色[x]} style={{ margin: 0, borderRadius: 6 }}>
                  {角色名[x]}
                </Tag>
              ))}
              {/* 「不管设置」只对总管理有意义（11-01 C1）：能改设置的人勾，别人只看到标记 */}
              {r.业务角色?.includes("director") &&
                (企业版 && isAdmin ? (
                  <Checkbox
                    checked={!!r.不管设置}
                    disabled={改不管设置中 !== null}
                    aria-label={`${r.name} 不管设置`}
                    data-testid="member-no-settings"
                    onChange={(e) => void on不管设置(r, e.target.checked)}
                    style={{ fontSize: 12 }}
                  >
                    不管设置
                  </Checkbox>
                ) : r.不管设置 ? (
                  <Tag style={{ margin: 0, borderRadius: 6 }}>不管设置</Tag>
                ) : null)}
            </div>
          ),
        }
      : {
          title: "角色",
          dataIndex: "role",
          width: 90,
          render: (v: string) => (
            <Tag color={v === "ADMIN" ? "red" : v === "MANAGER" ? "blue" : "default"} style={{ margin: 0, borderRadius: 6 }}>
              {ROLES.find((r) => r.value === v)?.label ?? v}
            </Tag>
          ),
        },
    // 1024 宽时设置页右边只剩约 490，两个次要的数先收起，1200 以上才出（10-27）
    { title: `负责${b.customer}`, dataIndex: "customerCount", width: 80, responsive: ["xl"] },
    users.some((u) => u.项目阶段)
      ? {
          // 只摆总数，点开看各阶段（10-30）：三个数挤一格在 1366 宽时折两行
          title: "项目数",
          key: "项目数",
          width: 72,
          render: (_: unknown, r: Row) => {
            const 总 = 三阶段.reduce((a, ph) => a + (r.项目阶段?.[ph] ?? 0), 0);
            return 总 ? (
              <Popover trigger="click" content={按阶段说(r.项目阶段 ?? {})}>
                <Button type="link" size="small" style={{ padding: 0 }} aria-label={`${r.name} 的项目分阶段`}>{总}</Button>
              </Popover>
            ) : 0;
          },
        }
      : { title: "商机数", dataIndex: "oppCount", width: 80 },
    { title: "跟进数", dataIndex: "followCount", width: 70, responsive: ["xl"] },
    {
      title: "状态",
      dataIndex: "active",
      width: 84,
      render: (v) => (
        <Tag color={v ? "success" : "default"} style={{ margin: 0, borderRadius: 6 }}>
          {v ? "在职" : "已停用"}
        </Tag>
      ),
    },
    {
      title: "",
      key: "act",
      // 两个图标按钮（手机上各撑到 44，globals.css .row-act）；120 时 1366 宽下整张表比设置页宽，最右这列被截（10-30 交互规则 G）
      width: 96,
      // 行上不标红（10-30 交互规则 D）：停用要先清点、再在弹窗里确认，红色留给弹窗
      render: (_, r) =>
        !isAdmin && 能停(r) ? (
          <Button
            type="text"
            className="row-act"
            size="small"
            icon={<StopOutlined />}
            aria-label={`给 ${r.name} 办离职`}
            loading={清点中 === r.id}
            onClick={() => onDeactivate(r)}
          />
        ) : isAdmin ? (
          <Space size={2}>
            <Button
              type="text"
              className="row-act"
              size="small"
              icon={<EditOutlined />}
              aria-label={`编辑 ${r.name}`}
              onClick={() => {
                setEditing(r);
                setOpen(true);
              }}
            />
            {r.active ? (
              <Button
                type="text"
                className="row-act"
                size="small"
                icon={<StopOutlined />}
                aria-label={`停用成员 ${r.name}`}
                disabled={r.id === me.id}
                loading={清点中 === r.id}
                onClick={() => onDeactivate(r)}
              />
            ) : (
              <Button
                type="text"
                className="row-act"
                size="small"
                icon={<UndoOutlined />}
                aria-label={`恢复成员 ${r.name}`}
                loading={恢复中 === r.id}
                disabled={恢复中 !== null}
                onClick={async () => {
                  if (恢复中) return;
                  set恢复中(r.id);
                  try {
                    const result = await reactivateUser(r.id);
                    if (!result.ok) { message.error(result.error); return; }
                    message.success("已恢复");
                    router.refresh();
                  } catch {
                    message.error("恢复失败，请稍后重试");
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
            <Col span={12}>
              <Form.Item
                name="role"
                label={按业务角色 ? "账号权限" : "角色"}
                extra={
                  按业务角色
                    ? "能做什么只看业务角色（总管理、销售管理……在「组织架构」里设）；没设业务角色的人什么都做不了。"
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
              <Button
                size="small"
                loading={解绑中}
                onClick={async () => {
                  set解绑中(true);
                  try {
                    const r = await 解绑飞书身份(editing.id);
                    if (!r.ok) { message.error(r.error); return; }
                    message.success("已解绑飞书");
                    set刚解绑(editing.id);
                    router.refresh();
                  } catch {
                    message.error("解绑失败，请稍后重试");
                  } finally {
                    set解绑中(false);
                  }
                }}
              >
                解绑飞书
              </Button>
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
