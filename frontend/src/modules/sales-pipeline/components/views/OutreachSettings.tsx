"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useImportOutreach, usersKey, useSetApprover, useUpdateSettings } from "../../api/hooks";
import { useData } from "../../context/data-context";
import { useModule } from "../../context/module-context";
import { parseTracker, type TrackerPreview } from "../../lib/outreach";
import { readXlsxSheets } from "../../lib/xlsx";
import type { OutreachImportResult } from "../../types";
import { CheckRow, Panel } from "../common";
import { ConfirmDialog } from "../dialogs/ConfirmDialog";

/** Settings → Outreach: the P1 owner, who approves drafts, and importing the tracker (admins). */
export function OutreachSettings() {
  const { api } = useModule();
  const { canAdmin, settings, team } = useData();
  const save = useUpdateSettings();
  const approver = useSetApprover();
  const users = useQuery({ queryKey: usersKey(), queryFn: () => api.listUsers?.() ?? Promise.resolve([]), enabled: !!api.listUsers });

  if (!api.listOutreach) return <Panel title="Outreach">The outreach tracker needs the server.</Panel>;
  const p1 = settings.outreach?.p1UserId ?? "";
  return (
    <>
      <Panel title="P1 contacts" sub="P1 contacts are messaged only by this person. Nobody else can paste a draft for them or tick them as sent.">
        <NativeSelect className="max-w-[280px]" value={p1} disabled={!canAdmin || save.isPending} aria-label="P1 owner"
          onChange={(e) => save.mutate({ outreach: { p1UserId: e.target.value, appSenderIds: settings.outreach?.appSenderIds ?? [] } })}>
          <option value="">Nobody yet (P1 contacts are blocked)</option>
          {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </NativeSelect>
      </Panel>

      <Panel title="Who sends Arival app messages" sub="Each from their own Arival app login, and only one of them per person. LinkedIn goes from Nikunj's personal account and email from hello@touriq.ai.">
        {team.map((m) => {
          const ids = settings.outreach?.appSenderIds ?? [];
          return (
            <CheckRow key={m.id} checked={ids.includes(m.id)} disabled={!canAdmin || save.isPending}
              onChange={(v) => save.mutate({ outreach: { p1UserId: p1, appSenderIds: v ? [...ids, m.id] : ids.filter((i) => i !== m.id) } })}>
              {m.name}
            </CheckRow>
          );
        })}
      </Panel>

      <Panel title="Who approves drafts" sub="Every message is approved before anyone sends it. Admins can always approve; nobody approves their own draft.">
        {(users.data ?? []).filter((u) => u.role !== "viewer").map((u) => (
          <CheckRow key={u.id} checked={u.role === "admin" || !!u.canApproveOutreach} disabled={!canAdmin || u.role === "admin" || approver.isPending}
            onChange={(v) => approver.mutate({ userId: u.id, canApprove: v })}>
            {u.name} <span className="text-xs text-ink-3">{u.role === "admin" ? "(admin)" : u.email}</span>
          </CheckRow>
        ))}
        {!users.data?.length && <p className="m-0 text-ink-3">No workspace users found.</p>}
      </Panel>

      {canAdmin && <ImportTracker />}
    </>
  );
}

function ImportTracker() {
  const imp = useImportOutreach();
  const file = useRef<HTMLInputElement>(null);
  const [campaign, setCampaign] = useState("Arival 2026");
  const [preview, setPreview] = useState<TrackerPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<OutreachImportResult | null>(null);

  const pick = async (f: File | undefined) => {
    setResult(null);
    if (!f) return;
    setFileName(f.name);
    try {
      setPreview(parseTracker(await readXlsxSheets(await f.arrayBuffer())));
    } catch {
      setPreview({ contacts: [], research: [], byPriority: {}, companies: 0, error: "Couldn't read that file. Use the .xlsx outreach tracker." });
    }
  };
  const withSteps = preview?.contacts.filter((c) => Object.keys(c.steps).length).length ?? 0;

  return (
    <Panel title="Import the outreach tracker" sub="The .xlsx with the Contacts and Research tabs. One deal per company (operators to Sales, booking platforms to Integrations, OTAs to Channels, agencies to Referrals; competitors to Lost). Importing again updates people instead of duplicating them. Nothing is sent to anyone.">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-ink-2">List name
          <Input className="mt-1 w-[180px]" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
        </label>
        <input ref={file} type="file" accept=".xlsx" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        <Button onClick={() => file.current?.click()}>Choose the .xlsx</Button>
        {fileName && <span className="text-xs text-ink-3">{fileName}</span>}
      </div>
      {preview?.error && <p className="mt-2 text-[13px] text-danger">{preview.error}</p>}
      {preview && !preview.error && (
        <div className="mt-3 rounded-lg bg-sunk px-3 py-2 text-[13px]">
          <b>{preview.contacts.length}</b> people at <b>{preview.companies}</b> companies, research for <b>{preview.research.length}</b> companies.
          <div className="mt-1 text-ink-2">By priority: {Object.entries(preview.byPriority).map(([k, n]) => `${k} ${n}`).join(", ")}</div>
          <div className="text-ink-2">{withSteps} people already have dates in the tracker columns; those dates come across. Research comes in as not checked: someone still checks it on each website.</div>
          <Button className="mt-2.5" variant="primary" disabled={!preview.contacts.length || !campaign.trim() || imp.isPending} onClick={() => setConfirm(true)}>
            Import {preview.contacts.length} people
          </Button>
        </div>
      )}
      {result && (
        <p className="mt-2 text-[13px] text-ok">
          Done: {result.contactsCreated} people added, {result.contactsUpdated} updated, {result.companiesCreated} companies and {result.dealsCreated} deals created{result.skipped ? `, ${result.skipped} rows skipped` : ""}.
        </p>
      )}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Import ${preview?.contacts.length ?? 0} people into "${campaign}"?`}
        text="This adds them to the pipeline and the outreach list. No email or message is sent to anyone; every message still needs a check, an approval and a person to send it."
        ok="Import" onOk={() => preview && imp.mutate({ campaign: campaign.trim(), contacts: preview.contacts, research: preview.research }, {
          onSuccess: (r) => { setResult(r); setPreview(null); setFileName(""); },
        })} />
    </Panel>
  );
}
