import * as React from "react";
import { cn } from "@/lib/utils";
import { fieldClass } from "./input";

/** Native <select>: the right control on phones and in dense tables. */
const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(fieldClass, "pr-7", className)} {...props} />,
);
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
