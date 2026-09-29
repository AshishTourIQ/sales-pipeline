import type {
  AiDraftInput, AiDraftResult, CreateDealInput, CreateTaskInput, Deal, DealMutationResult, DealPatch,
  ImportResult, ImportRow, MoveDealInput, Pipeline, PipelineSettings, Task, TaskPatch, ActivityType, WorkspaceUser,
  CreateStageTaskInput, DealUpdateResult, StageTaskTemplate, TaskUpdateResult,
  AddStageInput, StageConfig, StageEdit, StageKey,
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
  createPipeline(name: string): Promise<Pipeline>;
  /** Rename the pipeline, toggle Pilot, or edit existing stages (name, limit, owner, phase, description). */
  updatePipeline(id: string, patch: PipelinePatch): Promise<Pipeline>;
  /** Add a custom stage after `after` ("" = first). */
  addStage(pipelineId: string, input: AddStageInput): Promise<{ pipeline: Pipeline; stage: StageConfig }>;
  /** Remove a stage; its deals move to `moveTo` first. */
  removeStage(pipelineId: string, stageKey: StageKey, moveTo: StageKey): Promise<{ pipeline: Pipeline; moved: number }>;

  listDeals(pipelineId: string): Promise<Deal[]>;
  createDeal(input: CreateDealInput): Promise<DealMutationResult>;
  /** May finish the stage (checklist) and move the deal on: see `advanced`. */
  updateDeal(id: string, patch: DealPatch): Promise<DealUpdateResult>;
  moveDeal(id: string, input: MoveDealInput): Promise<DealMutationResult>;
  deleteDeal(id: string): Promise<void>;
  addActivity(dealId: string, type: ActivityType, text: string): Promise<Deal>;
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

  getSettings(): Promise<PipelineSettings>;
  updateSettings(patch: Partial<PipelineSettings>): Promise<PipelineSettings>;

  importLeads(pipelineId: string, rows: ImportRow[]): Promise<ImportResult>;
  loadSamples(pipelineId: string): Promise<{ created: number }>;
  removeSamples(pipelineId: string): Promise<{ removed: number }>;

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
