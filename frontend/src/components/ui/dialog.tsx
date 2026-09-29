"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogPortal = DialogPrimitive.Portal;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={cn("fixed inset-0 z-50 bg-[rgba(18,21,27,.38)]", className)} {...props} />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/** Centered modal; full screen on phones. Footer sticks to the bottom. */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 flex flex-col overflow-auto bg-panel shadow-sh3 focus:outline-none",
        "inset-0 rounded-none px-[22px] pt-[22px]",
        "min-[700px]:inset-auto min-[700px]:left-1/2 min-[700px]:top-1/2 min-[700px]:max-h-[calc(100dvh-32px)] min-[700px]:w-[min(640px,calc(100vw-32px))] min-[700px]:-translate-x-1/2 min-[700px]:-translate-y-1/2 min-[700px]:rounded-2xl",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("m-0 mb-1 text-[19px] font-semibold tracking-[-.01em]", className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("m-0 mb-4 text-ink-2", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "sticky bottom-0 -mx-[22px] mt-auto flex flex-wrap justify-end gap-2 border-t border-line bg-panel px-[22px] py-3 [margin-top:20px]",
        className,
      )}
      {...props}
    />
  );
}

export { Dialog, DialogTrigger, DialogClose, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogFooter };
