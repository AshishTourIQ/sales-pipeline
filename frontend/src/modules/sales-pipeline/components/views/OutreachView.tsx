"use client";

import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useOutreach, useOutreachAction, usersKey } from "../../api/hooks";
import { useData } from "../../context/data-context";
import { useModule } from "../../context/module-context";
import { useUi } from "../../context/ui-context";
import { fmtDay, today } from "../../lib/dates";
import {
  CHANNEL_LABEL, CHANNELS, DRAFT_STATUS, fmtStep, PRIORITIES, PRIORITY_HINT, RESEARCH, SEND_STEP_CHANNEL, STEP_GROUPS,
  TODAY_ORDER, VERIFY,
} from "../../lib/outreach";
import type { DraftChannel, OutreachContact, OutreachDraft, OutreachPriority, OutreachStep, ReplyChannel, ResearchKey } from "../../types";
import { CheckRow, EmptyBox, Panel } from "../common";

/* ---------- who am I ---------- */

function useOutreachMe() {
  const { api } = useModule();
  const { me, canAdmin, canWrite, settings } = useData();
  const users = useQuery({ queryKey: usersKey(), queryFn: () => api.listUsers?.() ?? Promise.resolve([]), enabled: !!api.listUsers });
  const meUser = users.data?.find((u) => u.id === me?.id);
  const p1UserId = settings.outreach?.p1UserId ?? "";
  const p1Name = users.data?.find((u) => u.id === p1UserId)?.name ?? "";
  return {
    meId: me?.id ?? "",
    canWrite,
    canApprove: canWrite && (canAdmin || !!meUser?.canApprove),
    isP1Owner: !!me && me.id === p1UserId,
    isAppSender: !!me && (settings.outreach?.appSenderIds ?? []).includes(me.id),
    appSenderNames: (settings.outreach?.appSenderIds ?? []).map((id) => users.data?.find((u) => u.id === id)?.name).filter(Boolean).join(", "),
    p1Name,
    nameOf: (id: string) => users.data?.find((u) => u.id === id)?.name ?? "",
  };
}

const PRIORITY_VARIANT: Record<string, "hot" | "warm" | "cold" | "default"> = { P1: "hot", P2: "warm", P3: "cold" };

function PriorityBadge({ p }: { p: string }) {
  if (!p) return null;
  return <Badge variant={PRIORITY_VARIANT[p] ?? "default"} title={PRIORITY_HINT[p]}>{p}</Badge>;
}

function copy(text: string, what: string) {
  navigator.clipboard?.writeText(text).then(() => toast(`${what} copied.`), () => toast.error("Couldn't copy. Select the text and copy it by hand."));
}

/* ---------- the view ---------- */

export function OutreachView() {
  const ui = useUi();
  const { api } = useModule();
  const q = useOutreach();
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find((r) => r.id === openId) ?? null;
  const tab = ui.sub.outreach;

  if (!api.listOutreach) {
    return <div className="px-3.5 tab:px-[18px] desk:px-6"><EmptyBox title="Outreach needs the server" text="The outreach tracker is stored on the server. Connect the pipeline to the backend to use it." /></div>;
  }
  if (q.isLoading) return <div className="px-6 py-8 text-ink-2">Loading the outreach list…</div>;
  if (!rows.length) {
    return (
      <div className="px-3.5 tab:px-[18px] desk:px-6">
        <EmptyBox title="No one on an outreach list yet" text="An admin imports the outreach tracker (the Contacts and Research tabs) in Settings → Outreach. Nothing is sent to anyone by importing." />
      </div>
    );
  }
  return (
    <div className="px-3.5 pb-8 tab:px-[18px] desk:px-6">
      {tab === "contacts" && <ContactsTab rows={rows} onOpen={setOpenId} />}
      {tab === "approvals" && <ApprovalsTab rows={rows} onOpen={setOpenId} />}
      {tab === "send" && <SendTab rows={rows} onOpen={setOpenId} />}
      {(tab === "today" || !["contacts", "approvals", "send"].includes(tab)) && <TodayTab rows={rows} onOpen={setOpenId} />}
      <Sheet open={!!open} onOpenChange={(v) => { if (!v) setOpenId(null); }}>
        {open && <ContactPanel c={open} onClose={() => setOpenId(null)} />}
      </Sheet>
    </div>
  );
}

/** Counts for the sub-tabs. */
export function outreachTabCounts(rows: OutreachContact[]) {
  const t0 = today();
  const drafts = rows.flatMap((r) => r.drafts);
  return {
    today: rows.filter((r) => TODAY_ORDER.includes(r.next.key) && r.next.key !== "approval" && (!r.next.due || r.next.due <= t0)).length,
    approvals: drafts.filter((d) => d.status === "pending").length,
    send: drafts.filter((d) => d.status === "approved").length,
    contacts: rows.length,
  };
}

function Who({ c, onOpen }: { c: OutreachContact; onOpen: (id: string) => void }) {
  return (
    <div className="min-w-0">
      <button type="button" className="text-left font-medium text-info hover:underline" onClick={() => onOpen(c.id)}>
        {c.name || c.email || "Contact"}
      </button>
      <span className="text-ink-3"> · {c.company.name}</span>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
        <PriorityBadge p={c.priority} />
        {c.extId && <span>{c.extId}</span>}
        {c.title && <span>{c.title}</span>}
      </div>
    </div>
  );
}

/* ---------- Today ---------- */

const ASK: Partial<Record<OutreachContact["next"]["key"], ReplyChannel>> = { ask_linkedin: "linkedin", ask_email: "email", ask_app: "app" };

