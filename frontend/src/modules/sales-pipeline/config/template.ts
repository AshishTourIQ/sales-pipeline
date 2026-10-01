import type {
  BuiltinStageKey, CallType, CompanyCategory, FollowupDefault, FollowupKey, Interest, LinkKey, OfferKey, PhaseKey, PipelineSettings,
  PipelineTemplate, RuleKey, StageKey, StageTemplate,
  TargetKey, TeamMember, Tier, TouchpointKind, Track, VisitorType,
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
  { key: "offer", num: null, name: "Offer sent", phase: "engage", limit: 14, ownerId: "param", optional: true },
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

/** Integration partners: booking platforms and OTAs. Goal: a pilot client on their platform, then integrated. */
export const PARTNER_TEMPLATE: StageTemplate[] = [
  { key: "pt1", num: 1, name: "Identified", phase: "find", limit: 7, ownerId: "guddu" },
  { key: "pt2", num: 2, name: "Partnerships contact", phase: "find", limit: 7, ownerId: "guddu" },
  { key: "pt3", num: 3, name: "Intro call", phase: "engage", limit: 14, ownerId: "nikunj" },
  { key: "pt4", num: 4, name: "Integration scoping", phase: "win", limit: 21, ownerId: "manjit" },
  { key: "pt5", num: 5, name: "Pilot client", phase: "win", limit: 30, ownerId: "manjit" },
  { key: "pt6", num: 6, name: "Integrated", phase: "launch", limit: null, ownerId: "manjit" },
];
/** Channel partners: OTAs (Viator, GetYourGuide). They already accept dynamic pricing: build the channel. */
export const CHANNEL_TEMPLATE: StageTemplate[] = [
  { key: "ch1", num: 1, name: "Identified", phase: "find", limit: 7, ownerId: "guddu" },
  { key: "ch2", num: 2, name: "Partnerships contact", phase: "find", limit: 7, ownerId: "guddu" },
  { key: "ch3", num: 3, name: "Intro call", phase: "engage", limit: 14, ownerId: "nikunj" },
  { key: "ch4", num: 4, name: "Channel agreement", phase: "win", limit: 30, ownerId: "nikunj" },
  { key: "ch5", num: 5, name: "Channel live", phase: "launch", limit: null, ownerId: "manjit" },
];
/** Referral partners: revenue managers and agencies who bring clients for a commission (and the reverse). */
export const REFERRAL_TEMPLATE: StageTemplate[] = [
  { key: "rf1", num: 1, name: "Identified", phase: "find", limit: 7, ownerId: "param" },
  { key: "rf2", num: 2, name: "Intro call", phase: "engage", limit: 14, ownerId: "nikunj" },
  { key: "rf3", num: 3, name: "Agreement", phase: "win", limit: 14, ownerId: "nikunj" },
  { key: "rf4", num: 4, name: "Active partner", phase: "launch", limit: null, ownerId: "nikunj" },
];
const LANE_STAGES = TEMPLATE.filter((t) => t.lane);
export const PIPELINE_TEMPLATES: Record<PipelineTemplate, { label: string; stages: StageTemplate[] }> = {
  touriq: { label: "Sales: tour operators", stages: TEMPLATE },
  partners: { label: "Integrations: booking platforms", stages: [...PARTNER_TEMPLATE, ...LANE_STAGES] },
  channels: { label: "Channels: OTAs", stages: [...CHANNEL_TEMPLATE, ...LANE_STAGES] },
  referrals: { label: "Referrals: revenue managers and agencies", stages: [...REFERRAL_TEMPLATE, ...LANE_STAGES] },
};
/** Every built-in stage across the templates (for looking up a key's defaults). */
export const ALL_TEMPLATE_STAGES: StageTemplate[] = [...TEMPLATE, ...PARTNER_TEMPLATE, ...CHANNEL_TEMPLATE, ...REFERRAL_TEMPLATE];

/**
 * Built-in main route order. A pipeline's real order is its own stage list
 * (lib/pipeline.ts); this only maps a removed built-in stage to the next one that exists.
 */
export const ORDER: StageKey[] = ["s1", "s2", "s3", "s4", "s5", "offer", "s6", "s7", "s8", "s9", "pilot", "s10", "s11", "s12", "s13"];

export type Route = readonly [label: string, to: StageKey];

export const ROUTES: Record<StageKey, Route[]> = {
  s1: [["Picked", "s2"], ["Not a fit yet", "nurture"]],
  s2: [["Confirmed", "s3"]],
  s3: [["Brief approved", "s4"]],
  s4: [["Reply came in", "s5"], ["No reply after day 14", "nurture"]],
  s5: [["Interested", "s6"], ["Offer game, analysis or audit", "offer"], ["Wrong person", "s2"], ["Not now", "nurture"], ["No", "lost"]],
  offer: [["Demo booked", "s6"], ["No demo after 14 days", "nurture"], ["No", "lost"]],
  s6: [["Demo held", "s7"], ["No-show twice", "nurture"]],
  s7: [["Summary saved, follow-up sent", "s8"]],
  s8: [["Go", "s9"], ["Not supported yet", "nurture"], ["Clear no", "lost"]],
  s9: [["Wants a pilot", "pilot"], ["Wants a proposal", "s10"], ["Silent 30 days", "nurture"]],
  pilot: [["Positive result", "s10"], ["Not now", "nurture"], ["No", "lost"]],
  s10: [["Signed", "s11"], ["Declined", "lost"]],
  s11: [["Handover done", "s12"]],
  s12: [["First price pushed", "s13"]],
  s13: [],
  pt1: [["Worth approaching", "pt2"], ["Not now", "nurture"]],
  pt2: [["Contact found", "pt3"]],
  pt3: [["Intro held, they're interested", "pt4"], ["Not now", "nurture"], ["No", "lost"]],
  pt4: [["Plan agreed", "pt5"], ["Stalled", "nurture"]],
  pt5: [["Pilot went well", "pt6"], ["No", "lost"]],
  pt6: [],
  ch1: [["Worth approaching", "ch2"], ["Not now", "nurture"]],
  ch2: [["Contact found", "ch3"]],
  ch3: [["Intro held, they're interested", "ch4"], ["Not now", "nurture"], ["No", "lost"]],
  ch4: [["Agreement signed", "ch5"], ["Stalled", "nurture"]],
  ch5: [],
  rf1: [["Worth approaching", "rf2"], ["Not now", "nurture"]],
  rf2: [["Interested", "rf3"], ["Not now", "nurture"], ["No", "lost"]],
  rf3: [["Agreement signed", "rf4"], ["No", "lost"]],
  rf4: [],
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
  offer: {
    e: "They took the game, the comparative analysis or the audit instead of a demo (booth tiers B to D, or the tools' own forms).", x: "They book a demo",
    s: ["Creates the task to send what was offered: game result, analysis report or audit form, then the audit report", "Reminds you on day 3 and day 7 to ask for a demo; flags the deal after 14 days", "Logs each step the tools report (played, viewed, sent data) on the deal's journey"],
    h: ["Send the offer the same day it's due", "Every message ends with the demo booking link", "No demo after 14 days: move to Nurture"],
    a: "Pricing game, comparative analysis report, audit report", d: "Track, game score, report links, dates of each step",
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
  pt1: { e: "A booking platform or OTA we could integrate with (FareHarbor, Peek, Ventrata, Rezdy, Viator, GetYourGuide...).", x: "Worth approaching", s: ["Nothing automatic yet"], h: ["Check what they integrate with and who their pricing partners are"], a: "None", d: "Platform, clients, existing pricing partners" },
  pt2: { e: "Picked to approach.", x: "A named partnerships or integrations contact", s: ["Task to find the head of partnerships or integrations"], h: ["Find the person on LinkedIn by hand; never automated"], a: "None", d: "Name, title, email, LinkedIn" },
  pt3: { e: "Contact found.", x: "Intro call held and they want to go further", s: ["Intro task today, a follow-up reminder on day 5, the call within 14 days"], h: ["Lead with our live FareHarbor integration and the Peek build", "Ask how they work with pricing partners"], a: "Integration one-pager, demo account", d: "Their partner process, decision-makers" },
  pt4: { e: "They want to integrate.", x: "An integration plan with an owner on their side", s: ["Tasks to share what we need and agree the plan"], h: ["Get API access, price push and a test account", "Agree who does what, and by when"], a: "API requirements", d: "Plan, owner, dates" },
  pt5: { e: "Integration planned.", x: "A pilot client is live on their platform", s: ["Tasks to pick and launch the pilot client"], h: ["Pick an operator who already uses their platform", "Review the results with both sides"], a: "Pilot results", d: "Pilot client, results" },
  pt6: { e: "The integration works for a live client.", x: "Stays here as an active partner", s: ["Reminders: announce it, then a monthly check-in"], h: ["Announce together", "Ask them to introduce us to their operators"], a: "Joint announcement", d: "Clients launched through them" },
  ch1: { e: "An OTA that sells tours (Viator, GetYourGuide...). They already accept dynamic pricing from other providers.", x: "Worth approaching", s: ["Nothing automatic yet"], h: ["Check which pricing providers already feed them"], a: "None", d: "Their partner programme, markets" },
  ch2: { e: "Picked to approach.", x: "A named partnerships or integrations contact", s: ["Task to find the head of partnerships or integrations"], h: ["Find the person on LinkedIn by hand; never automated"], a: "None", d: "Name, title, email, LinkedIn" },
  ch3: { e: "Contact found.", x: "Intro call held and they want the channel", s: ["Intro task today, a follow-up reminder on day 5, the call within 14 days"], h: ["Explain how operators' dynamic prices reach their listings", "Ask what they need technically (API, feed)"], a: "Channel one-pager", d: "Their requirements, decision-makers" },
  ch4: { e: "They want the channel.", x: "Channel agreement signed", s: ["Tasks to agree how prices reach them and sign"], h: ["Agree the technical route and the terms"], a: "Channel agreement", d: "Terms, technical route, dates" },
  ch5: { e: "Agreement signed.", x: "Stays here as an active channel", s: ["Reminders: first operator live, then a monthly check-in"], h: ["Get the first operator's prices live through them"], a: "Launch note", d: "Operators live through the channel" },
  rf1: { e: "A revenue manager, consultant or agency that works with operators.", x: "Worth approaching", s: ["Nothing automatic yet"], h: ["Check which operators they manage"], a: "None", d: "Operators they manage" },
  rf2: { e: "Picked to approach.", x: "They want to refer clients", s: ["Task to hold the intro call"], h: ["Explain the commission both ways: they bring clients, we pay a share"], a: "Partner one-pager", d: "How they sell, who they know" },
  rf3: { e: "They want to work with us.", x: "Referral agreement signed", s: ["Tasks to agree the commission and sign"], h: ["Record the commission % on the deal"], a: "Referral agreement", d: "Commission %, terms" },
  rf4: { e: "Agreement signed.", x: "Stays here as an active partner", s: ["Monthly check-in reminder"], h: ["Send fresh material; track which clients came from them (lead source: Partner referral)"], a: "Case studies, decks", d: "Referred clients, commission owed" },
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
  ["Pre-booked meeting", "s6"], ["Existing client (expansion)", "s5"], ["Arival app meeting", "s6"],
  ["LinkedIn", "s5"], ["Instagram / Facebook", "s5"], ["Game", "s5"], ["Comparative analysis", "s5"], ["Audit", "s5"],
  ["Event booth", "s5"],
];
export const SOURCE_NAMES: string[] = SOURCES.map((s) => s[0]);
/** Met in person at a stand; the event itself is Deal.event */
export const BOOTH_SOURCES = ["Arival booth", "Spark booth", "Event booth"];
/** Suggested in the Event fields; any other name can be typed (future events). */
export const DEFAULT_EVENTS = ["Arival 2026", "Spark 2026"];
/** The booth source for an event name: Arival and Spark have their own, other events share one. */
export const sourceForEvent = (event: string): string =>
  /arival/i.test(event) ? "Arival booth" : /spark/i.test(event) ? "Spark booth" : "Event booth";
/** Event suggestions: the defaults plus every event already used. */
export const eventOptions = (events: string[]): string[] =>
  [...new Set([...DEFAULT_EVENTS, ...events.map((e) => e.trim()).filter(Boolean)])];

export const SEGMENTS = ["Water / boat", "Adventure", "Food / walking / city", "Attractions / multi-product", "Other"];
export const PLATFORMS = ["FareHarbor", "Peek Pro", "Ventrata", "Rezdy", "Xola", "Checkfront", "Bókun", "Other / unknown"];
export const LOSS_REASONS = ["Price", "Timing", "Wrong platform", "Chose a competitor", "No reply", "No budget", "Unsubscribed", "Not a prospect", "Other"];
/** No "worth re-engaging?" review for these */
export const NO_REVIEW_LOSS_REASONS = ["Unsubscribed", "Not a prospect"];
export const NURTURE_REASONS = ["Not now", "No reply after the sequence", "Unsupported platform", "Not a water operator yet", "No-show twice", "Partner hand-off", "Press hand-off", "Other"];
export const PAY_STATUS = ["Not invoiced", "Invoiced", "Paid", "Late"] as const;
export const INTERESTS = ["Hot", "Warm", "Cold"] as const;
export const ACT_TYPES: readonly (readonly ["note" | "email" | "call" | "meeting", string])[] = [
  ["note", "Note"], ["email", "Email"], ["call", "Call"], ["meeting", "Meeting"],
];
export const ROLE_SUGGESTIONS = ["Owner", "General manager", "Revenue manager", "Marketing lead", "Operations lead"];

/* ---------- Booth lead form (the Arival paper sheet) ----------
 * Must match backend sales_pipeline/config.py; tests/test_scoring.py reads BOOTH_QUESTIONS
 * below as JSON and compares it, so keep that literal strict JSON (double quotes, no trailing commas).
 * Staff never see the points: the form shows only the total and the tier.
 */

export interface BoothOption { key: string; label: string; points: number }
export interface BoothQuestion { key: string; label: string; options: BoothOption[] }

export const BOOTH_QUESTIONS: BoothQuestion[] = [
  {"key": "booking", "label": "Booking system", "options": [
    {"key": "fareharbor", "label": "FareHarbor", "points": 3}, {"key": "peek", "label": "Peek Pro", "points": 2},
    {"key": "ventrata_rezdy", "label": "Ventrata / Rezdy", "points": 1}, {"key": "other", "label": "Bókun / Xola / other", "points": 0}]},
  {"key": "volume", "label": "Yearly bookings", "options": [
    {"key": "over_5m", "label": "Over $5M", "points": 3}, {"key": "1m_5m", "label": "$1M–$5M", "points": 2},
    {"key": "250k_1m", "label": "$250K–$1M", "points": 1}, {"key": "under_250k", "label": "Under $250K", "points": 0}]},
  {"key": "role", "label": "Their role", "options": [
    {"key": "decider", "label": "Owner / CEO / GM / revenue lead", "points": 3}, {"key": "manager", "label": "Manager / influencer", "points": 1},
    {"key": "staff", "label": "Staff / other", "points": 0}]},
  {"key": "timeline", "label": "Timeline", "options": [
    {"key": "under_3m", "label": "Under 3 months", "points": 3}, {"key": "3_6m", "label": "3–6 months", "points": 2},
    {"key": "6_12m", "label": "6–12 months", "points": 1}, {"key": "none", "label": "None", "points": 0}]},
  {"key": "locations", "label": "Locations / brands", "options": [
    {"key": "3_plus", "label": "3 or more", "points": 2}, {"key": "2", "label": "2", "points": 1}, {"key": "1", "label": "1", "points": 0}]},
  {"key": "sellouts", "label": "Sell-outs + empty seats", "options": [
    {"key": "often", "label": "Often", "points": 2}, {"key": "sometimes", "label": "Sometimes", "points": 1}, {"key": "no", "label": "No", "points": 0}]},
  {"key": "pricing", "label": "Prices set today", "options": [
    {"key": "fixed", "label": "Fixed / seasonal, open to change", "points": 2}, {"key": "rules", "label": "Rules or uses a tool", "points": 1},
    {"key": "happy", "label": "Happy as is", "points": 0}]},
  {"key": "drivers", "label": "Outside drivers", "options": [
    {"key": "yes", "label": "Yes (ships, flights, events, weather)", "points": 1}, {"key": "no", "label": "No", "points": 0}]}
];

export const SCORE_MAX = BOOTH_QUESTIONS.reduce((s, q) => s + Math.max(...q.options.map((o) => o.points)), 0);
/** Lowest total for each tier, best first */
export const TIER_BANDS: readonly (readonly [Tier, number])[] = [["A", 15], ["B", 10], ["C", 5], ["D", 0]];
/** Not the decider, or a booking system we aren't connected to: at most B */
export const CAP_TIER: Tier = "B";
export const CAP_OK: Record<string, string[]> = { role: ["decider"], booking: ["fareharbor", "peek"] };

export const VISITOR_TYPES: readonly (readonly [VisitorType, string, string])[] = [
  ["operator", "Operator", "Scored below"],
  ["competitor", "Competitor", "Tier D, never contacted"],
  ["consultant", "Consultant", "Handed to partners"],
  ["platform", "Booking platform / OTA", "Handed to partners"],
  ["press", "Press / Arival", "Handed to press"],
  ["vendor", "Vendor / student", "Tier D, game only"],
];
export const PARTNER_VISITORS: VisitorType[] = ["consultant", "platform"];
export const NOT_PROSPECT_VISITORS: VisitorType[] = ["competitor", "vendor"];

export const OFFERS: readonly (readonly [OfferKey, string])[] = [
  ["demo_given", "Demo given"], ["demo_booked", "Demo booked"], ["audit", "Audit booked"], ["analysis", "Competitive analysis"], ["game", "Game only"],
];
export const CALL_TYPES: readonly (readonly [CallType, string, string])[] = [
  ["team_demo", "Team demo", "Another demo, for the people who weren't on the first one"],
  ["commercial", "Commercial call", "Pricing: package, locations, fees, revenue share"],
];

export const CATEGORIES: readonly (readonly [CompanyCategory, string])[] = [
  ["operator", "Tour operator"], ["booking_platform", "Booking platform"], ["ota", "OTA"],
  ["revenue_manager", "Revenue manager / consultant"], ["agency", "Agency / other software"], ["competitor", "Competitor"], ["other", "Other"],
];
/** Booth visitor type → company category (mirror of backend VISITOR_CATEGORY) */
export const VISITOR_CATEGORY: Record<VisitorType, CompanyCategory> = {
  operator: "operator", platform: "booking_platform", consultant: "revenue_manager", competitor: "competitor", press: "other", vendor: "other",
};
/** Partner hand-offs go to the pipeline built for their category */
export const CATEGORY_TEMPLATE: Partial<Record<CompanyCategory, PipelineTemplate>> = {
  booking_platform: "partners", ota: "channels", revenue_manager: "referrals", agency: "referrals",
};
/** Company type from free text (spreadsheets). Mirror of backend config.category_from_text. */
const CATEGORY_WORDS: readonly (readonly [string, CompanyCategory])[] = [
  ["competitor", "competitor"], ["ota", "ota"], ["viator", "ota"], ["getyourguide", "ota"], ["marketplace", "ota"],
  ["booking platform", "booking_platform"], ["booking system", "booking_platform"], ["platform", "booking_platform"],
  ["revenue", "revenue_manager"], ["consultant", "revenue_manager"],
  ["agency", "agency"], ["software", "agency"], ["marketing", "agency"],
  ["operator", "operator"], ["tour", "operator"], ["other", "other"],
];
export function categoryFromText(v: string): CompanyCategory | "" {
  const s = String(v || "").trim().toLowerCase().replace(/_/g, " ");
  if (!s) return "";
  const byKey = CATEGORIES.find(([k]) => k.replace(/_/g, " ") === s);
  if (byKey) return byKey[0];
  const byLabel = CATEGORIES.find(([, label]) => label.toLowerCase() === s);
  if (byLabel) return byLabel[0];
  return CATEGORY_WORDS.find(([w]) => s.includes(w))?.[1] ?? "other";
}
export const isCompetitor = (d: { company: { category?: string } }) => d.company.category === "competitor";

export const LINK_KEYS: readonly (readonly [LinkKey, string, string])[] = [
  ["booking_link", "Demo booking link", "Your calendar link. AI drafts use it wherever they'd write [booking link]."],
  ["demo_deck", "Demo deck", "The PDF or slides sent with the demo invite."],
  ["audit_example", "Sample audit report", "What the audit report looks like, for people deciding on the audit."],
  ["analysis_example", "Sample comparative analysis", "What the comparative analysis looks like."],
  ["game_link", "Pricing game link", "Emailed to Game only booth leads who haven't played. Empty = the placeholder link set on the server."],
];

/** Offers that put a deal on a track in "Offer sent" */
export const TRACKS: readonly (readonly [Track, string])[] = [["game", "Game"], ["analysis", "Comparative analysis"], ["audit", "Audit"]];
export const isTrack = (o: string): o is Track => TRACKS.some(([k]) => k === o);

export const TOUCHPOINT_KINDS: readonly (readonly [TouchpointKind, string, Track | ""])[] = [
  ["game_link_sent", "Game link emailed", "game"],
  ["game_played", "Played the game", "game"],
  ["analysis_requested", "Comparative analysis requested", "analysis"],
  ["analysis_viewed", "Viewed the comparative analysis", "analysis"],
  ["analysis_sent", "Comparative analysis report sent", "analysis"],
  ["audit_submitted", "Sent booking data for the audit", "audit"],
  ["audit_report_sent", "Audit report sent", "audit"],
  ["demo_requested", "Asked for a demo", ""],
  ["demo_booked", "Demo booked", ""],
  ["demo_held", "Demo held", ""],
];
export const touchpointLabel = (k: string) => TOUCHPOINT_KINDS.find((x) => x[0] === k)?.[1] ?? k;

export const OFFER_FOR_TIER: Record<Tier, OfferKey> = { A: "demo_booked", B: "audit", C: "analysis", D: "game" };
export const TIER_INTEREST: Record<Tier, Interest> = { A: "Hot", B: "Warm", C: "Warm", D: "Cold" };
/** Booking-system answer → Company.platform (the combined options stay unset) */
export const PLATFORM_FOR_BOOKING: Record<string, string> = { fareharbor: "FareHarbor", peek: "Peek Pro" };

export const FOLLOWUP_KEYS: readonly (readonly [FollowupKey, string])[] = [
  ["A", "Tier A"], ["B", "Tier B"], ["C", "Tier C"], ["D", "Tier D"], ["partner", "Partner hand-off"], ["press", "Press hand-off"],
];
/** Owner by team member id (the default team uses usernames as ids, like stage owners). */
export const BOOTH_FOLLOWUP_DEFAULTS: Record<FollowupKey, FollowupDefault> = {
  A: { ownerId: "nikunj", days: 0 }, B: { ownerId: "manjit", days: 2 }, C: { ownerId: "manjit", days: 3 }, D: { ownerId: "param", days: 7 },
  partner: { ownerId: "nikunj", days: 3 }, press: { ownerId: "param", days: 3 },
};

export const RULES: readonly (readonly [key: RuleKey, when: string, then: string])[] = [
  ["r_capture48", "Booth lead captured", "Follow-up task due in 48 hours"],
  ["r_owner", "Deal moves to a new stage", "Hand it to that stage's owner"],
  ["r_autoclose", "Deal leaves a stage", "Close that stage's open automatic tasks"],
  ["r_contact", "Contact found", "Task to confirm the decision-maker and check LinkedIn by hand"],
  ["r_brief", "Researched", "Task to read and approve the research brief"],
  ["r_sequence", "Outreach sent", "First message today, follow-ups on day 3, 7 and 14, LinkedIn task"],
  ["r_reply", "Replied", "Stop follow-ups; answer within 2 hours"],
  ["r_offer", "Offer sent", "Send the game, analysis or audit; ask for a demo on day 3 and 7; flag after 14 days"],
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
  ["r_partner", "Integrations pipeline stages", "Contact, intro, integration plan and pilot-client tasks; partner check-ins"],
  ["r_channel", "Channels pipeline stages (OTAs)", "Contact, intro, channel agreement; first operator live; monthly check-in"],
  ["r_referral", "Referrals pipeline stages", "Intro call, commission agreement, monthly check-in"],
];

export const TARGET_FIELDS: readonly (readonly [TargetKey, string])[] = [
  ["leads", "Leads"], ["outreach", "Outreach sent"], ["demosHeld", "Demos held"], ["snapshots", "Snapshots sent"], ["signed", "Signed"],
];

export const DEFAULT_SETTINGS: PipelineSettings = {
  team: DEFAULT_TEAM,
  rules: Object.fromEntries(RULES.map((r) => [r[0], true])) as Record<RuleKey, boolean>,
  targets: { leads: 300, outreach: 150, demosHeld: 30, snapshots: 100, signed: 2 },
  boothFollowup: BOOTH_FOLLOWUP_DEFAULTS,
  links: {},
  eventCosts: {},
};

export const PILOT_CAP = 5;
