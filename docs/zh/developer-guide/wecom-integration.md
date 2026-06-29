---
sidebar_position: 32
---

# 企业微信（WeCom）对接设计

本文档给出在 Wegent 平台上接入**企业微信（WeCom / 企业微信）**的设计方案，覆盖形态选型、与现有钉钉/飞书渠道架构的对应关系、分期落地计划与关键技术难点。

## 概述

Wegent 已有的 IM 渠道（钉钉、Telegram）统一通过 `backend/app/services/channels/` 下的渠道抽象层接入，采用 **Strategy + Factory + Registry** 三种模式组合。所有渠道实例由 `ChannelManager` 单例统一管理生命周期，配置存储为 `Messager` CRD（`kinds` 表，`user_id=0`）。

企业微信对接的目标是复用这套抽象，在**最小改动**下让企业微信用户能与 Wegent 智能体进行交互式、流式对话，并支持订阅完成等场景的主动通知推送。

> 现状：代码中已存在 `ChannelType.WECHAT` 枚举与 `WeChatChannelConfig` schema 占位，但**没有任何 provider / handler 实现**，与飞书一样停留在"配置占位"阶段。

## 形态选型

企业微信有四种对接形态，能力差异很大：

| 形态 | 主动推送 | 收用户消息 | 被动/流式回复 | 鉴权 | 需公网+加解密 |
|---|---|---|---|---|---|
| 群机器人 Webhook | 仅推群 | ❌ | ❌ | webhook `key` | 否 |
| 自建应用 | ✅ 指定人/部门 | ✅ | ✅（5s 内） | corpid + secret → access_token | 是（回调 + WXBizMsgCrypt + IP 白名单） |
| 智能机器人·回调模式 | 受限（仅异步回一次） | ✅ | ✅ 流式 | Token + EncodingAESKey | 是 |
| **智能机器人·长连接** | 受限 | ✅ | ✅ 流式 | BotID + 长连接 Secret（wss） | **否** |

**选型结论：**

- **交互式 AI 对话** → 采用**智能机器人·长连接模式**（`wss://openws.work.weixin.qq.com`）。它与钉钉 Stream 模式几乎一一对应——免公网回调、免消息加解密、免 IP 白名单，原生支持流式打字机效果，能最大化复用现有渠道抽象，工程成本最低。
- **无触发主动推送**（如订阅完成通知）→ 智能机器人无法做到，改用**自建应用 `message/send`**（需 access_token 缓存），或**群机器人 Webhook** 推送到群。

> ⚠️ 现有 `WeChatChannelConfig`（`corp_id` / `secret` / `agent_id` / `token` / `encoding_aes_key`）是按**自建应用回调模式**设计的。采纳长连接路线后，该 schema 需调整为长连接字段（见下文第一期）。

## 现有渠道抽象层

```
backend/app/services/channels/
├── base.py        BaseChannelProvider        # start / stop / get_status 生命周期
├── handler.py     BaseChannelHandler         # parse_message / resolve_user / send_text_reply / create_callback_info
│                  MessageContext             # 统一消息上下文（content / sender / 会话 / @ / 图片 / 文件）
├── callback.py    BaseChannelCallbackService # 流式 emit + 任务完成回调
│                  ChannelCallbackRegistry    # 回调注册表（单例）
│                  ChannelType (Enum)         # 已含 WECHAT
├── manager.py     ChannelManager             # 工厂注册表 + start_all_enabled
└── dingtalk/      service / handler / callback / emitter / sender / user_resolver
```

两条核心数据流：

- **入站交互**：平台推消息 → `parse_message()` 转 `MessageContext` → `resolve_user()` 映射 Wegent 用户 → 执行任务 → `Emitter` 流式刷新回复。
- **出站通知**：`subscription/notification_dispatcher.py` 分发订阅通知，两种通道——Messager 主动推送（如 `DingTalkRobotSender`）与外部 Webhook（如 `_send_feishu_webhook`）。

渠道管理 API（`admin/im_channels.py`）是通用的，新增渠道类型**无需改动**；敏感字段（`secret` / `token` / `encoding_aes_key` 等）由 `shared/utils/crypto.py` 自动加密存储，API 返回 `***` 掩码。

## 落地方案

### 第一期：交互式 AI 对话（智能机器人长连接）

完全对照 `dingtalk/` 目录，新建 `backend/app/services/channels/wecom/`：

| 新建文件 | 继承 / 职责 | 对照钉钉 |
|---|---|---|
| `service.py` `WeComChannelProvider` | `BaseChannelProvider`。`start()` 建立 `wss://openws.work.weixin.qq.com` 长连接，发送 `aibot_subscribe`（BotID + Secret）订阅鉴权，每 30s `ping`/`pong` 心跳，断线自动重连 | `DingTalkChannelProvider` |
| `handler.py` `WeComChannelHandler` | `BaseChannelHandler`。解析 `aibot_msg_callback` 的 **JSON**（注意：长连接是 JSON，非自建应用的 XML）→ `MessageContext`；`msgid` 去重（Redis 5min）；复用现有命令解析（`/new`、`/help` 等） | `DingTalkChannelHandler` |
| `callback.py` `WeComCallbackService` | `BaseChannelCallbackService`。模块末尾 `get_callback_registry().register(ChannelType.WECHAT, ...)` | `DingTalkCallbackService` |
| `emitter.py` `WeComStreamEmitter` | 流式回复：通过 `aibot_respond_msg` 的 `stream` 对象输出，**全量覆盖式** content（≤20480 字节），`finish` 标记结束；长连接下由我方主动推送刷新 | `StreamingResponseEmitter`（AI Card） |
| `user_resolver.py` | 企业微信 `userid` → Wegent 用户，复用 `staff_id` / `email` / `select_user` 三种映射模式 | `DingTalkUserResolver` |

