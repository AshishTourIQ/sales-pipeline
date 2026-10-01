"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import {
  errorMessage, useAddStage, useCreateIntakeKey, useCreatePipeline, useDismissRecording, useImportHandoffs, useImportLeads, useLinkRecording,
  useRecordings, useIntakeKeys, useInviteUser, useRemoveStage,
  useResendInvite, useRevokeIntakeKey, useSamples, usersKey, useUpdatePipeline, useUpdateSettings,
} from "../../api/hooks";
import { FOLLOWUP_KEYS, LINK_KEYS, PIPELINE_TEMPLATES, RULES, TARGET_FIELDS } from "../../config/template";
import { useData } from "../../context/data-context";
import { useModule } from "../../context/module-context";
import { useUi } from "../../context/ui-context";
import { ChevronDown, Download, FileSpreadsheet, FileText } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  dealsToCsv, downloadBlob, downloadText, exportFilename, previewImport, templateCsv, templateFilename, templateXlsx, type ImportPreview,
} from "../../lib/csv";
import { readXlsx } from "../../lib/xlsx";
import { newId, nextStageOf, rawStages, stagesOf } from "../../lib/pipeline";
import type { AccessRole, FollowupKey, PhaseKey, PipelineTemplate, StageConfig, StageEdit, StageKey } from "../../types";
import { Avatar, CheckRow, Field, Grid, PHASE_COLOR, Dot } from "../common";
import { ConfirmDialog } from "../dialogs/ConfirmDialog";

function Sec({ title, text, children }: { title: string; text?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-[26px] first:mt-0">
      <h2 className="m-0 mb-1 text-base font-semibold">{title}</h2>
      {text && <p className="m-0 mb-3 text-ink-2">{text}</p>}
      {children}
    </section>
  );
}
const listBox = "rounded-xl border border-line bg-panel px-4 py-0.5 shadow-sh1";
const rowCls = "flex items-center gap-2.5 border-t border-line py-2.5 first:border-t-0";

export function SettingsView() {
  const ui = useUi();
  const tab = ui.sub.settings;
  return (
    <div className="max-w-[860px] p-3.5 tab:px-[18px] tab:pb-7 tab:pt-4 desk:px-6 desk:pb-8 desk:pt-5">
      {tab === "profile" && <ProfileTab />}
      {tab === "stages" && <StagesTab />}
      {tab === "rules" && <RulesTab />}
      {tab === "targets" && <TargetsTab />}
      {tab === "booth" && <><BoothTab /><EventCostsSection /></>}
      {tab === "integrations" && <IntegrationsTab />}
      {tab === "links" && <LinksTab />}
      {tab === "products" && <ProductsTab />}
      {tab === "data" && <DataTab />}
    </div>
  );
}

