import type {
  AiDraftInput, AiDraftResult, CreateDealInput, CreateTaskInput, Deal, DealMutationResult, DealPatch,
  ImportResult, ImportRow, MoveDealInput, Pipeline, PipelineSettings, Task, TaskPatch, ActivityType, WorkspaceUser,
  CreateStageTaskInput, DealUpdateResult, StageTaskTemplate, TaskUpdateResult, CreateBoothLeadInput, InviteInput,
  AddTouchpointInput, IntakeKey, CallType, PipelineTemplate, RecordedCall,
  AddStageInput, StageConfig, StageEdit, StageKey, DuplicateMatch,
  OutreachContact, OutreachImportRow, OutreachResearchRow, OutreachImportResult, OutreachStep, DraftChannel,
  ReplyChannel, OutreachPriority, VerifyKey, ResearchKey,
} from "../types";

export interface PipelinePatch {
  name?: string;
  pilotEnabled?: boolean;
  stages?: StageEdit[];
}

/**
 * Everything the UI needs from the backend. Two implementations:
 *  - createDrfApi(): the Django REST Framework API (production)
 *  - createMockApi(): browser-only, for building the UI before the backend exists
 *
 * Automation (owner hand-off, rule tasks, auto-closing tasks, payment on signing)
 * happens server-side inside createDeal / moveDeal; the response says what changed.
 */
export interface PipelineApi {
  listPipelines(): Promise<Pipeline[]>;
  createPipeline(name: string, template?: PipelineTemplate): Promise<Pipeline>;
  /** Bring partner hand-offs that fit this Partnerships / Referrals pipeline into it. */
  importHandoffs(pipelineId: string): Promise<{ moved: number }>;
  /** Rename the pipeline, toggle Pilot, or edit existing stages (name, limit, owner, phase, description). */
  updatePipeline(id: string, patch: PipelinePatch): Promise<Pipeline>;
  /** Add a custom stage after `after` ("" = first). */
  addStage(pipelineId: string, input: AddStageInput): Promise<{ pipeline: Pipeline; stage: StageConfig }>;
  /** Remove a stage; its deals move to `moveTo` first. */
  removeStage(pipelineId: string, stageKey: StageKey, moveTo: StageKey): Promise<{ pipeline: Pipeline; moved: number }>;

  listDeals(pipelineId: string): Promise<Deal[]>;
  createDeal(input: CreateDealInput): Promise<DealMutationResult>;
  /**
   * The booth lead form. The server scores the answers (points, tier, cap) and files the
   * visitor by type and offer. Saving again with the same clientId returns the same deal.
   */
  createBoothLead(input: CreateBoothLeadInput): Promise<DealMutationResult>;
  /** May finish the stage (checklist) and move the deal on: see `advanced`. */
  updateDeal(id: string, patch: DealPatch): Promise<DealUpdateResult>;
  moveDeal(id: string, input: MoveDealInput): Promise<DealMutationResult>;
  deleteDeal(id: string): Promise<void>;
  /** attendeeIds: for calls and meetings, the team members who were on it. */
  addActivity(dealId: string, type: ActivityType, text: string, attendeeIds?: string[]): Promise<Deal>;
  /** Fix who was on a call or meeting. */
  updateActivity(activityId: string, patch: { attendeeIds: string[] }): Promise<Deal>;
  /** Second call: team demo or commercial call (swaps the stage's tasks). */
  setCallType(dealId: string, callType: CallType): Promise<DealMutationResult>;
  /** Move the deal to another pipeline; it starts at that pipeline's first stage. */
  transferDeal(dealId: string, pipelineId: string): Promise<DealMutationResult>;
  /** A person records a journey step (e.g. "Audit report sent" with the report link). */
  addTouchpoint(dealId: string, input: AddTouchpointInput): Promise<Deal>;
  /** New deal on the same company, source "Existing client (expansion)". */
  createExpansion(dealId: string): Promise<DealMutationResult>;

  listTasks(pipelineId: string): Promise<Task[]>;
  createTask(input: CreateTaskInput): Promise<Task>;
  /** Ticking the last open task of the deal's stage moves the deal on: see `advanced`. */
  updateTask(id: string, patch: TaskPatch): Promise<TaskUpdateResult>;
  deleteTask(id: string): Promise<void>;

