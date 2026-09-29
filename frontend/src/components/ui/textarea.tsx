import * as React from "react";
import { cn } from "@/lib/utils";
import { fieldClass } from "./input";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(fieldClass, "min-h-[76px] resize-y leading-[1.45]", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

export { Textarea };
