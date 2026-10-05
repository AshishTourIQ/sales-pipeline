/**
 * Domain types for the sales pipeline module.
 *
 * These mirror the Django models / DRF serializers the backend will expose.
 * Field names are camelCase here; the DRF adapter converts to and from snake_case.
 */

export type PhaseKey = "find" | "engage" | "win" | "launch" | "lanes";

/** The built-in TourIQ stages, which carry automation (rule tasks, checklists, special dialogs). */
export type BuiltinStageKey =
  | "s1" | "s2" | "s3" | "s4" | "s5" | "offer" | "s6" | "s7" | "s8" | "s9"
  | "pilot" | "s10" | "s11" | "s12" | "s13"
  | "nurture" | "lost"
  // Partnerships template (booking platforms, OTAs)
  | "pt1" | "pt2" | "pt3" | "pt4" | "pt5" | "pt6"
  // Channels template (OTAs)
  | "ch1" | "ch2" | "ch3" | "ch4" | "ch5"
  // Referrals template (revenue managers, agencies)
  | "rf1" | "rf2" | "rf3" | "rf4";

/** Which stage template a pipeline started from. */
export type PipelineTemplate = "touriq" | "partners" | "channels" | "referrals";

export type CompanyCategory = "operator" | "booking_platform" | "ota" | "revenue_manager" | "agency" | "competitor" | "other";

/** After the demo: another demo for their team, or the commercial (pricing) call. */
export type CallType = "team_demo" | "commercial";

export type LinkKey = "booking_link" | "demo_deck" | "audit_example" | "analysis_example" | "game_link";

export interface DealLink {
  label: string;
  url: string;
}

/** Any stage key: built-in, or a custom stage ("c_1a2b3c4d") added in Settings. */
export type StageKey = string;

export type Interest = "Hot" | "Warm" | "Cold";
export type PaymentStatus = "Not invoiced" | "Invoiced" | "Paid" | "Late";
export type ActivityType = "note" | "email" | "call" | "meeting" | "ai";

export type RuleKey =
  | "r_capture48" | "r_owner" | "r_autoclose" | "r_contact" | "r_brief" | "r_sequence"
  | "r_reply" | "r_offer" | "r_demo" | "r_followup" | "r_qualify" | "r_second" | "r_pilot"
  | "r_proposal" | "r_signed" | "r_onboard" | "r_live" | "r_nurture" | "r_lost" | "r_partner" | "r_channel" | "r_referral";

export type TargetKey = "leads" | "outreach" | "demosHeld" | "snapshots" | "signed";

/* ---------- Booth lead form (the Arival paper sheet) ---------- */

export type VisitorType = "operator" | "competitor" | "consultant" | "platform" | "press" | "vendor";
export type Tier = "A" | "B" | "C" | "D";
export type OfferKey = "demo_given" | "demo_booked" | "audit" | "analysis" | "game";
/** Follow-up defaults: one per tier, plus partner and press hand-offs. */
export type FollowupKey = Tier | "partner" | "press";
export interface FollowupDefault {
  ownerId: string;
  /** Days after the visit the follow-up is due (0 = same day). */
  days: number;
}

/** What the booth sheet recorded. Points and tier are worked out by the server from the answers. */
export interface BoothInfo {
  clientId: string;
  visitor: VisitorType;
  /** question key → option key */
  answers: Record<string, string>;
  offer: OfferKey | "";
  gamePlayed: boolean;
  gameScore: string;
  /** "YYYY-MM-DDTHH:mm" local time of the visit */
  metAt: string;
  destination: string;
  runs: string;
  pricingTool: string;
  points: number;
  tierBeforeCap: Tier | "";
  capped: boolean;
  tier: Tier | "";
  /** Every scoring question answered */
  complete: boolean;
  /** Tier C: what the comparative analysis report needs */
  analysis?: AnalysisRequest | null;
}

export interface AnalysisRequest {
  /** The analysis finds their top competitors itself from this */
  website: string;
  /** "requested" until the analysis tool is connected and sends the report */
  status: string;
}

/** The offer a deal waits on in "Offer sent" (the rest go straight to a demo). */
export type Track = "game" | "analysis" | "audit";

export type TouchpointKind =
  | "game_link_sent" | "game_played" | "analysis_requested" | "analysis_viewed" | "analysis_sent" | "audit_submitted" | "audit_report_sent"
  | "demo_requested" | "account_requested" | "demo_booked" | "demo_held" | "lead_withdrawn";

/** One step of a lead's journey toward a demo. */
export interface Touchpoint {
  id: string;
  kind: TouchpointKind;
  source: "booth" | "intake" | "pipeline" | "manual";
  at: string;
  score: string;
  link: string;
  detail: string;
  byName: string;
}

