"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useSetCallType, useTransferDeal, useUpdateDeal } from "../../api/hooks";
import { CALL_TYPES, CATEGORY_TEMPLATE, LINK_KEYS } from "../../config/template";
import { useData } from "../../context/data-context";
import { useUi } from "../../context/ui-context";
import { dealInvolvement, ROLE_LABEL } from "../../lib/involvement";
import type { Deal, DealLink } from "../../types";
import { Avatar, Section } from "../common";
import { ConfirmDialog } from "../dialogs/ConfirmDialog";

const href = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

/** Second call: a demo for their team, or the commercial (pricing) call. Switching swaps the tasks. */
export function NextCallSection({ deal }: { deal: Deal }) {
  const { canWrite } = useData();
  const set = useSetCallType();
  if (deal.stage !== "s9") return null;
  return (
    <Section title="Next call">
      <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
        {CALL_TYPES.map(([k, text, sub]) => (
          <button key={k} type="button" aria-pressed={deal.callType === k} disabled={!canWrite || set.isPending}
            onClick={() => { if (deal.callType !== k) set.mutate({ dealId: deal.id, callType: k }); }}
            className="rounded-[10px] border border-line-2 bg-panel px-3 py-2.5 text-left hover:border-ink-3 disabled:cursor-default aria-pressed:border-brand aria-pressed:bg-brand-soft">
            <span className="block font-medium">{text}</span>
            <span className="block text-xs text-ink-2">{sub}</span>
          </button>
        ))}
      </div>
      <p className="m-0 mt-2 text-xs text-ink-3">After a team demo, switch to the commercial call: its tasks replace the team-demo ones.</p>
    </Section>
  );
}

/** Files for this deal (their audit report, proposal...) and the workspace ones used in emails. */
export function LinksSection({ deal }: { deal: Deal }) {
  const { canWrite, settings } = useData();
  const update = useUpdateDeal();
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const links = deal.links ?? [];
  const shared = LINK_KEYS.filter(([k]) => settings.links?.[k]);
  const save = (next: DealLink[], done?: () => void) => update.mutate({ deal, patch: { links: next } }, { onSuccess: done });
  const add = () => {
    const u = url.trim();
    if (!u) return;
    save([...links, { label: label.trim() || "Link", url: href(u) }], () => { setLabel(""); setUrl(""); toast("Link added."); });
  };
  if (!links.length && !shared.length && !canWrite) return null;
  return (
    <Section title="Files and links">
      {links.length > 0 && (
        <ul className="m-0 mb-2 list-none p-0">
          {links.map((l, i) => (
            <li key={`${l.url}${i}`} className="flex items-center gap-2 py-1">
              <a className="min-w-0 flex-1 truncate text-info hover:underline" href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>
              {canWrite && <Button size="xs" variant="ghost" onClick={() => save(links.filter((_, j) => j !== i))}>Remove</Button>}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-[160px]" placeholder="Their audit report" aria-label="Link name" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Input className="min-w-[180px] flex-1" type="url" placeholder="https://" aria-label="Link address" value={url} onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <Button size="sm" disabled={!url.trim() || update.isPending} onClick={add}>Add link</Button>
        </div>
      )}
      {shared.length > 0 && (
        <p className="m-0 mt-2 text-xs text-ink-3">
          AI drafts also use: {shared.map(([k, text], i) => (
            <span key={k}>{i ? ", " : ""}<a className="text-info hover:underline" href={settings.links[k]} target="_blank" rel="noopener noreferrer">{text.toLowerCase()}</a></span>
          ))}.
        </p>
      )}
    </Section>
  );
}

/** Who worked this deal: roles and calls attended. Commission follows involvement. */
export function InvolvementSection({ deal }: { deal: Deal }) {
  const { memberName } = useData();
  const inv = dealInvolvement(deal);
  if (!inv.people.length) return null;
  return (
    <Section title="Who's involved" right={<span className="text-xs text-ink-3">{inv.calls} call{inv.calls === 1 ? "" : "s"} and meetings so far</span>}>
      <ul className="m-0 list-none p-0">
        {inv.people.map((p) => {
          const name = memberName(p.id) || "Someone";
          const all = inv.calls > 0 && p.attended === inv.calls;
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <Avatar name={name} />
              <span className="font-medium">{name}</span>
              {p.roles.map((r) => <Badge key={r}>{ROLE_LABEL[r]}</Badge>)}
              <span className={`ml-auto text-[13px] tabular-nums ${all ? "font-medium text-ok" : "text-ink-2"}`}>
                {inv.calls ? `${p.attended} of ${inv.calls} calls${all ? ", every one" : ""}` : "No calls yet"}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="m-0 mt-1 text-xs text-ink-3">Record who was on each call in the Activity tab (Call or Meeting).</p>
    </Section>
  );
}

/** Move the deal to another pipeline (e.g. a booth partner hand-off into Partnerships). */
export function TransferControl({ deal }: { deal: Deal }) {
  const ui = useUi();
  const { pipelines, pipeline } = useData();
  const transfer = useTransferDeal();
  const others = pipelines.filter((p) => p.id !== deal.pipelineId);
  const suggested = CATEGORY_TEMPLATE[deal.company.category || "other"];
  const [target, setTarget] = useState(others.find((p) => p.template === suggested)?.id ?? others[0]?.id ?? "");
  const [confirm, setConfirm] = useState(false);
  if (!others.length) return null;
  const to = others.find((p) => p.id === target);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <NativeSelect className="w-auto" aria-label="Move to pipeline" value={target} onChange={(e) => setTarget(e.target.value)}>
        {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </NativeSelect>
      <Button size="sm" disabled={!to || transfer.isPending} onClick={() => setConfirm(true)}>Move to this pipeline</Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Move to ${to?.name ?? "the other pipeline"}?`}
        text={`${deal.company.name || "The deal"} leaves ${pipeline?.name ?? "this pipeline"} and starts at the first stage of ${to?.name ?? "the other one"}. Its history and tasks go with it; the open automatic tasks close.`}
        ok="Move deal"
        onOk={() => {
          if (!to) return;
          transfer.mutate({ deal, pipelineId: to.id }, {
            onSuccess: () => { ui.closeDeal(); toast(`Moved to ${to.name}.`, { action: { label: "Open it", onClick: () => { ui.setPipelineId(to.id); ui.openDeal(deal.id); } } }); },
          });
        }}
      />
    </div>
  );
}
