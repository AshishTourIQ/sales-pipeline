import type {
  BuiltinStageKey, PhaseKey, PipelineSettings, RuleKey, StageKey, StageTemplate, TargetKey, TeamMember,
} from "../types";

/** TourIQ pipeline template (from the playbook, Excel plan and design doc). */

export const PHASES: { key: PhaseKey; name: string; sub: string }[] = [
  { key: "find", name: "Find", sub: "stages 1 to 3" },
  { key: "engage", name: "Engage", sub: "stages 4 to 6" },
  { key: "win", name: "Win", sub: "stages 7 to 11" },
  { key: "launch", name: "Launch", sub: "stages 12 and 13" },
  { key: "lanes", name: "Side lanes", sub: "off the main route" },
];

export const DEFAULT_TEAM: TeamMember[] = [
  { id: "nikunj", name: "Nikunj" },
  { id: "param", name: "Param" },
  { id: "manjit", name: "Manjit" },
  { id: "guddu", name: "Guddu" },
];

export const TEMPLATE: StageTemplate[] = [
  { key: "s1", num: 1, name: "Target list", phase: "find", limit: 3, ownerId: "guddu" },
  { key: "s2", num: 2, name: "Contact found", phase: "find", limit: 2, ownerId: "guddu" },
  { key: "s3", num: 3, name: "Researched", phase: "find", limit: 2, ownerId: "param" },
  { key: "s4", num: 4, name: "Outreach sent", phase: "engage", limit: 14, ownerId: "param" },
  { key: "s5", num: 5, name: "Replied", phase: "engage", limit: 2, ownerId: "param" },
  { key: "s6", num: 6, name: "Demo booked", phase: "engage", limit: 7, ownerId: "manjit" },
  { key: "s7", num: 7, name: "Demo done", phase: "win", limit: 1, ownerId: "manjit" },
  { key: "s8", num: 8, name: "Qualified", phase: "win", limit: 3, ownerId: "manjit" },
  { key: "s9", num: 9, name: "Second call", phase: "win", limit: 10, ownerId: "manjit" },
  { key: "pilot", num: null, name: "Pilot", phase: "win", limit: 30, ownerId: "manjit", optional: true },
  { key: "s10", num: 10, name: "Proposal", phase: "win", limit: 14, ownerId: "nikunj" },
  { key: "s11", num: 11, name: "Signed", phase: "win", limit: 1, ownerId: "nikunj" },
  { key: "s12", num: 12, name: "Onboarding", phase: "launch", limit: 21, ownerId: "manjit" },
  { key: "s13", num: 13, name: "Live", phase: "launch", limit: null, ownerId: "manjit" },
  { key: "nurture", num: null, name: "Nurture", phase: "lanes", limit: null, ownerId: "param", lane: true },
  { key: "lost", num: null, name: "Lost", phase: "lanes", limit: null, ownerId: "param", lane: true },
];

/**
 * Built-in main route order. A pipeline's real order is its own stage list
 * (lib/pipeline.ts); this only maps a removed built-in stage to the next one that exists.
 */
export const ORDER: StageKey[] = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "pilot", "s10", "s11", "s12", "s13"];

export type Route = readonly [label: string, to: StageKey];

export const ROUTES: Record<StageKey, Route[]> = {
  s1: [["Picked", "s2"], ["Not a fit yet", "nurture"]],
  s2: [["Confirmed", "s3"]],
  s3: [["Brief approved", "s4"]],
  s4: [["Reply came in", "s5"], ["No reply after day 14", "nurture"]],
  s5: [["Interested", "s6"], ["Wrong person", "s2"], ["Not now", "nurture"], ["No", "lost"]],
  s6: [["Demo held", "s7"], ["No-show twice", "nurture"]],
  s7: [["Summary saved, follow-up sent", "s8"]],
  s8: [["Go", "s9"], ["Not supported yet", "nurture"], ["Clear no", "lost"]],
  s9: [["Wants a pilot", "pilot"], ["Wants a proposal", "s10"], ["Silent 30 days", "nurture"]],
  pilot: [["Positive result", "s10"], ["Not now", "nurture"], ["No", "lost"]],
  s10: [["Signed", "s11"], ["Declined", "lost"]],
  s11: [["Handover done", "s12"]],
  s12: [["First price pushed", "s13"]],
  s13: [],
  nurture: [["Re-engage", "s4"]],
  lost: [["Reopen", "nurture"]],
};