function ProfileTab() {
  const ui = useUi();
  const { currentUser, api } = useModule();
  const { team, canAdmin } = useData();
  const save = useUpdateSettings();
  const [name, setName] = useState("");
  const [pick, setPick] = useState("");
  const users = useQuery({ queryKey: usersKey(), queryFn: () => api.listUsers?.() ?? Promise.resolve([]), enabled: !!api.listUsers });
  const resend = useResendInvite();
  const pendingIds = new Set((users.data ?? []).filter((u) => u.pending).map((u) => u.id));
  const candidates = (users.data ?? []).filter((u) => !team.some((m) => m.id === u.id));
  const addUser = () => {
    const u = candidates.find((x) => x.id === pick);
    if (!u) return;
    save.mutate({ team: [...team, { id: u.id, name: u.name }] });
    setPick("");
  };
  const add = () => {
    const n = name.trim();
    if (!n || team.some((m) => m.name === n)) return;
    const id = n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || newId();
    save.mutate({ team: [...team, { id: team.some((m) => m.id === id) ? `${id}-${newId().slice(-4)}` : id, name: n }] });
    setName("");
  };
  return (
    <>
      <Sec title="You" text={currentUser ? `Signed in as ${currentUser.name}.` : "Pick your name so stage changes and notes show who made them, and your tasks come first. Saved on this device."}>
        {!currentUser && (
          <NativeSelect className="max-w-[280px]" aria-label="Your name" value={ui.meId} onChange={(e) => ui.setMeId(e.target.value)}>
            <option value="">Choose your name</option>
            {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </NativeSelect>
        )}
      </Sec>
      <Sec title="Team" text="People who own stages and tasks.">
        <div className={listBox}>
          {team.map((m) => (
            <div key={m.id} className={rowCls}>
              <Avatar name={m.name} />
              <div className="min-w-0 flex-1">{m.name}</div>
              {pendingIds.has(m.id) && <Badge title="Invited; hasn't set a password yet">Invite pending</Badge>}
              {canAdmin && pendingIds.has(m.id) && api.resendInvite && (
                <Button variant="ghost" size="xs" disabled={resend.isPending} onClick={() => resend.mutate(m.id)}>Resend</Button>
              )}
              {canAdmin && <Button variant="ghost" size="xs" onClick={() => save.mutate({ team: team.filter((x) => x.id !== m.id) })}>Remove</Button>}
            </div>
          ))}
        </div>
        {canAdmin && api.listUsers && (
          <>
            <div className="mt-2.5 flex max-w-[420px] gap-2">
              <NativeSelect aria-label="Add a person to the team" value={pick} onChange={(e) => setPick(e.target.value)} disabled={!candidates.length}>
                <option value="">{candidates.length ? "Choose a person" : "Everyone with access is on the team"}</option>
                {candidates.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </NativeSelect>
              <Button size="sm" disabled={!pick} onClick={addUser}>Add to team</Button>
            </div>
            <p className="mt-1.5 text-xs text-ink-3">People appear here once an admin gives them pipeline access.</p>
          </>
        )}
        {canAdmin && api.inviteUser && <InviteForm />}
        {canAdmin && !api.listUsers && (
          <div className="mt-2.5 flex max-w-[420px] gap-2">
            <Input placeholder="Name" aria-label="New person" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
            <Button size="sm" onClick={add}>Add person</Button>
          </div>
        )}
      </Sec>
    </>
  );
}

const PHASE_OPTIONS: readonly (readonly [Exclude<PhaseKey, "lanes">, string])[] = [["find", "Find"], ["engage", "Engage"], ["win", "Win"], ["launch", "Launch"]];

function StagesTab() {
  const { pipeline, team, canAdmin, deals } = useData();
  const update = useUpdatePipeline();
  const [name, setName] = useState(pipeline?.name ?? "");
  const [pilot, setPilot] = useState(pipeline?.pilotEnabled !== false);
  const [edits, setEdits] = useState<Record<StageKey, StageEdit>>({});
  const [removing, setRemoving] = useState<StageConfig | null>(null);
  useEffect(() => { setName(pipeline?.name ?? ""); setPilot(pipeline?.pilotEnabled !== false); setEdits({}); }, [pipeline]);
  if (!pipeline) return null;

  const rows = rawStages(pipeline);
  const nums = new Map(stagesOf(pipeline).map((s) => [s.key, s.num]));
  const hasPilot = rows.some((s) => s.key === "pilot");
  const val = <K extends keyof StageEdit>(s: StageConfig, k: K): StageEdit[K] => (edits[s.key]?.[k] ?? (s as unknown as StageEdit)[k]) as StageEdit[K];
  const setStage = (key: StageKey, e: Omit<StageEdit, "key">) => setEdits((x) => ({ ...x, [key]: { ...x[key], ...e, key } }));
  const dirty = Object.keys(edits).length > 0 || name.trim() !== pipeline.name || pilot !== (pipeline.pilotEnabled !== false);
  const save = () => update.mutate({ id: pipeline.id, patch: { name: name.trim() || pipeline.name, pilotEnabled: pilot, stages: Object.values(edits) } });
  const th = "whitespace-nowrap border-b border-line px-2 py-[7px] text-left text-xs font-semibold text-ink-2";
  const td = "border-b border-line p-2 align-middle";

  return (
    <>
      <Sec title={`${pipeline.name} stages`} text="Rename, reorder by adding and removing, and set time limits and default owners. Deals past a stage's limit are flagged; stage owners get that stage's deals.">
        <fieldset disabled={!canAdmin} className="m-0 border-0 p-0">
          <Grid className="mb-3">
            <Field id="pName" label="Pipeline name"><Input id="pName" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            {hasPilot && <CheckRow className="self-end" checked={pilot} onChange={setPilot} disabled={!canAdmin}>Use the optional Pilot stage</CheckRow>}
          </Grid>
          <div className="rounded-xl border border-line bg-panel px-3.5 py-1 shadow-sh1">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead><tr><th className={th}>Stage</th><th className={th}>Name</th><th className={th}>Phase</th><th className={th}>Max days</th><th className={th}>Default owner</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {rows.map((s) => {
                    const lane = s.key === "nurture" || s.key === "lost";
                    const phase = lane ? "lanes" : (val(s, "phase") as PhaseKey);
                    const count = deals.filter((d) => d.stage === s.key).length;
                    const num = nums.get(s.key);
                    const off = s.key === "pilot" && !pilot;
                    return (
                      <tr key={s.key} className={`[&:last-child>td]:border-b-0 ${off ? "opacity-50" : ""}`}>
                        <td className={`${td} whitespace-nowrap`}>
                          <Dot color={PHASE_COLOR[phase]} className="mr-1.5" />
                          {lane ? "Lane" : num ?? "Opt."}
                          {s.custom && <Badge className="ml-1.5" title="Added for this pipeline: no built-in automation">Custom</Badge>}
                        </td>
                        <td className={td}><Input className="min-w-[150px] px-2 py-1.5" aria-label="Stage name" value={val(s, "name") ?? ""} onChange={(e) => setStage(s.key, { name: e.target.value })} /></td>
                        <td className={td}>
                          {lane ? <span className="text-ink-3">Side lane</span> : (
                            <NativeSelect className="px-2 py-1.5" aria-label="Phase" value={phase} onChange={(e) => setStage(s.key, { phase: e.target.value as PhaseKey })}>
                              {PHASE_OPTIONS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                            </NativeSelect>
                          )}
                        </td>
                        <td className={td}>
                          <Input className="w-[84px] px-2 py-1.5" type="number" min={0} aria-label="Max days" value={val(s, "limit") ?? ""}
                            onChange={(e) => setStage(s.key, { limit: e.target.value === "" ? null : Math.max(0, parseInt(e.target.value, 10) || 0) })} />
                        </td>
                        <td className={td}>
                          <NativeSelect className="px-2 py-1.5" aria-label="Default owner" value={val(s, "ownerId") ?? ""} onChange={(e) => setStage(s.key, { ownerId: e.target.value })}>
                            <option value="">Unassigned</option>
                            {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </NativeSelect>
                        </td>
                        <td className={`${td} whitespace-nowrap text-right`}>
                          {lane ? <span className="text-xs text-ink-3">Always kept</span> : canAdmin && (
                            <Button size="xs" variant="ghost" className="text-danger hover:text-danger" onClick={() => setRemoving(s)} aria-label={`Remove stage ${s.name}`}>
                              Remove{count ? ` (${count})` : ""}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {canAdmin && <div className="mt-3"><Button variant="primary" disabled={!dirty || update.isPending} onClick={save}>Save changes</Button></div>}
        </fieldset>
      </Sec>
      {canAdmin && <AddStageForm />}
      {removing && <RemoveStageDialog stage={removing} onClose={() => setRemoving(null)} />}
    </>
  );
}

function AddStageForm() {
  const { pipeline, team, label } = useData();
  const add = useAddStage();
  const main = rawStages(pipeline).filter((s) => s.key !== "nurture" && s.key !== "lost");
  const last = main[main.length - 1];
  const [f, setF] = useState({ name: "", after: last?.key ?? "", phase: (last?.phase ?? "win") as Exclude<PhaseKey, "lanes">, limit: "", ownerId: "", description: "" });
  const [err, setErr] = useState("");
  const set = (p: Partial<typeof f>) => { setF((x) => ({ ...x, ...p })); setErr(""); };
  if (!pipeline) return null;

  const onAfter = (after: StageKey) => {
    const s = main.find((x) => x.key === after) ?? main[0];
    set({ after, phase: (s && s.phase !== "lanes" ? s.phase : "win") as Exclude<PhaseKey, "lanes">, ownerId: s?.ownerId ?? f.ownerId });
  };
  const submit = () => {
    if (!f.name.trim()) { setErr("Give the stage a name."); return; }
    add.mutate(
      { pipelineId: pipeline.id, input: { name: f.name.trim(), after: f.after, phase: f.phase, limit: f.limit === "" ? null : Math.max(0, parseInt(f.limit, 10) || 0), ownerId: f.ownerId, description: f.description.trim() } },
      { onSuccess: () => setF((x) => ({ ...x, name: "", description: "", limit: "" })) },
    );
  };

  return (
    <Sec title="Add a stage" text="New stages have no automatic tasks. Give them stage tasks (Tasks → Add task → Stage task) and deals move on from them when those are done.">
      <div className="rounded-xl border border-line bg-panel px-4 py-4 shadow-sh1">
        <Grid>
          <Field id="nsName" label="Stage name"><Input id="nsName" placeholder="Security review" value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field id="nsAfter" label="Goes after">
            <NativeSelect id="nsAfter" value={f.after} onChange={(e) => onAfter(e.target.value)}>
              <option value="">At the start</option>
              {main.map((s) => <option key={s.key} value={s.key}>{label(s.key)}</option>)}
            </NativeSelect>
          </Field>
          <Field id="nsPhase" label="Phase">
            <NativeSelect id="nsPhase" value={f.phase} onChange={(e) => set({ phase: e.target.value as Exclude<PhaseKey, "lanes"> })}>
              {PHASE_OPTIONS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </NativeSelect>
          </Field>
          <Field id="nsLimit" label="Max days (optional)"><Input id="nsLimit" type="number" min={0} value={f.limit} onChange={(e) => set({ limit: e.target.value })} /></Field>
          <Field id="nsOwner" label="Default owner">
            <NativeSelect id="nsOwner" value={f.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
              <option value="">Unassigned</option>
              {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </NativeSelect>
          </Field>
        </Grid>
        <Field id="nsDesc" label="What happens in this stage (shown in the Workflow guide)" className="mt-3">
          <Textarea id="nsDesc" rows={2} placeholder="Their IT team reviews our security pack before signing." value={f.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        {err && <div className="mt-2 text-[13px] text-danger">{err}</div>}
        <div className="mt-3"><Button variant="primary" disabled={add.isPending} onClick={submit}>Add stage</Button></div>
      </div>
    </Sec>
  );
}

function RemoveStageDialog({ stage, onClose }: { stage: StageConfig; onClose: () => void }) {
  const { pipeline, deals, label } = useData();
  const remove = useRemoveStage();
  const inStage = deals.filter((d) => d.stage === stage.key).length;
  const options = stagesOf(pipeline).filter((s) => s.key !== stage.key && s.key !== "lost");
  const defaultTarget = nextStageOf(pipeline, stage.key) ?? options.filter((s) => !s.lane).slice(-1)[0]?.key ?? "nurture";
  const [moveTo, setMoveTo] = useState<StageKey>(defaultTarget);
  const builtin = !stage.custom && !!pipeline;
  if (!pipeline) return null;
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogTitle>Remove {stage.name}?</DialogTitle>
        <DialogDescription>
          {inStage
            ? `${inStage} ${inStage === 1 ? "deal is" : "deals are"} in this stage. Choose where they go; the move is saved in their history.`
            : "No deals are in this stage right now."}
        </DialogDescription>
        {inStage > 0 && (
          <Field id="rmTo" label="Move its deals to">
            <NativeSelect id="rmTo" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              {options.map((s) => <option key={s.key} value={s.key}>{label(s.key)}</option>)}
            </NativeSelect>
          </Field>
        )}
        <ul className="m-0 mt-3 list-disc pl-5 text-[13px] text-ink-2">
          {builtin && <li>Its built-in automation stops: its automatic tasks{["s8", "pilot", "s12"].includes(stage.key) ? " and checklist" : ""} and any special step (like the demo date prompt).</li>}
          <li>Stage tasks for it are removed, and its open tasks are closed.</li>
          <li>Lead sources that started here now start at the next stage. The stages after it are renumbered.</li>
        </ul>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate({ pipelineId: pipeline.id, stageKey: stage.key, moveTo: inStage ? moveTo : "" }, { onSuccess: onClose })}>
            Remove stage
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RulesTab() {
  const { settings, canAdmin } = useData();
  const save = useUpdateSettings();
  return (
    <Sec title="Automation rules" text="When this happens, the pipeline does that. Turn a rule off to handle it by hand.">
      <div className={listBox}>
        {RULES.map(([k, when, then]) => (
          <CheckRow key={k} className="border-t border-line py-2.5 first:border-t-0" disabled={!canAdmin} checked={settings.rules[k] !== false}
            onChange={(v) => save.mutate({ rules: { ...settings.rules, [k]: v } })}>
            <b className="font-medium">{when}</b><br /><span className="text-ink-2">{then}</span>
          </CheckRow>
        ))}
      </div>
    </Sec>
  );
}

const ROLE_OPTIONS: readonly (readonly [AccessRole, string])[] = [
  ["contributor", "Contributor: works deals and tasks"], ["viewer", "Viewer: read only"], ["admin", "Admin: also sets the pipeline up"],
];

/** Admin: invite a new person by email; they get a link to set their password. */
function InviteForm() {
  const invite = useInviteUser();
  const empty = { name: "", email: "", role: "contributor" as AccessRole, salesTeam: true };
  const [f, setF] = useState(empty);
  const [err, setErr] = useState("");
  const submit = () => {
    const email = f.email.trim();
    if (!f.name.trim()) { setErr("Add their name."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr("Check the email address."); return; }
    setErr("");
    invite.mutate({ ...f, name: f.name.trim(), email }, { onSuccess: () => setF(empty), onError: (e) => setErr(errorMessage(e)) });
  };
  return (
    <div className="mt-4 rounded-xl border border-line bg-panel px-4 py-4 shadow-sh1">
      <h3 className="m-0 mb-1 text-sm font-semibold">Invite someone</h3>
      <p className="m-0 mb-3 text-[13px] text-ink-2">They get an email with a link to set their password, then sign in with their email. The link works once and expires in 7 days.</p>
      <Grid>
        <Field id="inv_name" label="Name"><Input id="inv_name" autoComplete="off" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field id="inv_email" label="Email"><Input id="inv_email" type="email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field id="inv_role" label="Access">
          <NativeSelect id="inv_role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as AccessRole })}>
            {ROLE_OPTIONS.map(([k, text]) => <option key={k} value={k}>{text}</option>)}
          </NativeSelect>
        </Field>
      </Grid>
      <CheckRow className="mt-2" checked={f.salesTeam} onChange={(salesTeam) => setF({ ...f, salesTeam })}>
        On the sales team (can own deals and tasks, and shows in the booth form&apos;s staff list)
      </CheckRow>
      {err && <div role="alert" className="mt-2 text-[13px] text-danger">{err}</div>}
      <div className="mt-3"><Button variant="primary" size="sm" disabled={invite.isPending} onClick={submit}>{invite.isPending ? "Sending…" : "Send invite"}</Button></div>
    </div>
  );
}

/** Booth form: who follows up each tier and hand-off, and how soon. */
function BoothTab() {
  const { settings, team, canAdmin } = useData();
  const save = useUpdateSettings();
  const cur = settings.boothFollowup;
  const put = (k: FollowupKey, v: Partial<{ ownerId: string; days: number }>) => save.mutate({ boothFollowup: { ...cur, [k]: { ...cur[k], ...v } } });
  const th = "whitespace-nowrap border-b border-line px-2 py-[7px] text-left text-xs font-semibold text-ink-2";
  const td = "border-b border-line p-2 align-middle";
  return (
    <Sec title="Booth follow-up" text="When a visitor is saved with the booth form, this person gets the follow-up task, due this many days later. Staff can still pick someone else on the form, and the deal's owner can be changed any time.">
      <div className="rounded-xl border border-line bg-panel px-3.5 py-1 shadow-sh1">
        <table className="w-full border-collapse text-[13px]">
          <thead><tr><th className={th}>Visitor</th><th className={th}>Follow-up owner</th><th className={th}>Due after (days)</th></tr></thead>
          <tbody>
            {FOLLOWUP_KEYS.map(([k, text]) => (
              <tr key={k} className="[&:last-child>td]:border-b-0">
                <td className={`${td} whitespace-nowrap font-medium`}>{text}</td>
                <td className={td}>
                  <NativeSelect className="px-2 py-1.5" aria-label={`${text} follow-up owner`} disabled={!canAdmin} value={cur[k]?.ownerId ?? ""} onChange={(e) => put(k, { ownerId: e.target.value })}>
                    <option value="">Nobody</option>
                    {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </NativeSelect>
                </td>
                <td className={td}>
                  <Input key={`${k}-${cur[k]?.days}`} className="w-[84px] px-2 py-1.5" type="number" min={0} max={60} aria-label={`${text} days`} disabled={!canAdmin}
                    defaultValue={cur[k]?.days ?? 0}
                    onBlur={(e) => { const v = Math.min(60, Math.max(0, parseInt(e.target.value, 10) || 0)); if (v !== cur[k]?.days) put(k, { days: v }); }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-3">Competitors and vendors / students get no follow-up. 0 days = due the same day.</p>
    </Sec>
  );
}

/** What each event cost, so Dashboard → Sources shows cost per lead, demo and signed deal. */
function EventCostsSection() {
  const { settings, deals, canAdmin } = useData();
  const save = useUpdateSettings();
  const [name, setName] = useState("");
  const costs = settings.eventCosts ?? {};
  const events = [...new Set([...Object.keys(costs).filter((k) => costs[k] != null), ...deals.map((d) => d.event).filter(Boolean)])].sort();
  const put = (ev: string, v: number | null) => save.mutate({ eventCosts: { ...costs, [ev]: v } });
  const add = () => {
    const n = name.trim();
    if (n) { put(n, costs[n] ?? 0); setName(""); }
  };
  return (
    <Sec title="Event costs" text="Everything an event cost: booth, sponsorship, travel, printing. Dashboard → Sources divides it by the leads, demos and signed deals from that event.">
      <div className={listBox}>
        {events.length ? events.map((ev) => (
          <div key={ev} className={rowCls}>
            <span className="min-w-0 flex-1 font-medium">{ev}</span>
            <Input key={`${ev}-${costs[ev] ?? ""}`} className="w-[140px] px-2 py-1.5" type="number" min={0} step="any" inputMode="decimal" placeholder="Not set"
              aria-label={`${ev} cost`} disabled={!canAdmin} defaultValue={costs[ev] ?? ""}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                const v = raw === "" ? null : Math.max(0, Number(raw) || 0);
                if (v !== (costs[ev] ?? null)) put(ev, v);
              }} />
          </div>
        )) : <p className="my-2.5 text-ink-3">No events yet. They appear here once a lead has an event.</p>}
      </div>
      {canAdmin && (
        <div className="mt-2.5 flex max-w-[480px] gap-2">
          <Input className="flex-1" placeholder="Spark 2026" aria-label="Add an event" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <Button size="sm" onClick={add}>Add event</Button>
        </div>
      )}
    </Sec>
  );
}

/** Admin: keys for the game, comparative analysis and audit tools to send leads to /intake/. */
function IntegrationsTab() {
  const { api } = useModule();
  const { canAdmin } = useData();
  const keys = useIntakeKeys(canAdmin);
  const create = useCreateIntakeKey();
  const revoke = useRevokeIntakeKey();
  const [name, setName] = useState("");
  const [shown, setShown] = useState<{ name: string; secret: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const endpoint = "POST /api/sales-pipeline/intake/";

  if (!api.listIntakeKeys) {
    return <Sec title="Integrations" text="Intake keys need the Django backend. This preview runs in the browser only." >{null}</Sec>;
  }
  if (!canAdmin) return <><Sec title="Integrations" text="Only a pipeline admin can see and create intake keys.">{null}</Sec><RecordingsSection /></>;

  const add = () => {
    const n = name.trim();
    if (!n) return;
    create.mutate(n, { onSuccess: (r) => { setShown({ name: r.key.name, secret: r.secret }); setName(""); } });
  };
  const live = (keys.data ?? []).filter((k) => k.active);
  return (
    <>
      <Sec title="Intake keys" text={<>The game, the comparative analysis and the audit tools send what a lead did to <code className="rounded bg-sunk px-1">{endpoint}</code>. Give each tool its own key, so one can be revoked without the others. The API guide for those teams is in <code className="rounded bg-sunk px-1">frontend/docs/INTAKE_API.md</code>.</>}>
        {shown && (
          <div role="status" className="mb-3 rounded-xl border border-warn-border bg-warn-soft px-4 py-3">
            <b className="block text-sm">Key for {shown.name}: copy it now</b>
            <p className="m-0 mb-2 text-[13px] text-ink-2">It isn&apos;t shown again. Send it to the tool&apos;s team privately (not in a group chat); they keep it on their server, never in a browser.</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-panel px-2 py-1.5 text-xs">{shown.secret}</code>
              <Button size="sm" onClick={() => { void navigator.clipboard?.writeText(shown.secret).then(() => toast("Key copied.")); }}>Copy</Button>
              <Button size="sm" variant="ghost" onClick={() => setShown(null)}>Done</Button>
            </div>
          </div>
        )}
        <div className={listBox}>
          {live.length ? live.map((k) => (
            <div key={k.id} className={rowCls}>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{k.name}</div>
                <div className="mt-0.5 text-xs text-ink-3">
                  Starts {k.prefix}… · created {new Date(k.createdAt).toLocaleDateString()} · {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleString()}` : "never used"}
                </div>
              </div>
              <Button variant="ghost" size="xs" className="text-danger hover:text-danger" onClick={() => setConfirm(k.id)}>Revoke</Button>
            </div>
          )) : <div className={`${rowCls} text-ink-3`}>No keys yet.</div>}
        </div>
        <div className="mt-2.5 flex max-w-[460px] gap-2">
          <Input placeholder="Pricing game" aria-label="Tool name for the new key" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <Button size="sm" disabled={!name.trim() || create.isPending} onClick={add}>Create key</Button>
        </div>
      </Sec>
      <ConnectionsSection />
      <RecordingsSection />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(v) => { if (!v) setConfirm(null); }}
        title="Revoke this key?"
        text="The tool using it stops being able to send leads straight away. Create a new key for it if needed."
        ok="Revoke key"
        danger
        onOk={() => { if (confirm) revoke.mutate(confirm); setConfirm(null); }}
      />
    </>
  );
}

/** Google Calendar and Recall: what's switched on (set in the backend .env) and the webhook URL for Recall. */
function ConnectionsSection() {
  const { settings } = useData();
  const i = settings.integrations;
  if (!i) return null;
  const Row = ({ on, title, children }: { on: boolean; title: string; children: ReactNode }) => (
    <div className={rowCls}>
      <Dot color={on ? "var(--ok)" : "var(--lanes)"} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}: {on ? "on" : "off"}</div>
        <div className="mt-0.5 text-xs text-ink-2">{children}</div>
      </div>
    </div>
  );
  return (
    <Sec title="Connections" text="Switched on in the backend's .env (see .env.example); nothing to change here.">
      <div className={listBox}>
        <Row on={i.calendar} title="Google Calendar">
          {i.calendar
            ? (i.calendarInvites ? "Demo and meeting times go on the team calendar with a Google Meet link, and the owner and contact are invited." : "Demo and meeting times go on the team calendar. Add GOOGLE_DELEGATED_USER to also send invites and create Meet links.")
            : "Set GOOGLE_SERVICE_ACCOUNT_FILE (or _JSON) and GOOGLE_CALENDAR_ID, and share the calendar with the service account."}
        </Row>
        <Row on={i.recall} title="Recall recorded calls">
          {i.recall ? (
            <>Recorded calls are logged on their deal with who was on them, plus an AI summary. In the Recall dashboard, add this webhook for <code>transcript.done</code> and <code>bot.done</code>:
              <span className="mt-1 flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-sunk px-1.5 py-0.5">{i.recallWebhookUrl}</code>
                <Button size="xs" onClick={() => { void navigator.clipboard?.writeText(i.recallWebhookUrl).then(() => toast("Webhook URL copied.")); }}>Copy</Button>
              </span>
            </>
          ) : "Set RECALL_API_KEY, RECALL_REGION and RECALL_WEBHOOK_SECRET."}
        </Row>
      </div>
    </Sec>
  );
}

/** Recorded calls no deal could be matched to: pick the deal, or dismiss. */
function RecordingsSection() {
  const { api } = useModule();
  const { settings, deals, canWrite } = useData();
  const on = !!settings.integrations?.recall && !!api.listRecordings;
  const recs = useRecordings(on);
  const link = useLinkRecording();
  const dismiss = useDismissRecording();
  const [pick, setPick] = useState<Record<string, string>>({});
  if (!on) return null;
  const list = recs.data ?? [];
  const options = [...deals].filter((d) => d.stage !== "lost").sort((a, b) => a.company.name.localeCompare(b.company.name));
  return (
    <Sec title="Recorded calls to match" text="Calls Recall recorded that couldn't be matched to a deal by the meeting link, title, email or name. Pick the deal (in this pipeline) to log it there with an AI summary.">
      <div className={listBox}>
        {list.length ? list.map((r) => (
          <div key={r.id} className={`${rowCls} flex-wrap`}>
            <div className="min-w-[200px] flex-1">
              <div className="font-medium">{r.title || "Untitled call"}</div>
              <div className="mt-0.5 text-xs text-ink-3">
                {r.startedAt ? new Date(r.startedAt).toLocaleString() : new Date(r.createdAt).toLocaleString()}
                {r.participants.length ? ` · ${r.participants.map((p) => p.name).filter(Boolean).join(", ")}` : ""}
                {r.status === "failed" ? ` · failed: ${r.error}` : ""}
              </div>
            </div>
            {canWrite && r.status === "unmatched" && (
              <>
                <NativeSelect className="w-auto max-w-[240px]" aria-label="Deal for this call" value={pick[r.id] ?? ""} onChange={(e) => setPick((x) => ({ ...x, [r.id]: e.target.value }))}>
                  <option value="">Choose the deal</option>
                  {options.map((d) => <option key={d.id} value={d.id}>{d.company.name}{d.contact.name ? ` (${d.contact.name})` : ""}</option>)}
                </NativeSelect>
                <Button size="sm" disabled={!pick[r.id] || link.isPending} onClick={() => link.mutate({ id: r.id, dealId: pick[r.id] ?? "" })}>Log it</Button>
              </>
            )}
            {canWrite && <Button size="xs" variant="ghost" onClick={() => dismiss.mutate(r.id)}>Dismiss</Button>}
          </div>
        )) : <div className={`${rowCls} text-ink-3`}>Nothing to match. Recorded calls land on their deals by themselves.</div>}
      </div>
    </Sec>
  );
}

function TargetsTab() {
  const { settings, canAdmin } = useData();
  const save = useUpdateSettings();
  return (
    <Sec title="Targets" text="Proposed numbers from the marketing plan, shown on the dashboard scoreboard.">
      <Grid>
        {TARGET_FIELDS.map(([k, lbl]) => (
          <Field key={k} id={`tg_${k}`} label={lbl}>
            <Input id={`tg_${k}`} type="number" min={0} disabled={!canAdmin} defaultValue={settings.targets[k]}
              onBlur={(e) => {
                const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                if (v !== settings.targets[k]) save.mutate({ targets: { ...settings.targets, [k]: v } });
              }} />
          </Field>
        ))}
      </Grid>
    </Sec>
  );
}

function ProductsTab() {
  const ui = useUi();
  const { pipelines, pipeline, canAdmin } = useData();
  const create = useCreatePipeline();
  const handoffs = useImportHandoffs();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<PipelineTemplate>("touriq");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const add = () => {
    const n = name.trim();
    if (!n) { ref.current?.focus(); return; }
    create.mutate({ name: n, template }, { onSuccess: (p) => { ui.setPipelineId(p.id); ui.setView("board"); } });
    setName("");
  };
  const templates = Object.entries(PIPELINE_TEMPLATES) as [PipelineTemplate, { label: string }][];
  return (
    <Sec title="Pipelines" text="Sales pipelines for each product, plus a Partnerships pipeline for booking platforms and OTAs and a Referrals pipeline for revenue managers and agencies. Each starts from its own stages.">
      <div className={listBox}>
        {pipelines.map((p) => (
          <div key={p.id} className={`${rowCls} flex-wrap`}>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{p.name}</div>
              <div className="mt-0.5 text-xs text-ink-3">{PIPELINE_TEMPLATES[p.template]?.label ?? "Sales"} · {p.dealCount ?? 0} deals</div>
            </div>
            {canAdmin && p.template !== "touriq" && (
              <Button size="sm" disabled={handoffs.isPending} onClick={() => handoffs.mutate(p.id)}
                title="Move booth partner hand-offs (Nurture, Partner hand-off) whose company type fits this pipeline">
                Bring in partner hand-offs
              </Button>
            )}
            {p.id !== pipeline?.id ? <Button size="sm" onClick={() => ui.setPipelineId(p.id)}>Open</Button> : <Badge variant="brand">Open now</Badge>}
          </div>
        ))}
      </div>
      {canAdmin && (
        <div className="mt-2.5 flex max-w-[640px] flex-wrap gap-2">
          <Input ref={ref} className="min-w-[180px] flex-1" placeholder="Partnerships" aria-label="New pipeline name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <NativeSelect className="w-auto" aria-label="Starts from" value={template} onChange={(e) => setTemplate(e.target.value as PipelineTemplate)}>
            {templates.map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
          </NativeSelect>
          <Button size="sm" onClick={add}>Add pipeline</Button>
        </div>
      )}
    </Sec>
  );
}

/** Links used in emails and AI drafts: booking link, demo deck, sample reports. */
function LinksTab() {
  const { settings, canAdmin } = useData();
  const save = useUpdateSettings();
  return (
    <Sec title="Files and links" text="Kept here once and used everywhere: AI drafts write out the booking link instead of [booking link], and the demo invite links the deck. Paste a shared link (Google Drive, Dropbox, your website).">
      <div className="grid gap-3">
        {LINK_KEYS.map(([k, label, help]) => (
          <Field key={k} id={`lk_${k}`} label={label}>
            <Input id={`lk_${k}`} key={`${k}-${settings.links?.[k] ?? ""}`} type="url" placeholder="https://" disabled={!canAdmin} defaultValue={settings.links?.[k] ?? ""}
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== (settings.links?.[k] ?? "")) save.mutate({ links: { ...settings.links, [k]: v } }); }} />
            <span className="mt-1 block text-xs text-ink-3">{help}</span>
          </Field>
        ))}
      </div>
    </Sec>
  );
}

function DataTab() {
  const ui = useUi();
  const { pipeline, deals, team, canAdmin } = useData();
  const imp = useImportLeads();
  const { load, remove } = useSamples();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState(false);
  if (!pipeline) return null;
  const hasSamples = deals.some((d) => d.sample);

  const check = async () => {
    let src: string | string[][] = text;
    if (file && /\.xls$/i.test(file.name)) { setMsg("Old .xls files can't be read. In Excel, use Save As → Excel Workbook (.xlsx) or CSV."); setPreview(null); return; }
    if (file && /\.xlsx$/i.test(file.name)) {
      try {
        src = await readXlsx(await file.arrayBuffer());
      } catch {
        setMsg("Couldn't read that Excel file. Save it as .xlsx or CSV and try again."); setPreview(null); return;
      }
    } else if (file) src = await file.text();
    if (typeof src === "string" ? !src.trim() : !src.length) { setMsg("Choose a CSV or Excel file, or paste the rows first."); setPreview(null); return; }
    const existing = new Set(deals.map((d) => d.company.name.toLowerCase()));
    const p = previewImport(src, existing, pipeline);
    setPreview(p);
    if (p.error) { setMsg(p.error); return; }
    const n = p.rows.length;
    setMsg(`Found ${n} ${n === 1 ? "lead" : "leads"}${p.skippedExamples ? `, skipped ${p.skippedExamples} example row${p.skippedExamples > 1 ? "s" : ""}` : ""}${p.duplicates ? `. ${p.duplicates} already in the pipeline will be skipped` : ""}.`);
  };
  const canImport = preview && !preview.error && preview.rows.length - preview.duplicates > 0;

  return (
    <>
      <Sec title="Import the Lead Tracker" text="Download the template, fill in one lead per row, then choose the file here. The Lead Tracker Excel file (.xlsx) or a CSV of it works too, or paste its rows (with the header row) below. Example rows are skipped.">
        {canAdmin && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="file" accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="max-w-[420px]" aria-label="Excel or CSV file" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button><Download />Template<ChevronDown className="-mr-1 text-ink-3" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[280px]">
                  <DropdownMenuItem onSelect={() => downloadBlob(templateFilename(pipeline, "xlsx"), templateXlsx(pipeline, team))}>
                    <FileSpreadsheet />
                    <span><span className="block font-medium">Excel template (.xlsx)</span><span className="block text-xs text-ink-2">Drop-down lists for stage, owner, source and more</span></span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => downloadText(templateFilename(pipeline, "csv"), templateCsv(pipeline, team))}>
                    <FileText />
                    <span><span className="block font-medium">CSV template (.csv)</span><span className="block text-xs text-ink-2">Just the columns and an example row</span></span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Textarea rows={4} className="mt-2" placeholder="Or paste rows here" aria-label="Paste rows" value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} />
            <div className="mt-1.5 text-[13px] text-ink-2" aria-live="polite">{msg}</div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => void check()}>Check the rows</Button>
              {canImport && (
                <Button size="sm" variant="primary" disabled={imp.isPending} onClick={() => imp.mutate({ pipelineId: pipeline.id, rows: preview.rows }, { onSuccess: () => { setPreview(null); setText(""); setMsg(""); } })}>
                  Import
                </Button>
              )}
            </div>
          </>
        )}
      </Sec>
      <Sec title="Export" text={`Download every ${pipeline.name} deal as a CSV file.`}>
        <Button size="sm" onClick={() => downloadText(exportFilename(pipeline), dealsToCsv(deals, pipeline, team))}>Export CSV</Button>
      </Sec>
      <Sec title="Sample deals" text="Load clearly marked sample deals across every stage to try the pipeline, then remove them in one click.">
        {canAdmin && (hasSamples ? (
          <Button size="sm" onClick={() => setConfirm(true)}>Remove sample deals</Button>
        ) : (
          <Button size="sm" disabled={load.isPending} onClick={() => load.mutate(pipeline.id, { onSuccess: () => ui.setView("board", "all") })}>Load sample deals</Button>
        ))}
        <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Remove sample deals?" text="This deletes every deal marked Sample and its tasks. Your real deals stay as they are." ok="Remove sample deals" danger onOk={() => remove.mutate(pipeline.id)} />
      </Sec>
    </>
  );
}
