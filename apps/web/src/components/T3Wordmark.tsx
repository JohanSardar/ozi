import type { SVGProps } from "react";

export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 64 40" xmlns="http://www.w3.org/2000/svg" aria-label="Ozi">
      <text
        x="0"
        y="32"
        fill="currentColor"
        fontFamily="system-ui, sans-serif"
        fontSize="38"
        fontWeight="600"
      >
        Ozi
      </text>
    </svg>
  );
}