/** Step guide. e = enters when, x = moves on when, s = software does, h = person does, a = asset, d = data */
export interface GuideEntry {
  t?: string;
  o?: string;
  l?: string;
  e?: string;
  x?: string;
  s?: string[];
  h?: string[];
  a?: string;
  d?: string;
}

export type GuideKey = BuiltinStageKey | "f1" | "f2" | "f3" | "g1";

/** Guide text for a stage: built-in copy, or a custom stage's own description. */
export function guideFor(key: StageKey, description?: string): GuideEntry {
  const g = (GUIDE as Partial<Record<string, GuideEntry>>)[key];
  if (g) return g;
  return { e: description || "A custom stage added for this pipeline.", x: "Every stage task for it is done", s: ["Moves the deal on by itself when its stage tasks are done"], h: ["Do the stage tasks added for this stage on the Tasks page"] };
}

export const GUIDE: Record<GuideKey, GuideEntry> = {
  f1: {
    t: "Attract (watch)", o: "Param and editors; Nikunj approves", l: "Posts Tue, Thu, Sat before shows; daily during shows",
    e: "Always on. Operators see TourIQ before anyone contacts them.", x: "Someone plays, downloads, clicks or asks for a demo",
    s: ["Tags every link (video, post, email) with its lead source so later clicks can be traced", "Nothing enters the pipeline yet"],
    h: ["Publish posts and the 'Who / What is TourIQ' videos on LinkedIn, Instagram and YouTube", "Run partner cross-promo: Arival, Tourpreneur, Travel Trends podcast", "Follow the wording rules: 'dynamic pricing for tour operators', never 'surge pricing', no invented numbers"],
    a: "Video series, game teaser, Modern Pricing Report, posts", d: "Views, comments, shares and clicks per source",
  },
  f2: {
    t: "Play or download", o: "Game host; Guddu logs", l: "Arival Oct 12 to 15; Spark Oct 27 to 29 if confirmed",
    e: "They play Beat the Algorithm, download the report, click the newsletter or request a Snapshot.", x: "Contact details captured",
    s: ["Game asks for name and company after play; email optional, no email wall", "Report download and Snapshot form capture contact details", "Newsletter clicks get the 'Arival report / newsletter' source"],
    h: ["Run the game and leaderboard; pick the daily winner", "Offer a free Pricing Snapshot to everyone who plays", "Book a demo with every person before they walk away"],
    a: "Beat the Algorithm game, Pricing Snapshot offer, Modern Pricing Report", d: "Name, company, email (optional), Snapshot opt-in",
  },
  f3: {
    t: "Capture (lead enters the pipeline)", o: "Whoever met them; Guddu checks", l: "Same day; under a minute per booth lead",
    e: "A new person or company reaches you through any channel.", x: "Deal created at the entry stage for its source",
    s: ["Creates the company, contact and deal with a lead source", "Places the deal at the entry stage for its source: outbound at 1, report or newsletter at 3, booth or referral at 5, demo request at 6", "Booth leads get a follow-up task due in 48 hours"],
    h: ["Use Capture lead: name, company, role, email, booking platform, hot / warm / cold, short note", "Hot leads: book the demo on the spot", "End each show day with a 10-minute review of captures"],
    a: "Capture lead form", d: "Lead source, entry stage, interest level",
  },
  s1: {
    e: "Company added from attendee lists, 'powered by FareHarbor / Peek' sites, OTA top-rated lists, directories or research.", x: "Fit score high enough, or picked by hand",
    s: ["Removes duplicates on import", "Scores fit on the 5-point rule: water vertical, 5+ products, FareHarbor (Peek Pro = half), sells out, reachable buyer"],
    h: ["Review the scored list and remove bad fits", "Pick this week's companies (5 points = call first)"],
    a: "None yet", d: "Company, region, segment, booking platform, 5+ products, source, fit score",
  },
  s2: {
    e: "Company picked to work.", x: "A named contact with a verified email",
    s: ["Creates a task to confirm the decision-maker", "Flags titles that aren't owner, GM, revenue or marketing"],
    h: ["Confirm the person and role", "Check LinkedIn by hand (never automated)"],
    a: "None yet", d: "Name, title, email, LinkedIn, phone, decision-maker yes / no",
  },
  s3: {
    e: "Contact confirmed, or a report / newsletter lead arrives.", x: "Brief approved",
    s: ["AI drafts the one-page brief from what's on the deal", "Suggests a hook for the first message"],
    h: ["Read the brief and fix anything wrong", "Pick the angle for the first message"],
    a: "One-page research brief", d: "Brief, hook, sample product and price, pain guess",
  },
  s4: {
    e: "Brief approved.", x: "A reply arrives, or the sequence ends",
    s: ["AI drafts a first message under 80 words", "Creates the sequence as tasks: first message today, follow-ups on day 3, 7 and 14", "Creates a LinkedIn task for a person; never sends on LinkedIn itself"],
    h: ["Approve or edit each draft and send it from the outreach domain, never touriq.ai", "Lead with the free Pricing Snapshot offer", "Every email carries an unsubscribe line and postal address"],
    a: "Pricing Snapshot offer, Modern Pricing Report, short video", d: "Channel, template used, date of each touch",
  },
  s5: {
    e: "Any reply, positive or not.", x: "The reply tag decides the route",
    s: ["Closes the open follow-up tasks", "AI tags a pasted reply: interested, not now, wrong person, no, unsubscribe", "AI drafts a response with the booking link"],
    h: ["Edit and send the response within 2 hours"],
    a: "Booking link, 'What is TourIQ' video", d: "Reply text, interest level, objection",
  },
  s6: {
    e: "They book through the link, at the booth, or before the show.", x: "The demo happens",
    s: ["Creates a prep task and a Snapshot task due before the demo", "Flags any lead with no demo 5 days after first contact"],
    h: ["Read the brief and prepare their own tours as examples", "Make sure the Snapshot is ready"],
    a: "Demo deck with their tours, Pricing Snapshot", d: "Demo type, date, attendees, Snapshot status",
  },
  s7: {
    e: "Demo held.", x: "Summary saved, follow-up sent, next call booked",
    s: ["AI turns pasted notes or a transcript into needs, objections, platform, decision-maker, next step and a follow-up draft", "Creates the follow-up task due within 24 hours"],
    h: ["Ask for recording consent at the start", "Book the next call before the demo ends", "Check the summary and send the follow-up"],
    a: "Follow-up email with recap", d: "Notes, objections, follow-up date, who else joins",
  },
  s8: {
    e: "Demo done and follow-up sent.", x: "Every check on the qualification list passes",
    s: ["Shows the qualification checklist", "Creates the go / no-go task due in 3 days"],
    h: ["Confirm volume, decision-maker, platform, vertical, timing and budget", "FareHarbor = go; Peek Pro = built, not live yet (flag); Ventrata, Rezdy, Xola = CSV only (flag); other = not supported"],
    a: "None", d: "Checklist results, segment, package fit",
  },
  s9: {
    e: "Deal qualified.", x: "They ask for a pilot or a proposal",
    s: ["Creates the Snapshot task and the second-call task due in 10 days", "Flags the deal if it goes quiet"],
    h: ["Walk them through the Snapshot on their own data", "Answer objections and meet the other decision-makers"],
    a: "Pricing Snapshot, objection answers, case study once approved", d: "Follow-up dates, blockers, who else is involved",
  },
  pilot: {
    e: "A qualified operator wants to try it on real products.", x: "Pilot ends and results are reviewed",
    s: ["Warns when 5 pilots are already running", "Creates the terms, capacity and review tasks"],
    h: ["Start only after the capacity fixes: sync failures, backups, MFA", "Agree the pilot terms: length, scope, price", "Review results with the client"],
    a: "Onboarding checklist, results summary", d: "Pilot dates, products, results, terms",
  },
  s10: {
    e: "Proposal requested.", x: "Contract signed",
    s: ["Creates the review task and chasers at day 3 and 7", "Holds everything for human review; nothing sends on its own"],
    h: ["Set the commercial terms: package, locations, per-location fee, revenue share, milestone bonus", "Handle pushback on terms"],
    a: "Proposal template, ROI summary", d: "Value, package, term, discount, e-sign status",
  },
  s11: {
    e: "Signature received.", x: "Handover done",
    s: ["Sets payment to Invoiced", "Creates the handover, welcome email and invoice tasks", "Opens the onboarding checklist"],
    h: ["Hand over to onboarding with all notes"],
    a: "Welcome email", d: "Contract date, monthly value, start date",
  },
  s12: {
    e: "Kickoff held.", x: "First automatic price pushed live",
    s: ["Shows the go-live checklist", "Creates the kickoff task"],
    h: ["Connect FareHarbor or Peek, confirm syncing, turn on price push", "Set up all 9 FactorIQ factors, alert recipients and timezone", "Run the kickoff call and train the client team"],
    a: "Onboarding guide, training session", d: "Platform, products, integration status, go-live date",
  },
  s13: {
    e: "First price pushed.", x: "Stays here as an active client",
    s: ["Creates the 30, 60 and 90-day check-ins", "Day 60 check-in carries the referral ask"],
    h: ["Day 30: is everything working?", "Day 60: first uplift numbers; ask who else should know", "Day 90: full report; ask for a case study; discuss more locations"],
    a: "Uplift report, case study request", d: "First price date, revenue lift, case-study OK, referrals",
  },
  g1: {
    t: "Grow (story, referral, expand)", o: "Nikunj and Param", l: "From day 60",
    e: "The client's results are showing.", x: "The loop restarts with new deals",
    s: ["A referral becomes a new deal with the referral source, entering at 3 or 5", "An expansion (more locations, add-ons, another product) becomes a new deal on the same company"],
    h: ["Get written approval before using any client name or number", "Publish the case study: LinkedIn, Tourpreneur, podcast"],
    a: "Case study, winner story", d: "Referral source, case-study approval, expansion deal",
  },
  nurture: {
    e: "Not now, no reply after the sequence, unsupported platform, non-water operator, or two no-shows.", x: "Re-engage date reached",
    s: ["Creates a re-engage task on the check-back date", "Flags the deal when the date passes"],
    h: ["Send a fresh Snapshot before their busy season, or new content"],
    a: "Newsletter, reports, videos, fresh Snapshot", d: "Reason, re-engage date",
  },
  lost: {
    e: "A clear no, an unsubscribe, or a declined proposal.", x: "Can reopen into Nurture later",
    s: ["Requires a loss reason", "Creates a 90-day review task, except for unsubscribes"],
    h: ["Review loss reasons monthly: what to fix in product, pricing or pitch", "Honour unsubscribes permanently"],
    a: "None", d: "Loss reason, competitor, re-engage date",
  },
};

