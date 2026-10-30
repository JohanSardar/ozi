import { createFileRoute } from "@tanstack/react-router";

import { InboxPage } from "../components/inbox/InboxPanel";

export const Route = createFileRoute("/_chat/inbox")({
  component: InboxPage,
});
