import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** "Chip" in the pipeline design. */
const badgeVariants = cva(
  "inline-flex items-center gap-[5px] whitespace-nowrap rounded-sm px-2 py-[3px] text-xs font-medium leading-tight",
  {
    variants: {
      variant: {
        default: "bg-sunk text-ink-2",
        hot: "bg-danger-soft text-danger",
        warm: "bg-warn-soft text-warn",
        cold: "bg-info-soft text-info",
        ok: "bg-ok-soft text-ok",
        over: "bg-danger-soft text-danger",
        near: "bg-warn-soft text-warn",
        brand: "bg-brand-soft text-brand-text",
        sample: "bg-sample-soft text-sample",
        stat: "border border-line bg-panel px-[9px] py-1 text-ink-2",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
