import { memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";

const components = {
  a: ({ children, href }: { children?: ReactNode; href?: string | undefined }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline">
      {children}
    </a>
  ),
};
const inlineComponents = {
  ...components,
  p: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
};

function ChatMarkdown({
  text,
  className,
  inline,
}: {
  text: string;
  className?: string;
  inline?: boolean;
  cwd?: string;
  threadRef?: ScopedThreadRef;
  environmentId?: EnvironmentId;
  lineBreaks?: boolean;
  parseRawHtml?: boolean;
  isStreaming?: boolean;
  imageBaseDir?: string;
  workspaceMutationId?: string | null;
  githubMedia?: boolean;
  headingLevelOffset?: number;
  onImageExpand?: (preview: never) => void;
  renderContextReference?: (reference: never) => ReactNode;
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={inline ? inlineComponents : components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(ChatMarkdown);
