import * as React from "react";
import { cn } from "@/lib/utils";

export const fieldClass =
  "w-full min-w-0 rounded-md border border-line-2 bg-panel px-2.5 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand-soft disabled:cursor-not-allowed disabled:opacity-60";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => <input ref={ref} type={type} className={cn(fieldClass, className)} {...props} />,
);
Input.displayName = "Input";

export { Input };