  /** Stage tasks: "this person must do X in this stage" (current + future deals). */
  listStageTasks(pipelineId: string): Promise<StageTaskTemplate[]>;
  createStageTask(input: CreateStageTaskInput): Promise<{ template: StageTaskTemplate; tasksCreated: Task[] }>;
  deleteStageTask(id: string): Promise<{ tasksRemoved: string[] }>;

  /**
   * Workspace users the team can be picked from. Only real backends have it;
   * without it (mock), Settings adds team members by name.
   */
  listUsers?(): Promise<WorkspaceUser[]>;
  /** Admin: invite someone by email; they get a link to set their password. */
  inviteUser?(input: InviteInput): Promise<WorkspaceUser & { emailSent: boolean }>;
  resendInvite?(userId: string): Promise<WorkspaceUser & { emailSent: boolean }>;

  /** Admin: keys the game / analysis / audit tools use for /intake/. Server only. */
  listIntakeKeys?(): Promise<IntakeKey[]>;
  /** The full key is in `secret`, shown once. */
  createIntakeKey?(name: string): Promise<{ key: IntakeKey; secret: string }>;
  revokeIntakeKey?(id: string): Promise<void>;

  /** Put the deal's demo / meeting on the team calendar now (server only). */
  syncCalendar?(dealId: string): Promise<{ result: string; deal: Deal }>;
  /** Recorded calls (Recall) that need a person: unmatched or failed. Server only. */
  listRecordings?(): Promise<RecordedCall[]>;
  linkRecording?(id: string, dealId: string): Promise<RecordedCall>;
  dismissRecording?(id: string): Promise<void>;

  /** Deals that look like this lead, across pipelines. Warns only; never blocks a save. */
  findDuplicates?(q: { company?: string; email?: string; website?: string }): Promise<DuplicateMatch[]>;

  getSettings(): Promise<PipelineSettings>;
  updateSettings(patch: Partial<PipelineSettings>): Promise<PipelineSettings>;

  importLeads(pipelineId: string, rows: ImportRow[]): Promise<ImportResult>;
  loadSamples(pipelineId: string): Promise<{ created: number }>;
  removeSamples(pipelineId: string): Promise<{ removed: number }>;

  /* ---- Outreach (server only). Nothing here sends a message: people send by hand and tick Sent. ---- */
  /** Admin: make someone an outreach approver. */
  setApprover?(userId: string, canApprove: boolean): Promise<WorkspaceUser>;
  listOutreach?(campaign?: string): Promise<OutreachContact[]>;
  /** Admin: the outreach tracker workbook (Contacts + Research tabs). */
  importOutreach?(input: { campaign: string; contacts: OutreachImportRow[]; research: OutreachResearchRow[] }): Promise<OutreachImportResult>;
  updateOutreachContact?(id: string, patch: { priority?: OutreachPriority; email?: string; linkedin?: string; notes?: string; verify?: Partial<Record<VerifyKey, boolean>> }): Promise<OutreachContact>;
  /** value: a date ("" unticks). Sent steps need an approved draft. */
  setOutreachStep?(id: string, step: OutreachStep, value: string): Promise<OutreachContact>;
  answerReplyCheck?(id: string, channel: ReplyChannel, replied: boolean): Promise<OutreachContact>;
  /** Returns everyone listed at that company. verified: true checks the research, false undoes it. */
  updateResearch?(companyId: string, patch: { research?: Partial<Record<ResearchKey, string>>; website?: string; verified?: boolean }): Promise<OutreachContact[]>;
  /** Paste a draft from Claude chat; it goes to approval. */
  saveDraft?(contactId: string, input: { channel: DraftChannel; subject: string; body: string }): Promise<OutreachContact>;
  reviewDraft?(draftId: string, patch: { subject?: string; body?: string; action?: "approve" | "changes"; note?: string }): Promise<OutreachContact>;
  deleteDraft?(draftId: string): Promise<OutreachContact>;

  /** Claude drafts on the server (Haiku / Sonnet), JSON-validated there. */
  aiDraft(dealId: string, input: AiDraftInput, signal?: AbortSignal): Promise<AiDraftResult>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string = "error",
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
