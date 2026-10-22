import { RefreshCwIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

const refreshIconVariants = cva("", {
  variants: {
    size: {
      xs: "size-3",
      sm: "size-3.5",
      md: "size-4",
      lg: "size-5",
    },
  },
});

export function RefreshIcon({
  refreshing = false,
  className,
  size,
  ...props
}: React.ComponentPropsWithoutRef<typeof RefreshCwIcon> &
  VariantProps<typeof refreshIconVariants> & { refreshing?: boolean }) {
  return (
    <RefreshCwIcon
      aria-hidden
      className={cn(refreshIconVariants({ size }), className)}
      {...props}
    />
  );
}
