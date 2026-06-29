---
sidebar_position: 32
---

# WeCom (WeChat Work) Integration Design

This document presents the design for integrating **WeCom (WeChat Work / 企业微信)** into the Wegent platform, covering form selection, how it maps onto the existing DingTalk/Feishu channel architecture, a phased rollout plan, and key technical challenges.

## Overview

Wegent's existing IM channels (DingTalk, Telegram) are integrated through the channel abstraction layer under `backend/app/services/channels/`, combining the **Strategy + Factory + Registry** patterns. All channel instances are lifecycle-managed by the `ChannelManager` singleton, and configuration is stored as a `Messager` CRD (`kinds` table, `user_id=0`).

The goal of WeCom integration is to reuse this abstraction so that, with **minimal changes**, WeCom users can have interactive, streaming conversations with Wegent agents, with active push notifications for scenarios such as subscription completion.

> Current state: `ChannelType.WECHAT` enum and the `WeChatChannelConfig` schema placeholder already exist in the codebase, but there is **no provider/handler implementation** — like Feishu, it remains a config-only placeholder.

## Form Selection

WeCom offers four integration forms with widely differing capabilities:

| Form | Active push | Receive user msg | Passive/streaming reply | Auth | Needs public URL + crypto |
|---|---|---|---|---|---|
| Group robot webhook | Group only | ❌ | ❌ | webhook `key` | No |
| Self-built app | ✅ to user/dept | ✅ | ✅ (within 5s) | corpid + secret → access_token | Yes (callback + WXBizMsgCrypt + IP allowlist) |
| Smart bot · callback mode | Limited (one async reply) | ✅ | ✅ streaming | Token + EncodingAESKey | Yes |
| **Smart bot · long-connection** | Limited | ✅ | ✅ streaming | BotID + connection secret (wss) | **No** |

**Conclusion:**

- **Interactive AI chat** → use the **smart bot long-connection mode** (`wss://openws.work.weixin.qq.com`). It maps almost one-to-one onto DingTalk's Stream mode — no public callback URL, no message encryption, no IP allowlist, with native streaming (typewriter) support. This maximizes reuse of the existing channel abstraction at the lowest engineering cost.
- **Trigger-less active push** (e.g. subscription completion notifications) → not possible with the smart bot; use the **self-built app `message/send`** (requires access_token caching), or a **group robot webhook** to push into a group.

> ⚠️ The existing `WeChatChannelConfig` (`corp_id` / `secret` / `agent_id` / `token` / `encoding_aes_key`) was designed for the **self-built app callback mode**. After adopting the long-connection route, this schema needs to change to long-connection fields (see Phase 1).

## Existing Channel Abstraction

```
backend/app/services/channels/
├── base.py        BaseChannelProvider        # start / stop / get_status lifecycle
├── handler.py     BaseChannelHandler         # parse_message / resolve_user / send_text_reply / create_callback_info
│                  MessageContext             # unified message context (content / sender / conversation / @ / images / files)
├── callback.py    BaseChannelCallbackService # streaming emit + task-completion callback
│                  ChannelCallbackRegistry    # callback registry (singleton)
│                  ChannelType (Enum)         # already includes WECHAT
├── manager.py     ChannelManager             # factory registry + start_all_enabled
└── dingtalk/      service / handler / callback / emitter / sender / user_resolver
```

Two core data flows:

- **Inbound interaction**: platform pushes a message → `parse_message()` converts to `MessageContext` → `resolve_user()` maps to a Wegent user → task executes → `Emitter` streams the reply.
- **Outbound notification**: `subscription/notification_dispatcher.py` dispatches subscription notifications via two channels — Messager active push (e.g. `DingTalkRobotSender`) and external webhook (e.g. `_send_feishu_webhook`).

The channel management API (`admin/im_channels.py`) is generic and requires **no changes** for new channel types; sensitive fields (`secret` / `token` / `encoding_aes_key`, etc.) are auto-encrypted by `shared/utils/crypto.py` and masked with `***` in API responses.

## Implementation Plan

### Phase 1: Interactive AI Chat (Smart Bot Long-Connection)

Mirror the `dingtalk/` directory exactly under a new `backend/app/services/channels/wecom/`:

| New file | Base / responsibility | DingTalk counterpart |
|---|---|---|
| `service.py` `WeComChannelProvider` | `BaseChannelProvider`. `start()` opens the `wss://openws.work.weixin.qq.com` long connection, sends `aibot_subscribe` (BotID + secret) for subscription auth, sends `ping`/`pong` heartbeat every 30s, auto-reconnects on disconnect | `DingTalkChannelProvider` |
| `handler.py` `WeComChannelHandler` | `BaseChannelHandler`. Parses the `aibot_msg_callback` **JSON** (note: long-connection is JSON, not the self-built app's XML) → `MessageContext`; `msgid` dedup (Redis 5min); reuses existing command parsing (`/new`, `/help`, etc.) | `DingTalkChannelHandler` |
| `callback.py` `WeComCallbackService` | `BaseChannelCallbackService`. At module end: `get_callback_registry().register(ChannelType.WECHAT, ...)` | `DingTalkCallbackService` |
| `emitter.py` `WeComStreamEmitter` | Streaming reply via the `stream` object of `aibot_respond_msg`, **full-overwrite** content (≤20480 bytes), `finish` marks completion; under long-connection we proactively push refreshes | `StreamingResponseEmitter` (AI Card) |
| `user_resolver.py` | WeCom `userid` → Wegent user, reusing the `staff_id` / `email` / `select_user` mapping modes | `DingTalkUserResolver` |

Existing files to modify (very small changes):

1. **`manager.py`** `_register_default_providers()` — register `ChannelType.WECHAT.value` → `_create_wecom_provider`:

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

2. **`api/endpoints/internal/callback.py`** — `import` the `wecom.callback` module to trigger callback-service registration (mirroring DingTalk).

3. **`schemas/im_channel.py`** — change `WeChatChannelConfig` to long-connection fields:

   ```python
   class WeChatChannelConfig(BaseModel):
       """Configuration schema for WeChat Work (smart bot, long-connection)."""

       bot_id: str = Field(..., description="WeCom smart bot BotID")
       connection_secret: str = Field(..., description="Long-connection secret")
       user_mapping_mode: UserMappingMode = Field(default="select_user")
       user_mapping_config: Optional[Dict[str, Any]] = Field(default=None)
   ```

4. The `ChannelType` enum and `Literal` already include `wechat` — no change needed; `admin/im_channels.py` is generic — no change needed.

### Phase 2: Active Push Notifications

- Add `wecom/sender.py` `WeComAppSender`: wraps `gettoken` (access_token **must be centrally cached and refreshed from a single point**, valid for 7200s, frequent calls trigger `45009`) + `message/send` (`markdown` / `text` / `template_card`), for use by the `notification_dispatcher` Messager active push.
- Add `_send_wecom_webhook()` in `notification_dispatcher.py` (mirroring `_send_feishu_webhook`) to support group robot webhook push; add `WECOM` to `NotificationWebhookType`.

### Phase 3 (Optional): Self-Built App Callback Mode

For enterprises that cannot use the smart bot, or must use an inbound HTTP callback: add an inbound endpoint `/api/internal/wecom/callback/{channel_id}` and implement a shared **WXBizMsgCrypt** crypto module.

> This route breaks the existing "all channels are outbound long connections" convention and introduces an inbound webhook architecture — **do it only when genuinely needed**.

## Key Technical Challenges

1. **WXBizMsgCrypt encryption** (Phase 3 only):
   - AES-256-**CBC**; PKCS#7 padding aligned to a **32-byte block** (WeCom variant; using a standard library's 16-byte alignment will fail); IV is the first 16 bytes of AESKey.
   - Plaintext structure: `random(16 bytes) + msg_len(4 bytes, big-endian) + msg + receiveid`, where `receiveid` must be verified to equal `corpid`.
   - Official algorithm libraries are provided for Python/Java/Go, etc., but **not Node.js**. It can be extracted as a shared backend module.
   - Phase 1 long-connection does **not** need any of this.

2. **access_token caching** (Phase 2): concurrent refreshes across multiple Pods invalidate each other and trigger rate limiting — must use Redis with centralized caching and single-point refresh, reusing DingTalk's token-management approach.

3. **Streaming semantics difference**: DingTalk AI Card updates **incrementally**, whereas WeCom stream is **full-overwrite** (send "1" then "123" → UI shows "123"). The `emitter` must implement full-overwrite semantics.

4. **Timeout constraints**: the smart bot streaming total duration has a conflict between 6 minutes and 10 minutes across official docs — verify empirically; self-built app passive reply has a 5s timeout with up to 3 retries; `response_url` is single-use and valid for 1 hour.

## Effort Estimate

| Phase | Scope | Effort | Risk |
|---|---|---|---|
| Phase 1 | Smart bot long-connection interactive chat | One provider suite (isomorphic with DingTalk) | Low, changes are localized |
| Phase 2 | Active push notifications | token cache + sender + webhook | Medium |
| Phase 3 | Self-built app callback mode | Inbound endpoint + WXBizMsgCrypt | Higher, introduces a new inbound architecture |

## References

- Smart bot · long-connection: <https://developer.work.weixin.qq.com/document/path/101463>
- Smart bot · receive messages: <https://developer.work.weixin.qq.com/document/path/100719>
- Smart bot · passive reply: <https://developer.work.weixin.qq.com/document/path/101031>
- Get access_token: <https://developer.work.weixin.qq.com/document/path/91039>
- Send app message message/send: <https://developer.work.weixin.qq.com/document/path/90236>
- Encryption scheme: <https://developer.work.weixin.qq.com/document/path/96211>
- Group robot / message push: <https://developer.work.weixin.qq.com/document/path/91770>
