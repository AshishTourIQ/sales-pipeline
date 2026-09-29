/**
 * Domain types for the sales pipeline module.
 *
 * These mirror the Django models / DRF serializers the backend will expose.
 * Field names are camelCase here; the DRF adapter converts to and from snake_case.
 */

export type PhaseKey = "find" | "engage" | "win" | "launch" | "lanes";

/** The built-in TourIQ stages, which carry automation (rule tasks, checklists, special dialogs). */
export type BuiltinStageKey =
  | "s1" | "s2" | "s3" | "s4" | "s5" | "s6" | "s7" | "s8" | "s9"
  | "pilot" | "s10" | "s11" | "s12" | "s13"
  | "nurture" | "lost";

/** Any stage key: built-in, or a custom stage ("c_1a2b3c4d") added in Settings. */
export type StageKey = string;

export type Interest = "Hot" | "Warm" | "Cold";
export type PaymentStatus = "Not invoiced" | "Invoiced" | "Paid" | "Late";
export type ActivityType = "note" | "email" | "call" | "meeting" | "ai";

export type RuleKey =
  | "r_capture48" | "r_owner" | "r_autoclose" | "r_contact" | "r_brief" | "r_sequence"
  | "r_reply" | "r_demo" | "r_followup" | "r_qualify" | "r_second" | "r_pilot"
  | "r_proposal" | "r_signed" | "r_onboard" | "r_live" | "r_nurture" | "r_lost";

export type TargetKey = "leads" | "outreach" | "demosHeld" | "snapshots" | "signed";

/** A person who can own stages, deals and tasks. In the host app this is a tenant user. */
export interface TeamMember {
  id: string;
  name: string;
}

export interface StageTemplate {
  key: BuiltinStageKey;
  num: number | null;
  name: string;
  phase: PhaseKey;
  /** Max days a deal should sit in this stage; null = no limit. */
  limit: number | null;
  /** Default owner (team member id). */
  ownerId: string;
  optional?: boolean;
  lane?: boolean;
}

/** One entry of a pipeline's ordered stage list, as stored. */
export interface StageConfig {
  key: StageKey;
  name: string;
  phase: PhaseKey;
  limit: number | null;
  ownerId: string;
  optional?: boolean;
  lane?: boolean;
  /** Added by the user: no built-in automation. */
  custom?: boolean;
  /** Shown in the Workflow guide for custom stages. */
  description?: string;
}

/** A stage as resolved for a pipeline: numbered by position (lanes and optional stages have no number). */
export interface Stage extends StageConfig {
  num: number | null;
  lane: boolean;
  optional: boolean;
  custom: boolean;
}

export type StageEdit = Partial<Pick<StageConfig, "name" | "limit" | "ownerId" | "phase" | "description">> & { key: StageKey };

export interface AddStageInput {
  name: string;
  phase: Exclude<PhaseKey, "lanes">;
  /** Key of the stage it goes after; "" = first */
  after: StageKey;
  limit: number | null;
  ownerId: string;
  description: string;
}

export interface Pipeline {
  id: string;
  name: string;
  template: "touriq";
  pilotEnabled: boolean;
  /** Ordered stage list (main route, then Nurture and Lost). */
  stages: StageConfig[];
  createdAt: string;
  dealCount?: number;
}

export interface Company {
  name: string;
  website: string;
  region: string;
  segment: string;
  platform: string;
  products5: boolean;
  sellsOut: boolean;
  reachable: boolean;
}

export interface Contact {
  name: string;
  title: string;
  email: string;
  phone: string;
  linkedin: string;
  decisionMaker: boolean;
}

export interface HistoryEntry {
  from: StageKey | null;
  to: StageKey;
  at: string;
  byId: string | null;
  byName: string;
}

export interface Activity {
  id: string;
  type: ActivityType;
  text: string;
  at: string;
  byId: string | null;
  byName: string;
}

export interface Payment {
  status: PaymentStatus;
  invoice?: string;
  amount?: string;
  paidAt?: string;
  invoicedAt?: string;
}

export type Checklist = Record<string, boolean>;