export type ChecklistItem = readonly [key: string, label: string];

export const QUAL_ITEMS: ChecklistItem[] = [
  ["volume", "Enough volume for dynamic pricing (many departures, busy seasons)"],
  ["dm", "The decision-maker is involved"],
  ["platform", "Booking platform supported (FareHarbor = go; Peek Pro = flag)"],
  ["vertical", "Water or marine operator (the only proven vertical)"],
  ["budget", "Timing and budget fit a package"],
];
export const PILOT_ITEMS: ChecklistItem[] = [
  ["capacity", "Capacity fixes done: sync failures, backups, MFA"],
  ["terms", "Pilot terms agreed: length, scope, price"],
  ["connected", "Booking platform connected and syncing"],
  ["results", "Results reviewed with the client"],
];
export const ONBOARD_ITEMS: ChecklistItem[] = [
  ["connect", "FareHarbor or Peek connected and syncing"],
  ["push", "Price push turned on"],
  ["ml", "Demand Forecasting and Price Optimizer recommendations arriving"],
  ["factors", "All 9 FactorIQ factors set up"],
  ["alerts", "Alert recipients added"],
  ["tz", "Timezone set correctly"],
  ["kickoff", "Kickoff call and team training done"],
  ["firstprice", "First automatic price pushed live"],
];

