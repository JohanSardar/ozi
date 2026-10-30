import { resolvePromptLinkModelSelection } from "@t3tools/client-runtime/prompt-links";
import type { NewThreadLink } from "@t3tools/shared/promptLinks";
import { useAtomValue } from "@effect/atom-react";
import { useLocation } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import { AsyncResult } from "effect/reactivity";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { environmentPresentations } from "~/state/presentation";
import { allReachableShellsLiveAtom } from "~/state/shell";
import { Button } from "../ui/button";
import { placeLinkedPrompt } from "./linkedPrompt";

import { Atom } from "effect/reactivity";

const openedLinkKeys = new Set<string>();

export function NewThreadLinkView({ link }: { readonly link: NewThreadLink }) {
  const locationKey = useLocation({ select: (location) => location.state.__TSR_key ?? "" });
  const ready = useAtomValue(allReachableShellsLiveAtom);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const handleNewThread = useNewThreadHandler();
  const openAtom = Atom.make(
    Effect.promise(async () => {
      if (!ready) return null;
      if (openedLinkKeys.has(locationKey)) return null;
      openedLinkKeys.add(locationKey);
      try {
        const environmentId = primaryEnvironmentId;
        if (environmentId === null) throw new Error("No connected environment can start a chat.");
        const opened = await handleNewThread(environmentId, {
          replace: true,
        });
        if (opened === null) throw new Error("Could not open a chat.");
        const notes: string[] = [];
        if (link.provider !== null) {
          const providers =
            appAtomRegistry
              .get(environmentPresentations.providersByEnvironmentAtom)
              .get(environmentId) ?? [];
          const resolved = resolvePromptLinkModelSelection(providers, {
            provider: link.provider,
            model: link.model,
          });
          if (resolved !== null)
            useComposerDraftStore.getState().setModelSelection(opened.draftId, resolved.selection, {
              explicit: true,
              replaceOptions: true,
            });
          if (resolved === null || !resolved.exact)
            notes.push("The requested model is unavailable; the default model is selected.");
        }
        placeLinkedPrompt(opened.draftId, link.prompt, notes);
        return null;
      } catch (cause) {
        openedLinkKeys.delete(locationKey);
        return cause instanceof Error ? cause.message : "Could not open a chat.";
      }
    }),
  );
  const result = useAtomValue(openAtom);
  const error = AsyncResult.getOrElse(result, () => null);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6" role="status">
      <p>{error ?? "Opening chat…"}</p>
      {error ? <Button onClick={() => appAtomRegistry.refresh(openAtom)}>Try again</Button> : null}
    </div>
  );
}