需修改的现有文件（改动很小）：

1. **`manager.py`** `_register_default_providers()` —— 注册 `ChannelType.WECHAT.value` → `_create_wecom_provider`：

   ```python
   self.register_provider_factory(
       ChannelType.WECHAT.value,
       self._create_wecom_provider,
   )

   @staticmethod
   def _create_wecom_provider(channel: "ChannelLike") -> "BaseChannelProvider":
       from app.services.channels.wecom.service import WeComChannelProvider
       return WeComChannelProvider(channel)
   ```

2. **`api/endpoints/internal/callback.py`** —— `import` `wecom.callback` 模块以触发回调服务注册（对照钉钉的处理）。

3. **`schemas/im_channel.py`** —— 将 `WeChatChannelConfig` 调整为长连接字段：

   ```python
   class WeChatChannelConfig(BaseModel):
       """Configuration schema for WeChat Work (smart bot, long-connection)."""

       bot_id: str = Field(..., description="WeCom smart bot BotID")
       connection_secret: str = Field(..., description="Long-connection secret")
       user_mapping_mode: UserMappingMode = Field(default="select_user")
       user_mapping_config: Optional[Dict[str, Any]] = Field(default=None)
   ```

4. `ChannelType` 枚举与 `Literal` 已含 `wechat`，无需改动；`admin/im_channels.py` 通用，无需改动。

#### Phase 1 部署约束：单副本

> ⚠️ **第一期仅支持单副本部署。**

企业微信智能机器人长连接协议规定：**每个 Bot 同一时刻只允许存在一条 WebSocket 连接**——新连接建立后，旧连接会被平台踢掉。此外，回复总线 `wecom:reply:{bot_id}` 会向所有订阅了该 Key 的消费者广播：

- **连接争抢**：多副本各自执行 `start_all_enabled()`，每个副本都会向企业微信建立 WS 连接，平台持续踢出旧连接，导致长连接持续不稳定。
- **回复重复发送**：回复总线向所有订阅副本广播，每个副本都会将同一条回复帧写入各自的 WS（其中只有最新连接是有效的），最终导致用户收到重复消息。

**第二期计划**：引入基于 Redis 租约的单一 owner 选举——对每个 `bot_id` 仅允许一个副本持有 WS 连接，其余副本待机，实现多副本安全部署。

### 第二期：主动通知推送

- 新建 `wecom/sender.py` `WeComAppSender`：封装 `gettoken`（access_token **必须集中缓存、单点刷新**，有效期 7200s，频繁调用触发 `45009`）+ `message/send`（`markdown` / `text` / `template_card`），供 `notification_dispatcher` 的 Messager 主动推送使用。
- 在 `notification_dispatcher.py` 增加 `_send_wecom_webhook()`（对照 `_send_feishu_webhook`），支持群机器人 webhook 推送；`NotificationWebhookType` 增加 `WECOM`。

### 第三期（可选）：自建应用回调模式

面向无法使用智能机器人、或必须走入站 HTTP 回调的企业：新增入站端点 `/api/internal/wecom/callback/{channel_id}`，实现 **WXBizMsgCrypt** 公共加解密模块。

> 此路线会打破"渠道全部为出站长连接"的现有约定，引入入站 webhook 架构，**仅在确有需求时再做**。

## 关键技术难点

1. **WXBizMsgCrypt 加解密**（仅第三期需要）：
   - AES-256-**CBC**；PKCS#7 按 **32 字节块**对齐（企业微信变体，直接用标准库的 16 字节会出错）；IV 取 AESKey 前 16 字节。
   - 明文结构：`random(16字节) + msg_len(4字节, 大端) + msg + receiveid`，其中 `receiveid` 须校验等于 `corpid`。
   - 官方算法库提供 Python/Java/Go 等，但**不含 Node.js**。可抽成后端公共模块复用。
   - 第一期长连接**完全不需要**这套逻辑。

2. **access_token 缓存**（第二期）：多 Pod 并发各自刷新会互相顶号并触发频率拦截，必须用 Redis 集中缓存、单点刷新——可复用钉钉的 token 管理思路。

3. **流式回复语义差异**：钉钉 AI Card 是**增量**更新，企业微信 stream 是**全量覆盖**（先传 "1" 再传 "123"，界面显示 "123"），`emitter` 需按全量语义实现。

4. **超时约束**：智能机器人流式回复总时长，官方文档存在 6 分钟 / 10 分钟两处冲突，需实测确认；自建应用被动回复为 5s 超时、最多重试 3 次；`response_url` 仅一次性、1 小时有效。

## 工作量评估

| 阶段 | 范围 | 工作量 | 风险 |
|---|---|---|---|
| 第一期 | 智能机器人长连接交互对话 | 一套 provider（与钉钉同构） | 低，改动集中 |
| 第二期 | 主动通知推送 | token 缓存 + sender + webhook | 中 |
| 第三期 | 自建应用回调模式 | 入站端点 + WXBizMsgCrypt | 较大，引入新入站架构 |

## 参考链接

- 智能机器人·长连接：<https://developer.work.weixin.qq.com/document/path/101463>
- 智能机器人·接收消息：<https://developer.work.weixin.qq.com/document/path/100719>
- 智能机器人·被动回复：<https://developer.work.weixin.qq.com/document/path/101031>
- 获取 access_token：<https://developer.work.weixin.qq.com/document/path/91039>
- 发送应用消息 message/send：<https://developer.work.weixin.qq.com/document/path/90236>
- 加解密方案说明：<https://developer.work.weixin.qq.com/document/path/96211>
- 群机器人 / 消息推送：<https://developer.work.weixin.qq.com/document/path/91770>