export interface AddTouchpointInput {
  kind: TouchpointKind;
  score?: string;
  link?: string;
  detail?: string;
}

/** A key for one outside tool (game, analysis, audit) to post to /intake/. */
export interface IntakeKey {
  id: string;
  name: string;
  prefix: string;
  active: boolean;
  createdAt: string;
  lastUsedAt: string;
}

export type BoothPatch = Partial<Pick<BoothInfo, "visitor" | "answers" | "offer" | "gamePlayed" | "gameScore" | "destination" | "runs" | "pricingTool">>;

export interface CreateBoothLeadInput {
  pipelineId: string;
  /** Generated on the device: a retried save never creates a second deal. */
  clientId: string;
  source: string;
  event: string;
  metAt: string;
  metById: string;
  company: string;
  contact: { name: string; email: string; phone: string };
  destination: string;
  runs: string;
  pricingTool: string;
  visitor: VisitorType;
  answers: Record<string, string>;
  offer: OfferKey | "";
  gamePlayed: boolean;
  gameScore: string;
  /** Demo or audit date, "YYYY-MM-DDTHH:mm" or "" */
  bookedAt: string;
  followupOwnerId: string;
  /** "YYYY-MM-DD" or "" */
  followupDue: string;
  note: string;
  /** Comparative analysis (tier C): their website */
  website?: string;
}

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
  template: PipelineTemplate;
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
  category?: CompanyCategory | "";
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
  /** Calls and meetings: team members who were on it */
  attendeeIds?: string[];
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
  /** The event the lead came from ("Arival 2026", "Spark 2026", ...), or "" */
  event: string;
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
  /** Speed to lead: first time the team reached out, first demo booked or held (ISO, or "") */
  firstTouchAt?: string;
  demoAt?: string;
  sample?: boolean;
  /** Team member who met them (booth staff), or "" */
  metById: string;
  /** Set when the lead came from the booth form */
  booth: BoothInfo | null;
  /** The offer track taken toward the demo, or "" */
  track: Track | "";
  touchpoints: Touchpoint[];
  /** Second call (s9): team demo or commercial call */
  callType: CallType | "";
  /** Looks after the client once signed */
  accountManagerId: string;
  links: DealLink[];
  /** Referral partners: the commission we pay them, in percent */
  commissionPct: number | null;
  /** Two-way referrals (agencies, software): the commission they pay us, in percent */
  commissionInPct: number | null;
  /** Where the call happens (Meet link from the calendar event, or a Zoom link) */
  meetingUrl: string;
  /** The demo / meeting is on the team's Google Calendar */
  onCalendar: boolean;
}

/** A call recorded by Recall.ai that no deal could be matched to (or that failed). */
export interface RecordedCall {
  id: string;
  status: "pending" | "logged" | "unmatched" | "dismissed" | "failed";
  title: string;
  startedAt: string;
  endedAt: string;
  participants: { name: string; email: string; isHost: boolean }[];
  dealId: string | null;
  matchedBy: string;
  error: string;
  hasTranscript: boolean;
  createdAt: string;
}

/** What the server has switched on (read-only; set in the backend .env). */
export interface Integrations {
  calendar: boolean;
  /** Events invite the attendees and get a Meet link (Workspace delegation) */
  calendarInvites: boolean;
  recall: boolean;
  recallWebhookUrl: string;
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
  /** Booth form: default follow-up owner and due days per tier (admins edit). */
  boothFollowup: Record<FollowupKey, FollowupDefault>;
  /** Links used in emails and AI drafts */
  links: Partial<Record<LinkKey, string>>;
  /** What each event cost, by event name ("Arival 2026": 12000). In a patch, null removes an event. */
  eventCosts: Record<string, number | null>;
  /** Outreach: who alone messages P1 contacts ("" = nobody set yet). Server only. */
  outreach?: { p1UserId: string; appSenderIds?: string[] };
  /** Server only */
  integrations?: Integrations;
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
  event?: string;
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
  /** Moving into "Offer sent": which offer */
  track?: Track;
  /** Moving into the second call: which kind */
  callType?: CallType;
}

/** Server response for any operation that may run automation rules. */
export interface DealMutationResult {
  deal: Deal;
  tasksCreated: Task[];
  tasksClosed: string[];
  /** Things to tell the person, e.g. "Game link emailed to …" */
  notices?: string[];
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
    | "company" | "contact" | "source" | "event" | "interest" | "ownerId" | "package" | "value" | "locations"
    | "snapshotSent" | "demoDate" | "reengageDate" | "payment" | "qual" | "pilotChecks" | "onboarding" | "metById"
    | "accountManagerId" | "links" | "commissionPct" | "commissionInPct" | "meetingUrl"
  >
> & { booth?: BoothPatch };

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
  /** Company type as written in the sheet ("OTA", "Competitor", ...); the server maps it */
  category?: string;
}

