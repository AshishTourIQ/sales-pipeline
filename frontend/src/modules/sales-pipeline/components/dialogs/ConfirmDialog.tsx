"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";

export function ConfirmDialog({
  open, onOpenChange, title, text, ok, danger, onOk,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  text: string;
  ok: string;
  danger?: boolean;
  onOk: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-[700px]:w-[min(520px,calc(100vw-32px))]">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{text}</DialogDescription>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={() => { onOpenChange(false); onOk(); }}>{ok}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