function TodayTab({ rows, onOpen }: { rows: OutreachContact[]; onOpen: (id: string) => void }) {
  const t0 = today();
  const reply = useOutreachAction((api, v: { id: string; channel: ReplyChannel; replied: boolean }) => api.answerReplyCheck!(v.id, v.channel, v.replied));
  const { canWrite } = useData();
  const due = rows.filter((r) => TODAY_ORDER.includes(r.next.key) && r.next.key !== "approval" && (!r.next.due || r.next.due <= t0));
  const groups = TODAY_ORDER.map((k) => [k, due.filter((r) => r.next.key === k)] as const).filter(([, l]) => l.length);
  if (!groups.length) return <EmptyBox title="Nothing due today" text="Every reply has been checked and nothing is waiting to be sent." />;
  return (
    <>
      <p className="mt-3 text-[13px] text-ink-2">
        The pipeline asks every day whether people replied. No LinkedIn reply in 2 days: write the email. No email reply in 7 days: write the follow-up. Every message is approved before it&apos;s sent, and you send it yourself.
      </p>
      {groups.map(([k, list]) => (
        <div key={k}>
          <div className="mb-2 mt-5 text-[13px] font-semibold">{list[0]!.next.label.replace(/^No .* reply in \d+ days: /, "No reply yet: ")} <span className="font-normal text-ink-3">{list.length}</span></div>
          <div className="rounded-xl border border-line bg-panel px-4 py-0.5 shadow-sh1">
            {list.map((c) => {
              const ch = ASK[c.next.key];
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-2.5 border-t border-line py-2.5 first:border-t-0">
                  <div className="min-w-0 flex-1"><Who c={c} onOpen={onOpen} /></div>
                  {c.next.due && c.next.due < t0 && <Badge variant="over">Due {fmtDay(c.next.due)}</Badge>}
                  {ch && canWrite ? (
                    <>
                      <Button size="sm" variant="primary" disabled={reply.isPending} onClick={() => reply.mutate({ id: c.id, channel: ch, replied: true })}>They replied</Button>
                      <Button size="sm" disabled={reply.isPending} onClick={() => reply.mutate({ id: c.id, channel: ch, replied: false })}>No reply yet</Button>
                    </>
                  ) : (
                    <Button size="sm" onClick={() => onOpen(c.id)}>Open</Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

/* ---------- Contacts (the tracker table) ---------- */

const NEXT_FILTERS: [string, string][] = [
  ["", "Any status"], ["verify", "Check the data"], ["write", "Write a message"], ["approval", "Waiting for approval"],
  ["send", "Ready to send"], ["wait", "Waiting for a reply"], ["book", "Replied"], ["done", "Demo booked"], ["none", "Do not contact"],
];

function ContactsTab({ rows, onOpen }: { rows: OutreachContact[]; onOpen: (id: string) => void }) {
  const [text, setText] = useState("");
  const [prio, setPrio] = useState("");
  const [next, setNext] = useState("");
  const shown = rows.filter((r) => {
    if (prio && r.priority !== prio) return false;
    if (next && !(next === "wait" ? r.next.key.startsWith("ask_") || r.next.key === "wait" : r.next.key === next)) return false;
    if (text) {
      const s = text.toLowerCase();
      if (![r.name, r.company.name, r.email, r.extId, r.title].some((v) => v.toLowerCase().includes(s))) return false;
    }
    return true;
  });
  const step = (c: OutreachContact, k: OutreachStep) => (c.steps[k] ? <span title={`${k}: ${c.steps[k]}`} className="text-ok">●</span> : <span className="text-line-2">○</span>);
  return (
    <>
      <div className="mt-3.5 flex flex-wrap gap-2">
        <Input className="w-[220px]" placeholder="Search name, company, email, ID" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search" />
        <NativeSelect className="w-auto" value={prio} onChange={(e) => setPrio(e.target.value)} aria-label="Priority">
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </NativeSelect>
        <NativeSelect className="w-auto" value={next} onChange={(e) => setNext(e.target.value)} aria-label="Status">
          {NEXT_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </NativeSelect>
        <span className="self-center text-xs text-ink-3">{shown.length} of {rows.length}</span>
      </div>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-panel shadow-sh1">
        <table className="w-full min-w-[860px] text-[13px]">
          <thead className="text-left text-xs text-ink-3">
            <tr className="border-b border-line">
              <th className="px-3 py-2 font-medium">Person</th>
              <th className="px-2 py-2 font-medium" title="Data checked on their website">Checked</th>
              <th className="px-2 py-2 font-medium" title="Connection note, message, reply, demo">LinkedIn</th>
              <th className="px-2 py-2 font-medium" title="Drafted, sent, follow-up, reply">Email</th>
              <th className="px-2 py-2 font-medium">Arival app</th>
              <th className="px-2 py-2 font-medium">Last touch</th>
              <th className="px-2 py-2 font-medium">Follow-up due</th>
              <th className="px-3 py-2 font-medium">Next</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 500).map((c) => (
              <tr key={c.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-hover" onClick={() => onOpen(c.id)}>
                <td className="px-3 py-2"><Who c={c} onOpen={onOpen} /></td>
                <td className="px-2 py-2">{c.verifiedAt && c.company.researchVerifiedAt ? <Badge variant="ok">Yes</Badge> : <span className="text-ink-3">No</span>}</td>
                <td className="px-2 py-2 tracking-[2px]">{(["li_note", "li_msg", "li_reply", "li_demo"] as OutreachStep[]).map((k) => <span key={k}>{step(c, k)}</span>)}</td>
                <td className="px-2 py-2 tracking-[2px]">{(["em_draft", "em_sent", "em_follow", "em_reply"] as OutreachStep[]).map((k) => <span key={k}>{step(c, k)}</span>)}</td>
                <td className="px-2 py-2 text-xs">{c.steps.app_sent ? c.appSenderName || "Sent" : ""}</td>
                <td className="px-2 py-2 text-xs">{fmtDay(c.lastTouch)}</td>
                <td className={`px-2 py-2 text-xs ${c.followUpDue && c.followUpDue <= today() ? "font-semibold text-danger" : ""}`}>{fmtDay(c.followUpDue)}</td>
                <td className="px-3 py-2 text-xs">{c.next.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length > 500 && <p className="m-0 px-3 py-2 text-xs text-ink-3">Showing the first 500. Search or filter to narrow it.</p>}
      </div>
    </>
  );
}

/* ---------- Approvals ---------- */

function ResearchFacts({ c }: { c: OutreachContact }) {
  const r = c.company.research;
  return (
    <div className="mt-2 rounded-lg bg-sunk px-3 py-2 text-xs text-ink-2">
      <b className="text-ink">Checked facts</b> ({c.company.researchVerifiedByName || "not checked"}):{" "}
      {[r.booking_platform && `platform ${r.booking_platform}`, r.example_tour && `tour "${r.example_tour}"`, r.listed_price && `price ${r.listed_price}`]
        .filter(Boolean).join(", ") || "none yet"}
      {r.sources && <div className="mt-1 break-all">Sources: {r.sources}</div>}
      {r.unverified && <div className="mt-1 text-warn">Not confirmed: {r.unverified}</div>}
    </div>
  );
}

function ApprovalsTab({ rows, onOpen }: { rows: OutreachContact[]; onOpen: (id: string) => void }) {
  const me = useOutreachMe();
  const items = rows.flatMap((c) => c.drafts.filter((d) => d.status === "pending").map((d) => ({ c, d })));
  if (!items.length) return <EmptyBox title="Nothing waiting for approval" text="Drafts pasted by the team show up here for an approver to check, edit and approve." />;
  return (
    <>
      <p className="mt-3 text-[13px] text-ink-2">
        {me.canApprove
          ? "Check each message against the facts (tour name, price, person), fix the English, then approve. You can't approve your own draft."
          : "Only approvers can approve. An admin can make you one in Settings → Outreach."}
      </p>
      {items.map(({ c, d }) => <ReviewCard key={d.id} c={c} d={d} onOpen={onOpen} canApprove={me.canApprove} mine={d.createdById === me.meId} by={me.nameOf(d.createdById)} />)}
    </>
  );
}

function ReviewCard({ c, d, onOpen, canApprove, mine, by }: { c: OutreachContact; d: OutreachDraft; onOpen: (id: string) => void; canApprove: boolean; mine: boolean; by: string }) {
  const [subject, setSubject] = useState(d.subject);
  const [body, setBody] = useState(d.body);
  const [note, setNote] = useState("");
  useEffect(() => { setSubject(d.subject); setBody(d.body); }, [d.subject, d.body]);
  const review = useOutreachAction((api, v: Parameters<NonNullable<typeof api.reviewDraft>>[1]) => api.reviewDraft!(d.id, v));
  const edited = subject !== d.subject || body !== d.body;
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  return (
    <Panel>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1"><Who c={c} onOpen={onOpen} /></div>
        <Badge variant="brand">{CHANNEL_LABEL[d.channel]}</Badge>
        {by && <span className="text-xs text-ink-3">pasted by {by}</span>}
      </div>
      <ResearchFacts c={c} />
      {(d.channel === "email" || d.channel === "email_follow") && (
        <Input className="mt-2.5" value={subject} disabled={!canApprove} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" placeholder="Subject" />
      )}
      <Textarea className="mt-2 min-h-[160px]" value={body} disabled={!canApprove} onChange={(e) => setBody(e.target.value)} aria-label="Message" />
      <div className="mt-1 text-xs text-ink-3">{words} words, {body.length} characters</div>
      {canApprove && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={review.isPending || mine} title={mine ? "Someone else approves your own draft" : undefined}
            onClick={() => review.mutate({ ...(edited ? { subject, body } : {}), action: "approve" })}>
            {edited ? "Save changes and approve" : "Approve"}
          </Button>
          {edited && <Button disabled={review.isPending} onClick={() => review.mutate({ subject, body })}>Save changes</Button>}
          <Input className="w-[240px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What to change (optional)" aria-label="What to change" />
          <Button disabled={review.isPending} onClick={() => review.mutate({ action: "changes", note })}>Ask for changes</Button>
        </div>
      )}
    </Panel>
  );
}

/* ---------- Ready to send ---------- */

const SEND_STEP: Record<DraftChannel, OutreachStep> = { li_note: "li_note", li_msg: "li_msg", email: "em_sent", email_follow: "em_follow", app: "app_sent" };

function SendTab({ rows, onOpen }: { rows: OutreachContact[]; onOpen: (id: string) => void }) {
  const me = useOutreachMe();
  const sent = useOutreachAction((api, v: { id: string; step: OutreachStep }) => api.setOutreachStep!(v.id, v.step, today()), "Marked as sent.");
  const items = rows.flatMap((c) => c.drafts.filter((d) => d.status === "approved").map((d) => ({ c, d })));
  if (!items.length) return <EmptyBox title="Nothing approved to send" text="Approved messages show up here. Copy each one, send it from the right account, then tick it as sent." />;
  return (
    <>
      <p className="mt-3 text-[13px] text-ink-2">
        The pipeline never sends these. Copy the message, send it yourself (LinkedIn from Nikunj&apos;s account, email from hello@touriq.ai, the Arival app from your own Arival login), then press &quot;I sent it&quot;.
      </p>
      {items.map(({ c, d }) => {
        const otherSender = d.channel === "app" && c.appSenderId && c.appSenderId !== me.meId;
        const notSender = d.channel === "app" && !me.isAppSender;
        return (
          <Panel key={d.id}>
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1"><Who c={c} onOpen={onOpen} /></div>
              <Badge variant="ok">{CHANNEL_LABEL[d.channel]}</Badge>
            </div>
            <div className="mt-1.5 text-xs text-ink-2">
              {d.channel.startsWith("email") ? <>To: <b>{c.email || "no email"}</b></> : d.channel === "app" ? "In the Arival app" : <>LinkedIn: {c.linkedin ? <a className="text-info hover:underline" href={c.linkedin.startsWith("http") ? c.linkedin : `https://${c.linkedin}`} target="_blank" rel="noreferrer">{c.linkedin}</a> : "find their profile"}</>}
            </div>
            {d.subject && <div className="mt-2 text-[13px]"><b>Subject:</b> {d.subject}</div>}
            <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-sunk px-3 py-2 font-sans text-[13px]">{d.body}</pre>
            {notSender && !otherSender && <p className="mt-2 text-xs text-danger">Arival app messages are sent only by {me.appSenderNames || "the people set in Settings → Outreach"}.</p>}
            {otherSender && <p className="mt-2 text-xs text-danger">{c.appSenderName} already messages this person in the Arival app. Only they send it.</p>}
            {c.priority === "P1" && !me.isP1Owner && <p className="mt-2 text-xs text-danger">P1: only {me.p1Name || "the P1 owner"} sends this.</p>}
            <div className="mt-2.5 flex flex-wrap gap-2">
              {d.subject && <Button size="sm" onClick={() => copy(d.subject, "Subject")}><Copy />Copy subject</Button>}
              <Button size="sm" onClick={() => copy(d.body, "Message")}><Copy />Copy message</Button>
              {me.canWrite && (
                <Button size="sm" variant="primary" disabled={sent.isPending || !!otherSender || notSender || (c.priority === "P1" && !me.isP1Owner)}
                  onClick={() => sent.mutate({ id: c.id, step: SEND_STEP[d.channel] })}>
                  I sent it
                </Button>
              )}
            </div>
          </Panel>
        );
      })}
    </>
  );
}

/* ---------- One person ---------- */

function ContactPanel({ c, onClose }: { c: OutreachContact; onClose: () => void }) {
  const ui = useUi();
  const me = useOutreachMe();
  const { canAdmin, canWrite } = useData();
  const update = useOutreachAction((api, v: Parameters<NonNullable<typeof api.updateOutreachContact>>[1]) => api.updateOutreachContact!(c.id, v));
  const [notes, setNotes] = useState(c.notes);
  const blockedP1 = c.priority === "P1" && !me.isP1Owner;
  const canMessage = canWrite && !c.doNotContact && !blockedP1;
  const verified = !!(c.verifiedAt && c.company.researchVerifiedAt);

  return (
    <SheetContent aria-describedby={undefined} onOpenAutoFocus={(e) => e.preventDefault()}>
      <div className="flex items-start gap-3 px-3.5 pt-3.5 tab:px-[22px] tab:pt-[18px]">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-ink-3">{c.campaign} outreach {c.extId && `· ${c.extId}`}</div>
          <SheetTitle className="mt-0.5 text-[21px] font-semibold leading-tight">{c.name || "Contact"}</SheetTitle>
          <SheetDescription asChild>
            <div className="mt-0.5 text-[13px] text-ink-2">
              {[c.title, c.company.name, c.country].filter(Boolean).join(" · ")}
              {c.email && <div>{c.email}</div>}
            </div>
          </SheetDescription>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {canAdmin ? (
              <NativeSelect className="w-auto py-0.5 text-xs" value={c.priority} aria-label="Priority"
                onChange={(e) => update.mutate({ priority: e.target.value as OutreachPriority })}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}: {PRIORITY_HINT[p]}</option>)}
              </NativeSelect>
            ) : <PriorityBadge p={c.priority} />}
            {c.roleType && <Badge>{c.roleType}</Badge>}
            {c.leadReview === "Yes" && <Badge variant="warm">{me.p1Name || "P1 owner"} approves drafts</Badge>}
            {c.deal && <Button size="xs" variant="ghost" onClick={() => { onClose(); ui.setPipelineId(c.deal!.pipelineId); ui.setView("board"); ui.openDeal(c.deal!.id); }}><ExternalLink />Open the deal</Button>}
          </div>
        </div>
        <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}><X /></Button>
      </div>

      <div className="flex-1 overflow-y-auto px-3.5 pb-8 tab:px-[22px]">
        {c.doNotContact && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">Do not contact. {c.doNotContact}</p>}
        {blockedP1 && !c.doNotContact && <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">P1 contact: only {me.p1Name || "the P1 owner (set in Settings → Outreach)"} messages them. You can still check the data.</p>}
        {c.dataFlags && <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">Check before sending: {c.dataFlags}</p>}
        <div className="mt-3 rounded-lg bg-sunk px-3 py-2 text-[13px]"><b>Next:</b> {c.next.label}{c.next.due ? ` (by ${fmtDay(c.next.due)})` : ""}</div>

        <ResearchBox c={c} />
        <Panel title={<>2. Check the person {c.verifiedAt && <Badge variant="ok">Checked by {c.verifiedByName}</Badge>}</>}>
          {VERIFY.map(([k, label]) => (
            <CheckRow key={k} checked={!!c.verify[k]} disabled={!canWrite || update.isPending}
              onChange={(v) => update.mutate({ verify: { [k]: v } })}>{label}</CheckRow>
          ))}
        </Panel>

        <Panel title="3. Messages" sub={verified ? "Write each message in Claude chat, paste it here, and it goes to an approver. Nothing is sent from the pipeline." : "Check the company and the person first (1 and 2). Drafts open after that."}>
          {CHANNELS.map(([ch, label, hint]) => (
            <DraftBox key={ch} c={c} channel={ch} label={label} hint={hint} enabled={verified && canMessage} meId={me.meId} canApprove={me.canApprove} />
          ))}
        </Panel>

        <Panel title="4. Tracker" sub="Sent steps tick themselves when you press &quot;I sent it&quot; on an approved message. Replies, demos and meetings: tick them here.">
          {STEP_GROUPS.map((g) => (
            <div key={g.key} className="mb-3">
              <div className="mb-1 text-xs font-semibold text-ink-2">{g.title}{g.key === "app" && c.appSenderName ? `: ${c.appSenderName} is the sender` : ""}</div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-4">
                {g.steps.map(([k, label]) => <StepRow key={k} c={c} step={k} label={label} isP1Owner={me.isP1Owner} />)}
              </div>
            </div>
          ))}
          <div className="text-xs text-ink-3">Last touch {fmtDay(c.lastTouch) || "none"} · Follow-up due {fmtDay(c.followUpDue) || "none"}</div>
        </Panel>

        <Panel title="Notes">
          <Textarea value={notes} disabled={!canWrite} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
          {notes !== c.notes && <Button size="sm" className="mt-2" onClick={() => update.mutate({ notes })}>Save notes</Button>}
        </Panel>
      </div>
    </SheetContent>
  );
}

function ResearchBox({ c }: { c: OutreachContact }) {
  const { canWrite } = useData();
  const [form, setForm] = useState<Partial<Record<ResearchKey, string>>>(c.company.research);
  const [website, setWebsite] = useState(c.company.website);
  useEffect(() => { setForm(c.company.research); setWebsite(c.company.website); }, [c.company.research, c.company.website]);
  const save = useOutreachAction((api, v: Parameters<NonNullable<typeof api.updateResearch>>[1]) => api.updateResearch!(c.company.id, v));
  const dirty = website !== c.company.website || RESEARCH.some(([k]) => (form[k] ?? "") !== (c.company.research[k] ?? ""));
  return (
    <Panel title={<>1. Check {c.company.name} on their website {c.company.researchVerifiedAt && <Badge variant="ok">Checked by {c.company.researchVerifiedByName}</Badge>}</>}
      sub="Open their own website. Write only what you saw, and keep the URLs. Changing a required field undoes the check.">
      <label className="block text-xs font-medium text-ink-2">Website *
        <Input className="mt-1" value={website} disabled={!canWrite} onChange={(e) => setWebsite(e.target.value)} />
      </label>
      <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
        {RESEARCH.map(([k, label, req]) => (
          <label key={k} className="block text-xs font-medium text-ink-2">{label}{req ? " *" : ""}
            {k === "sources" || k === "notes" || k === "size"
              ? <Textarea className="mt-1 min-h-[60px]" value={form[k] ?? ""} disabled={!canWrite} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              : <Input className="mt-1" value={form[k] ?? ""} disabled={!canWrite} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />}
          </label>
        ))}
      </div>
      {canWrite && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {dirty && <Button size="sm" disabled={save.isPending} onClick={() => save.mutate({ research: form, website })}>Save</Button>}
          {!c.company.researchVerifiedAt
            ? <Button size="sm" variant="primary" disabled={save.isPending} onClick={() => save.mutate({ ...(dirty ? { research: form, website } : {}), verified: true })}>I checked this on their website</Button>
            : <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ verified: false })}>Undo the check</Button>}
        </div>
      )}
    </Panel>
  );
}

function DraftBox({ c, channel, label, hint, enabled, meId, canApprove }: {
  c: OutreachContact; channel: DraftChannel; label: string; hint: string; enabled: boolean; meId: string; canApprove: boolean;
}) {
  const open = c.drafts.find((d) => d.channel === channel && d.status !== "sent");
  const sent = c.drafts.filter((d) => d.channel === channel && d.status === "sent");
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(open?.subject ?? "");
  const [body, setBody] = useState(open?.body ?? "");
  const save = useOutreachAction((api, v: { subject: string; body: string }) => api.saveDraft!(c.id, { channel, ...v }), "Sent for approval.");
  const del = useOutreachAction((api, id: string) => api.deleteDraft!(id));
  const isEmail = channel === "email" || channel === "email_follow";
  const canEdit = enabled && (!open || open.createdById === meId || canApprove);
  const start = () => { setSubject(open?.subject ?? ""); setBody(open?.body ?? ""); setEditing(true); };

  return (
    <div className="border-t border-line py-2.5 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-[13px]">{label}</b>
        <span className="text-xs text-ink-3">{hint}</span>
        {open && <Badge variant={DRAFT_STATUS[open.status][1]}>{DRAFT_STATUS[open.status][0]}</Badge>}
        {sent.length > 0 && <Badge>Sent {fmtDay(sent[sent.length - 1]!.sentAt)}</Badge>}
        <span className="ml-auto" />
        {!editing && canEdit && <Button size="xs" onClick={start}>{open ? "Edit" : "Paste a draft"}</Button>}
        {!editing && open && canEdit && open.status !== "approved" && <Button size="xs" variant="ghost" onClick={() => del.mutate(open.id)}>Delete</Button>}
      </div>
      {open?.status === "changes" && open.reviewNote && <p className="mt-1 text-xs text-danger">Asked to change: {open.reviewNote}</p>}
      {!editing && open && <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-sunk px-3 py-2 font-sans text-[13px]">{open.subject && `Subject: ${open.subject}\n\n`}{open.body}</pre>}
      {editing && (
        <div className="mt-2">
          {isEmail && <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" />}
          <Textarea className="mt-2 min-h-[140px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Paste the message Claude wrote, after checking it against the facts above" aria-label={label} />
          <div className="mt-1 text-xs text-ink-3">{body.trim() ? body.trim().split(/\s+/).length : 0} words, {body.length} characters</div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" disabled={save.isPending || !body.trim()} onClick={() => save.mutate({ subject, body }, { onSuccess: () => setEditing(false) })}>Send for approval</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepRow({ c, step, label, isP1Owner }: { c: OutreachContact; step: OutreachStep; label: string; isP1Owner: boolean }) {
  const { canWrite } = useData();
  const set = useOutreachAction((api, value: string) => api.setOutreachStep!(c.id, step, value));
  const v = c.steps[step] ?? "";
  const ch = SEND_STEP_CHANNEL[step];
  const approved = ch ? c.drafts.some((d) => d.channel === ch && d.status === "approved") : true;
  // A sent step needs an approved draft (the P1 owner may skip it); unticking is always allowed
  const lockedOn = !v && !!ch && !approved && !isP1Owner;
  const meeting = step === "arival_meeting";
  return (
    <div className="flex items-center gap-2 py-1">
      <CheckRow className="min-w-0 flex-1 py-0" checked={!!v} disabled={!canWrite || set.isPending || lockedOn || (meeting && !v)}
        onChange={(on) => set.mutate(on ? today() : "")}>
        <span className={lockedOn ? "text-ink-3" : ""} title={lockedOn ? "Needs an approved draft first" : undefined}>{label}</span>
      </CheckRow>
      {(v || meeting) && (
        <Input type={meeting ? "datetime-local" : "date"} className="w-[150px] px-1.5 py-0.5 text-xs" value={meeting ? v : v.slice(0, 10)} disabled={!canWrite || set.isPending}
          aria-label={`${label} date`} onChange={(e) => { if (e.target.value) set.mutate(e.target.value); }} />
      )}
      {!v && !meeting && null}
      <span className="sr-only">{fmtStep(step, v)}</span>
    </div>
  );
}
