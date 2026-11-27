import type { Bot, ChatAlert, ProductEvent } from "@rakazo/contracts";
import { chatSnoozed } from "@rakazo/core";
import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { computerUpdates } from "../../lib/computers/computer-updates";
import {
  browserNotificationKind,
  browserNotificationTag,
  deliverBrowserNotification as deliverNativeBrowserNotification,
  shouldNotifyBrowser,
} from "../../lib/platform/browser-notifications";
import { notificationIcon, prepareNotificationIcons } from "../../lib/platform/notification-icon";
import { useWebNotificationPolicy } from "../../lib/plugin-host/web-plugins";
import { followStream } from "../../lib/query/follow-stream";
import type { RpcClient } from "../../lib/query/rpc";
import { isReadChangeKind, spaceChanged } from "../../lib/query/space-changes";
import { organizationsChanged } from "../../lib/spaces/organizations";

type BrowserNoticeEvent = Pick<ProductEvent, "id" | "type" | "threadId" | "botId" | "payload"> &
  Partial<Pick<ProductEvent, "spaceId">>;

type PendingBrowserNotification = {
  event: BrowserNoticeEvent;
  botId: string;
  botName: string;
  groupId: string | undefined;
};

type SnoozableChat = { id: string; snoozedUntil?: string | null };

type ChatAlertOptions = {
  rpc: Pick<RpcClient, "notifications">;
  activeBotId: RefObject<string | undefined>;
  activeGroupId: RefObject<string | undefined>;
  openChat: (chat: Pick<ChatAlert, "botId" | "groupId">) => void;
  /** The signed-in person, whose own messages never notify them. */
  meId: string | undefined;
  /** Current groups, so a snooze that lands after a reply was queued is still honored. */
  groupsRef?: RefObject<readonly SnoozableChat[]>;
  /** The server's roster signals: one when the stream opens, then one per change. */
  roster?: RosterSignals;
};

export type RosterSignals = { changed: () => void };

/** A question still arrives while a chat is snoozed; an ordinary reply waits. */
function messageAsks(event: { type: string; payload: { blocks?: unknown } }): boolean {
  if (event.type !== "thread.message.created") return false;
  const blocks = event.payload.blocks;
  return (
    Array.isArray(blocks) &&
    blocks.some(
      (block) => !!block && typeof block === "object" && "kind" in block && block.kind === "ask",
    )
  );
}

function snoozedOrdinaryReply(
  event: { type: string; payload: { blocks?: unknown } },
  chat: SnoozableChat | undefined,
): boolean {
  return (
    event.type === "thread.message.created" &&
    !messageAsks(event) &&
    !!chat &&
    chatSnoozed(chat, Date.now())
  );
}

// A click must not reach a shell that has gone, so the shell closes what it showed.
function openChatOnClick(
  notification: Notification,
  shown: Set<Notification>,
  openChat: () => void,
) {
  shown.add(notification);
  notification.onclose = () => shown.delete(notification);
  notification.onclick = () => {
    window.focus();
    openChat();
    notification.close();
  };
}

/**
 * Finished-run notifications for the open chat, held until the browser grants permission, and
 * the server's alerts for every other chat.
 */