/** Stage checklists: every item must be ticked before the deal moves forward. */
export const CHECKLISTS: Partial<Record<StageKey, { field: "qual" | "pilotChecks" | "onboarding"; items: ChecklistItem[] }>> = {
  s8: { field: "qual", items: QUAL_ITEMS },
  pilot: { field: "pilotChecks", items: PILOT_ITEMS },
  s12: { field: "onboarding", items: ONBOARD_ITEMS },
};

/** Lead source → entry stage */
export const SOURCES: readonly (readonly [name: string, entry: StageKey])[] = [
  ["Arival booth", "s5"], ["Spark booth", "s5"], ["Arival report / newsletter", "s3"],
  ["Outbound list", "s1"], ["Pre-show outreach", "s4"], ["Partner referral", "s5"],
  ["Client referral", "s5"], ["Platform / OTA intro", "s5"], ["Inbound (website, video)", "s6"],
  ["Pre-booked meeting", "s6"], ["Existing client (expansion)", "s5"],
];
export const SOURCE_NAMES: string[] = SOURCES.map((s) => s[0]);
export const BOOTH_SOURCES = ["Arival booth", "Spark booth"];

export const SEGMENTS = ["Water / boat", "Adventure", "Food / walking / city", "Attractions / multi-product", "Other"];
export const PLATFORMS = ["FareHarbor", "Peek Pro", "Ventrata", "Rezdy", "Xola", "Checkfront", "Bókun", "Other / unknown"];
export const LOSS_REASONS = ["Price", "Timing", "Wrong platform", "Chose a competitor", "No reply", "No budget", "Unsubscribed", "Other"];
export const NURTURE_REASONS = ["Not now", "No reply after the sequence", "Unsupported platform", "Not a water operator yet", "No-show twice", "Other"];
export const PAY_STATUS = ["Not invoiced", "Invoiced", "Paid", "Late"] as const;
export const INTERESTS = ["Hot", "Warm", "Cold"] as const;
export const ACT_TYPES: readonly (readonly ["note" | "email" | "call" | "meeting", string])[] = [
  ["note", "Note"], ["email", "Email"], ["call", "Call"], ["meeting", "Meeting"],
];
export const ROLE_SUGGESTIONS = ["Owner", "General manager", "Revenue manager", "Marketing lead", "Operations lead"];

