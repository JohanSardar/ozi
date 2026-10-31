import { lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { useFileSheet } from "./fileSheetState";

const FileSheet = lazy(() =>
  import("./FileSheet").then((module) => ({ default: module.FileSheet })),
);

export function FileSheetHost() {
  const target = useFileSheet((state) => state.target);
  const close = useFileSheet((state) => state.close);
  return target
    ? createPortal(
        <Suspense fallback={null}>
          <FileSheet
            key={`${target.name}:${target.attachment?.id ?? target.src}`}
            target={target}
            onClose={close}
          />
        </Suspense>,
        document.body,
      )
    : null;
}