export function useBrowserNotifications(
  bots: Bot[],
  botsRef: RefObject<Bot[]>,
  { rpc, activeBotId, activeGroupId, openChat, meId, groupsRef, roster }: ChatAlertOptions,
) {
  const meIdRef = useRef(meId);
  meIdRef.current = meId;
  useEffect(() => prepareNotificationIcons(bots), [bots]);
  const openChatRef = useRef(openChat);
  openChatRef.current = openChat;
  const rosterRef = useRef(roster);
  rosterRef.current = roster;
  const shown = useRef(new Set<Notification>());
  const pendingAlerts = useRef(new Map<string, ChatAlert>());
  const notifiedBrowserEvents = useRef(new Set<string>());
  const pendingBrowserNotifications = useRef(new Map<string, PendingBrowserNotification>());
  const noticePolicy = useWebNotificationPolicy();
  const noticePolicyRef = useRef(noticePolicy);
  useLayoutEffect(() => {
    noticePolicyRef.current = noticePolicy;
  }, [noticePolicy]);
  const showAlert = useCallback(
    (alert: ChatAlert) => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const isOpen = alert.groupId
        ? alert.groupId === activeGroupId.current
        : !activeGroupId.current && alert.botId === activeBotId.current;
      // The open chat's own stream alerts for its replies and failures; only a takeover is missed.
      if (
        isOpen &&
        (alert.kind !== "takeover" ||
          (document.visibilityState === "visible" && document.hasFocus()))
      )
        return;
      // Match the browser's replace-by-tag behavior while account preferences load.
      const tag = `${alert.threadId}:${alert.kind}`;
      const policy = noticePolicyRef.current;
      if (!policy) {
        pendingAlerts.current.set(tag, alert);
        return;
      }
      const notice = policy({
        kind:
          alert.noticeKind ??
          (alert.kind === "completion" ? "reply" : alert.kind === "help" ? "question" : alert.kind),
        title: alert.title,
        body: alert.body,
        spaceId: alert.spaceId,
        threadId: alert.threadId,
      });
      if (!notice) return;
      try {
        const bot = botsRef.current.find((candidate) => candidate.id === alert.botId);
        const icon = bot ? notificationIcon(bot) : undefined;
        const notification = new Notification(notice.title, {
          body: notice.body,
          ...(icon ? { icon } : {}),
          ...(notice.silent ? { silent: true } : {}),
          tag,
        });
        openChatOnClick(notification, shown.current, () => openChatRef.current(alert));
      } catch {
        // Some browsers only allow notifications from a service worker.
      }
    },
    [activeBotId, activeGroupId, botsRef],
  );
  useEffect(() => {
    if (!meId) return;
    const stop = followStream(
      (signal) => rpc.notifications.subscribe(undefined, { signal }),
      (frame) => {
        if (meIdRef.current !== meId) return;
        if (frame.type === "roster") rosterRef.current?.changed();
        else if (frame.type === "organizations") void organizationsChanged();
        else if (frame.type === "computerUpdates") computerUpdates.signalled();
        else if (isReadChangeKind(frame.type)) void spaceChanged(frame.type);
        else if (frame.alert) showAlert(frame.alert);
      },
    );
    return () => {
      stop();
      pendingAlerts.current.clear();
      pendingBrowserNotifications.current.clear();
      for (const notification of shown.current) notification.close();
    };
  }, [meId, rpc, showAlert]);
  // A permission answer can arrive after the shell has gone; its held notifications go with it.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingBrowserNotifications.current.clear();
    };
  }, []);
  const chatFor = (pending: PendingBrowserNotification): SnoozableChat | undefined =>
    pending.groupId
      ? groupsRef?.current.find((group) => group.id === pending.groupId)
      : botsRef.current.find((bot) => bot.id === pending.botId);
  const deliverBrowserNotification = useCallback((pending: PendingBrowserNotification): boolean => {
    const currentBot = botsRef.current.find((bot) => bot.id === pending.botId);
    if (!currentBot || typeof Notification === "undefined") return true;
    // A reply queued while permission was pending can be snoozed before it is shown.
    if (snoozedOrdinaryReply(pending.event, chatFor(pending))) return true;
    const policy = noticePolicyRef.current;
    if (!policy) return false;
    const result = deliverNativeBrowserNotification(
      pending.event,
      currentBot.name || pending.botName,
      {
        enabled: pending.groupId !== undefined || currentBot.notifyOnFinish,
        pageVisible: document.visibilityState === "visible",
        windowFocused: document.hasFocus(),
        permission: Notification.permission,
        notifiedEventIds: notifiedBrowserEvents.current,
        show: (title, body, tag) => {
          const notice = policy({
            kind: browserNotificationKind(pending.event),
            title,
            body,
            spaceId: pending.event.spaceId,
            threadId: pending.event.threadId,
          });
          if (!notice) return;
          const icon = notificationIcon(currentBot);
          const notification = new Notification(notice.title, {
            body: notice.body,
            tag,
            ...(icon ? { icon } : {}),
            ...(notice.silent ? { silent: true } : {}),
          });
          openChatOnClick(notification, shown.current, () =>
            openChatRef.current({ botId: pending.botId, groupId: pending.groupId }),
          );
        },
      },
    );
    return result !== "pending";
  }, []);
  const flushPendingBrowserNotifications = useCallback(() => {
    if (!mounted.current) return;
    for (const [threadId, pending] of pendingBrowserNotifications.current) {
      if (deliverBrowserNotification(pending)) {
        pendingBrowserNotifications.current.delete(threadId);
      }
    }
  }, [deliverBrowserNotification]);
  useEffect(() => {
    if (!noticePolicy) return;
    const alerts = [...pendingAlerts.current.values()];
    pendingAlerts.current.clear();
    for (const alert of alerts) showAlert(alert);
    flushPendingBrowserNotifications();
  }, [noticePolicy, showAlert, flushPendingBrowserNotifications]);
  const notifyBrowserForEvent = useCallback(
    (
      event: BrowserNoticeEvent & Pick<ProductEvent, "seq">,
      subscribedThreadId: string | undefined,
      initialCursor: number,
      streamReady: boolean,
      botName: string,
      enabled: boolean,
      groupId: string | undefined,
    ) => {
      const botId = event.botId;
      if (typeof botId !== "string") return;
      const eligible = shouldNotifyBrowser(event, {
        subscribedThreadId: subscribedThreadId ?? "",
        initialCursor,
        streamReady,
        pageVisible: document.visibilityState === "visible",
        windowFocused: document.hasFocus(),
        permission: "granted",
        notifiedEventIds: notifiedBrowserEvents.current,
        meId: meIdRef.current,
      });
      if (!eligible || !enabled) return;
      const pending = {
        event,
        botId,
        botName,
        groupId,
      } satisfies PendingBrowserNotification;
      // Ordinary replies wait out a snooze. A question still comes through, and a reply that was
      // queued before the snooze is checked again when it is actually shown.
      if (snoozedOrdinaryReply(event, chatFor(pending))) return;
      if (typeof Notification === "undefined" || Notification.permission === "denied") return;
      if (Notification.permission === "default") {
        pendingBrowserNotifications.current.set(browserNotificationTag(event), pending);
        return;
      }
      if (deliverBrowserNotification(pending)) {
        pendingBrowserNotifications.current.delete(browserNotificationTag(event));
      } else {
        pendingBrowserNotifications.current.set(browserNotificationTag(event), pending);
      }
    },
    [deliverBrowserNotification],
  );
  return { notifyBrowserForEvent, flushPendingBrowserNotifications };
}