export interface Deal {
  id: string;
  pipelineId: string;
  company: Company;
  contact: Contact;
  source: string;
  interest: Interest | "";
  ownerId: string;
  fit: number;
  stage: StageKey;
  stageChangedAt: string;
  createdAt: string;
  history: HistoryEntry[];
  activities: Activity[];
  snapshotSent: boolean;
  /** "YYYY-MM-DDTHH:mm" local datetime, or "" */
  demoDate: string;
  payment: Payment;
  value: string;
  package: string;
  locations: string;
  lossReason: string;
  lossCompetitor: string;
  nurtureReason: string;
  /** "YYYY-MM-DD" or "" */
  reengageDate: string;
  qual: Checklist;
  pilotChecks: Checklist;
  onboarding: Checklist;
  signedAt?: string;
  liveAt?: string;
  sample?: boolean;
}

export interface Task {
  id: string;
  dealId: string | null;
  pipelineId: string;
  title: string;
  ownerId: string;
  /** "YYYY-MM-DD" or "" */
  due: string;
  done: boolean;
  doneAt: string;
  auto: boolean;
  autoClosed: boolean;
  rule: RuleKey | null;
  stage: StageKey | null;
  createdAt: string;
  sample?: boolean;
  /** Must be done before the deal can move forward from `stage`. Reminders are false. */
  blocking: boolean;
  /** Set when the task came from a stage task ("Guddu must do X in stage 1"). */
  templateId?: string | null;
}

/** "This person must do X in this stage": added to their deals in that stage, now and later. */
export interface StageTaskTemplate {
  id: string;
  pipelineId: string;
  stage: StageKey;
  ownerId: string;
  title: string;
  dueInDays: number;
  createdAt: string;
}

export interface CreateStageTaskInput {
  pipelineId: string;
  stage: StageKey;
  ownerId: string;
  title: string;
  dueInDays: number;
}

export interface PipelineSettings {
  team: TeamMember[];
  rules: Record<RuleKey, boolean>;
  targets: Record<TargetKey, number>;
}

export type FlagLevel = "over" | "near";
export interface Flag {
  lvl: FlagLevel;
  text: string;
}

/* ---------- API inputs ---------- */

export interface CreateDealInput {
  pipelineId: string;
  entryStage: StageKey;
  company: Company;
  contact: Contact;
  source: string;
  interest: Interest | "";
  ownerId: string;
  note?: string;
  demoDate?: string;
}

export interface MoveDealInput {
  to: StageKey;
  lossReason?: string;
  lossCompetitor?: string;
  nurtureReason?: string;
  reengageDate?: string;
  demoDate?: string;
  note?: string;
  /** Admin override: move forward although the stage still has open tasks */
  force?: boolean;
  overrideReason?: string;
}

/** Server response for any operation that may run automation rules. */
export interface DealMutationResult {
  deal: Deal;
  tasksCreated: Task[];
  tasksClosed: string[];
}

/** Ticking a task or checklist item may finish the stage and move the deal on. */
export interface TaskUpdateResult {
  task: Task;
  advanced: DealMutationResult | null;
}
export interface DealUpdateResult {
  deal: Deal;
  advanced: DealMutationResult | null;
}

export type DealPatch = Partial<
  Pick<
    Deal,
    | "company" | "contact" | "source" | "interest" | "ownerId" | "package" | "value" | "locations"
    | "snapshotSent" | "demoDate" | "reengageDate" | "payment" | "qual" | "pilotChecks" | "onboarding"
  >
>;

export interface CreateTaskInput {
  pipelineId: string;
  dealId: string | null;
  title: string;
  ownerId: string;
  due: string;
}

export type TaskPatch = Partial<Pick<Task, "title" | "ownerId" | "due" | "done">>;

export interface ImportRow {
  company: string;
  contact: string;
  title: string;
  email: string;
  linkedin: string;
  segment: string;
  platform: string;
  region: string;
  source: string;
  fit: string;
  stage: StageKey;
  paid: boolean;
  owner: string;
  last: string;
  next: string;
  nextDate: string;
  snap: boolean;
  demo: string;
  notes: string;
  fu: string;
}

export interface ImportResult {
  created: number;
  skipped: number;
}

export type AiAction = "brief" | "first" | "follow" | "tag" | "summary" | "next";

export interface AiDraftInput {
  action: AiAction;
  option?: string;
  pasted?: string;
}

export type ReplyTag = "interested" | "not_now" | "wrong_person" | "no" | "unsubscribe";

export interface AiDraftResult {
  text: string;
  /** Structured output for "tag" (reply classification) */
  tag?: ReplyTag;
  truncated?: boolean;
}

export interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
  isSalesTeam: boolean;
}

export interface CurrentUser {
  id: string;
  name: string;
}
