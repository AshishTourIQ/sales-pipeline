import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium leading-tight transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-line-2 bg-panel text-ink shadow-sh1 hover:border-ink-3",
        primary: "border-brand bg-brand text-white shadow-sh1 hover:border-brand-press hover:bg-brand-press",
        ghost: "border-transparent bg-transparent text-ink-2 shadow-none hover:bg-hover hover:text-ink",
        danger: "border-line-2 bg-panel text-danger shadow-sh1 hover:border-danger",
      },
      size: {
        default: "px-3 py-[7px] text-sm",
        sm: "px-2.5 py-[5px] text-[13px]",
        xs: "px-2 py-[3px] text-xs",
        icon: "size-8 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} type={asChild ? undefined : (type ?? "button")} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