export interface ImportResult {
  created: number;
  skipped: number;
}

export type AiAction = "brief" | "first" | "follow" | "invite" | "tag" | "summary" | "next";

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

export type AccessRole = "viewer" | "contributor" | "admin";

export interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
  isSalesTeam: boolean;
  role?: AccessRole;
  /** Invited but hasn't set a password yet */
  pending?: boolean;
  /** Outreach: an admin made them an approver */
  canApproveOutreach?: boolean;
  /** Approver or admin */
  canApprove?: boolean;
}

export interface InviteInput {
  name: string;
  email: string;
  role: AccessRole;
  /** Add to the sales team (owner pickers, booth staff list) */
  salesTeam: boolean;
}

export interface CurrentUser {
  id: string;
  name: string;
}

/** A deal that looks like the lead being typed ("already in the pipeline?"). */
export interface DuplicateMatch {
  dealId: string;
  pipelineId: string;
  pipelineName: string;
  company: string;
  contactName: string;
  stage: string;
  stageName: string;
  ownerId: string;
  match: "email" | "website" | "company";
}

/* ---------- Outreach (the Arival outreach tracker) ---------- */

export type OutreachStep =
  | "li_note" | "li_msg" | "li_reply" | "li_demo"
  | "em_draft" | "em_sent" | "em_follow" | "em_reply"
  | "app_sent" | "app_reply" | "cal_demo" | "arival_meeting";
export type DraftChannel = "li_note" | "li_msg" | "email" | "email_follow" | "app";
export type DraftStatus = "pending" | "changes" | "approved" | "sent";
export type ReplyChannel = "linkedin" | "email" | "app";
export type OutreachPriority = "P1" | "P2" | "P3" | "P4" | "Review" | "Skip";
export type VerifyKey = "company" | "person" | "contact_info";
export type ResearchKey =
  | "booking_platform" | "example_tour" | "listed_price" | "sources"
  | "price_variation" | "demand_language" | "size" | "unverified" | "notes";

export interface OutreachDraft {
  id: string;
  channel: DraftChannel;
  subject: string;
  body: string;
  status: DraftStatus;
  reviewNote: string;
  createdById: string;
  createdAt: string;
  approvedById: string;
  approvedAt: string;
  sentById: string;
  sentAt: string;
}

export interface NextAction {
  key: "none" | "done" | "book" | "verify" | "send" | "fix" | "approval" | "follow" | "ask_email" | "wait"
    | "email" | "ask_linkedin" | "ask_app" | "li_msg" | "write";
  label: string;
  due: string | null;
}

export interface OutreachContact {
  id: string;
  campaign: string;
  extId: string;
  name: string;
  title: string;
  email: string;
  linkedin: string;
  country: string;
  priority: OutreachPriority | "";
  roleType: string;
  /** "Yes" = the P1 owner approves this person's drafts */
  leadReview: string;
  dataFlags: string;
  /** Step → "YYYY-MM-DD" ("arival_meeting": "YYYY-MM-DDTHH:MM") */
  steps: Partial<Record<OutreachStep, string>>;
  appSenderId: string;
  appSenderName: string;
  verify: Partial<Record<VerifyKey, boolean>>;
  verifiedAt: string;
  verifiedByName: string;
  replyChecked: Partial<Record<ReplyChannel, string>>;
  notes: string;
  /** Why this person is never messaged ("" = they can be) */
  doNotContact: string;
  lastTouch: string;
  followUpDue: string;
  next: NextAction;
  drafts: OutreachDraft[];
  company: {
    id: string;
    name: string;
    website: string;
    category: string;
    research: Partial<Record<ResearchKey, string>>;
    researchVerifiedAt: string;
    researchVerifiedByName: string;
  };
  deal: { id: string; pipelineId: string; stage: StageKey } | null;
}

export interface OutreachImportRow {
  extId: string;
  name: string;
  title: string;
  email: string;
  country: string;
  company: string;
  segment: string;
  priority: string;
  roleType: string;
  competitor: string;
  leadReview: string;
  flags: string;
  notes: string;
  steps: Partial<Record<OutreachStep, string>>;
  /** Who already sent the Arival app message (a tracker column name: Nikunj, Gunin, Barkley) */
  appSender: string;
}
export interface OutreachResearchRow {
  company: string;
  website: string;
  competitor: string;
  bookingPlatform: string;
  exampleTour: string;
  listedPrice: string;
  priceVariation: string;
  demandLanguage: string;
  size: string;
  sources: string;
  unverified: string;
}
export interface OutreachImportResult {
  companiesCreated: number;
  dealsCreated: number;
  contactsCreated: number;
  contactsUpdated: number;
  skipped: number;
}
