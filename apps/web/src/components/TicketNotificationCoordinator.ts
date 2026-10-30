import type { TicketId } from "@t3tools/contracts";
import { AsyncResult, type AtomRegistry } from "effect/reactivity";

import { getClientSettings, subscribeClientSettings } from "../hooks/useSettings";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { ticketList, useInboxStore } from "../state/tickets";
import { setNotificationBadge } from "../threadNotifications";
import { orderTickets } from "./inbox/InboxPanel";

export function startTicketNotifications(registry: AtomRegistry.AtomRegistry): () => void {
  let count = 0;
  let known: Set<TicketId> | null = null;
  let stopTickets = () => {};
  const badge = () => setNotificationBadge(getClientSettings().ticketBadgeEnabled ? count : 0);

  const watch = () => {
    stopTickets();
    known = null;
    count = 0;
    badge();
    const environmentId = registry.get(primaryEnvironmentIdAtom);
    if (!environmentId) return;
    stopTickets = registry.subscribe(
      ticketList({ environmentId, input: {} }),
      (result) => {
        const tickets = AsyncResult.getOrElse(result, () => null)?.tickets;
        if (!tickets) return;
        count = tickets.length;
        badge();
        const previous = known;
        const fresh = previous ? tickets.filter((ticket) => !previous.has(ticket.id)) : [];
        known = new Set(tickets.map((ticket) => ticket.id));
        if (
          !getClientSettings().ticketNotificationsEnabled ||
          (document.visibilityState === "visible" && document.hasFocus()) ||
          typeof Notification === "undefined" ||
          Notification.permission !== "granted"
        )
          return;
        for (const ticket of fresh) {
          try {
            const notification = new Notification(ticket.title, {
              body: ticket.need,
              tag: ticket.id,
              silent: true,
            });
            notification.addEventListener("click", () => {
              notification.close();
              window.focus();
              void window.desktopBridge?.revealWindow().catch(() => undefined);
              const ordered = orderTickets(tickets);
              useInboxStore.setState({
                tab: "inbox",
                selected: {
                  id: ticket.id,
                  index: ordered.findIndex(({ id }) => id === ticket.id),
                  reveal: true,
                },
              });
            });
          } catch {}
        }
      },
      { immediate: true },
    );
  };

  const stopSettings = subscribeClientSettings(badge);
  const stopEnvironment = registry.subscribe(primaryEnvironmentIdAtom, watch);
  watch();
  return () => {
    stopSettings();
    stopEnvironment();
    stopTickets();
  };
}
