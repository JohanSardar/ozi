import { EnvironmentId, type CalendarEventInput } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { createRoot } from "react-dom/client";
import { AppAtomRegistryProvider, appAtomRegistry } from "../../rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { readPreparedConnection } from "../../state/session";
import { CalendarWindow } from "./CalendarWindow";

const decodeEnvironmentId = Schema.decodeUnknownOption(EnvironmentId);
let dismiss: (() => void) | undefined;
export function openCalendar(event: CalendarEventInput, download: () => void) {
  dismiss?.();
  const route = Option.getOrNull(decodeEnvironmentId(location.pathname.split("/")[1]));
  const environmentId =
    route && readPreparedConnection(route) ? route : appAtomRegistry.get(primaryEnvironmentIdAtom);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
    dismiss = undefined;
  };
  dismiss = close;
  root.render(
    <AppAtomRegistryProvider>
      <CalendarWindow
        event={event}
        environmentId={environmentId}
        download={download}
        close={close}
      />
    </AppAtomRegistryProvider>,
  );
}