export const RULES: readonly (readonly [key: RuleKey, when: string, then: string])[] = [
  ["r_capture48", "Booth lead captured", "Follow-up task due in 48 hours"],
  ["r_owner", "Deal moves to a new stage", "Hand it to that stage's owner"],
  ["r_autoclose", "Deal leaves a stage", "Close that stage's open automatic tasks"],
  ["r_contact", "Contact found", "Task to confirm the decision-maker and check LinkedIn by hand"],
  ["r_brief", "Researched", "Task to read and approve the research brief"],
  ["r_sequence", "Outreach sent", "First message today, follow-ups on day 3, 7 and 14, LinkedIn task"],
  ["r_reply", "Replied", "Stop follow-ups; answer within 2 hours"],
  ["r_demo", "Demo booked", "Prep task and Snapshot task due before the demo"],
  ["r_followup", "Demo done", "Follow-up within 24 hours; book the next call"],
  ["r_qualify", "Qualified", "Go / no-go decision within 3 days"],
  ["r_second", "Second call", "Snapshot on their data; hold the call within 10 days"],
  ["r_pilot", "Pilot", "Terms, capacity check and results review tasks; warn above 5 pilots"],
  ["r_proposal", "Proposal", "Review before sending; chase at day 3 and 7"],
  ["r_signed", "Signed", "Payment set to Invoiced; handover, welcome email and invoice tasks"],
  ["r_onboard", "Onboarding", "Kickoff task and go-live checklist"],
  ["r_live", "Live", "30, 60 and 90-day check-ins; referral ask on day 60"],
  ["r_nurture", "Nurture", "Re-engage task on the check-back date"],
  ["r_lost", "Lost", "Loss reason required; 90-day review (not for unsubscribes)"],
];

export const TARGET_FIELDS: readonly (readonly [TargetKey, string])[] = [
  ["leads", "Leads"], ["outreach", "Outreach sent"], ["demosHeld", "Demos held"], ["snapshots", "Snapshots sent"], ["signed", "Signed"],
];

export const DEFAULT_SETTINGS: PipelineSettings = {
  team: DEFAULT_TEAM,
  rules: Object.fromEntries(RULES.map((r) => [r[0], true])) as Record<RuleKey, boolean>,
  targets: { leads: 300, outreach: 150, demosHeld: 30, snapshots: 100, signed: 2 },
};

export const PILOT_CAP = 5;
