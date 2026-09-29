"use client";

import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { avColor, initials } from "../lib/pipeline";
import type { PhaseKey } from "../types";

export const phaseClass = (phase: PhaseKey | undefined): string => `ph-${phase ?? "lanes"}`;
export const PHASE_COLOR: Record<PhaseKey, string> = {
  find: "var(--find)", engage: "var(--engage)", win: "var(--win)", launch: "var(--launch)", lanes: "var(--lanes)",
};

export function Avatar({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  if (!name) {
    return <span aria-hidden className={cn("inline-grid shrink-0 place-items-center rounded-full bg-line-2 text-[10px] font-semibold text-white", className)} style={{ width: size, height: size }}>?</span>;
  }
  return (
    <span
      aria-hidden
      title={name}
      className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold tracking-[.02em] text-white", className)}
      style={{ width: size, height: size, background: avColor(name), fontSize: size <= 18 ? 9 : 10 }}
    >
      {initials(name)}
    </span>
  );
}

export function Dot({ color, size = 8, className }: { color: string; size?: number; className?: string }) {
  return <span aria-hidden className={cn("inline-block shrink-0 rounded-full", className)} style={{ width: size, height: size, background: color }} />;
}

export function EmptyBox({ title, text }: { title: string; text: string }) {
  return (
    <div className="mt-3.5 rounded-xl border border-line bg-panel px-5 py-9 text-center shadow-sh1">
      <h3 className="m-0 mb-1 text-sm font-semibold">{title}</h3>
      <p className="m-0 text-ink-2">{text}</p>
    </div>
  );
}

export function Panel({ title, sub, children, className }: { title?: ReactNode; sub?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mt-3.5 rounded-xl border border-line bg-panel px-[18px] py-4 shadow-sh1", className)}>
      {title && <h3 className="m-0 mb-3 text-sm font-semibold">{title}</h3>}
      {sub && <p className="-mt-1 mb-3 text-xs text-ink-3">{sub}</p>}
      {children}
    </section>
  );
}

export function Field({ id, label, children, className }: { id: string; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export function CheckRow({
  checked, onChange, children, disabled, className, id,
}: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean; className?: string; id?: string }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-[9px] py-1", disabled && "cursor-default", className)}>
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} />
      <span>{children}</span>
    </label>
  );
}

/** Segmented control (Board / List, Hot / Warm / Cold, note type). */
export function Seg<T extends string>({
  value, onChange, options, label, className,
}: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, ReactNode])[]; label: string; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cn("inline-flex gap-0.5 rounded-[9px] bg-sunk p-[3px]", className)}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className="inline-flex items-center gap-1.5 rounded-[7px] px-3 py-[5px] font-medium text-ink-2 aria-pressed:bg-panel aria-pressed:text-ink aria-pressed:shadow-sh1 [&_svg]:size-[15px]"
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function Grid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3", className)}>{children}</div>;
}

export function Section({ title, right, children, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("border-b border-line py-4 last:border-b-0", className)}>
      {(title || right) && (
        <div className="mb-2.5 flex items-center gap-2">
          {title && <h3 className="m-0 text-sm font-semibold">{title}</h3>}
          {right && <div className="ml-auto flex gap-1.5">{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function KV({ label, value, href }: { label: string; value?: string | null; href?: string }) {
  return (
    <div>
      <span className="block text-xs text-ink-3">{label}</span>
      <b className="break-words font-medium">
        {value ? (
          href ? <a className="text-info hover:underline" href={href} target="_blank" rel="noopener noreferrer">{value}</a> : value
        ) : (
          <span className="text-ink-3">None</span>
        )}
      </b>
    </div>
  );
}

export function OptionList({ items, blank }: { items: readonly string[]; blank?: string }) {
  return (
    <>
      {blank !== undefined && <option value="">{blank}</option>}
      {items.map((v) => <option key={v} value={v}>{v}</option>)}
    </>
  );
}
