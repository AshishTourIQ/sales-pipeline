/**
 * Automation rules: which tasks a deal gets when it enters a stage.
 *
 * In production this runs in Django (backend/sales_pipeline/services/rules.py)
 * so every client gets the same tasks. The mock adapter runs this same code so
 * the UI behaves identically before the backend exists. Keep the two in sync.
 *
 * blocking = must be done before the deal can move forward. Reminders
 * ("just in case" follow-ups) don't block. Each stage whose exit is an outside
 * event (a reply, a booked demo, a signature) gets a "tick when..." exit task.
 */
import type { PipelineSettings, RuleKey, StageKey } from "../types";
import { addDays, dayDiff, today } from "./dates";

export interface RuleTask {
  rule: RuleKey;
  title: string;
  due: string;
  blocking: boolean;
}

export interface RuleExtra {
  demoDate?: string;
  reengageDate?: string;
  lossReason?: string;
  /** Booth leads were met in person: no "answer the reply" task */
  booth?: boolean;
}

export function ruleTasks(to: StageKey, settings: PipelineSettings, extra: RuleExtra = {}): RuleTask[] {
  const T: RuleTask[] = [];
  const add = (rule: RuleKey, title: string, due: string, blocking = true) => {
    if (settings.rules[rule] !== false) T.push({ rule, title, due, blocking });
  };
  const remind = (rule: RuleKey, title: string, due: string) => add(rule, title, due, false);
  const demo = extra.demoDate ? extra.demoDate.slice(0, 10) : null;
  const beforeDemo = demo ? (dayDiff(demo, today()) > 1 ? addDays(-1, demo) : today()) : addDays(2);

  switch (to) {
    case "s2":
      add("r_contact", "Confirm the decision-maker and check LinkedIn by hand", addDays(2));
      break;
    case "s3":
      add("r_brief", "Read and approve the research brief", addDays(2));
      break;
    case "s4":
      add("r_sequence", "Send the first message with the Pricing Snapshot offer", today());
      add("r_sequence", "LinkedIn: send a connection request by hand", today());
      remind("r_sequence", "Follow-up 1 (day 3): one useful line and the calendar link", addDays(3));
      remind("r_sequence", "Follow-up 2 (day 7): proof, a video or the report", addDays(7));
      remind("r_sequence", "Follow-up 3 (day 14): break-up message; move to Nurture if still quiet", addDays(14));
      add("r_sequence", "They replied: tick when they answer", addDays(14));
      break;
    case "s5":
      if (!extra.booth) add("r_reply", "Answer the reply within 2 hours, with the booking link", today());
      add("r_reply", "Book the demo: tick when it's booked", addDays(2));
      break;
    case "s6":
      add("r_demo", "Prep the demo: read the brief, pick their own tours", beforeDemo);
      add("r_demo", "Get the Pricing Snapshot ready before the demo", beforeDemo);
      add("r_demo", "Hold the demo: tick when it's done", demo ?? addDays(7));
      break;
    case "s7":
      add("r_followup", "Send the follow-up with recap and Snapshot", addDays(1));
      add("r_followup", "Book the next call or meeting", today());
      break;
    case "s8":
      add("r_qualify", "Decide go / no-go with the qualification checklist", addDays(3));
      break;
    case "s9":
      add("r_second", "Build the Pricing Snapshot on their data", addDays(3));
      add("r_second", "Hold the second call", addDays(10));
      break;
    case "pilot":
      add("r_pilot", "Agree pilot terms: length, scope, price", addDays(2));
      add("r_pilot", "Confirm the capacity fixes are done before starting", addDays(2));
      add("r_pilot", "Review pilot results with the client", addDays(30));
      break;
    case "s10":
      add("r_proposal", "Review the proposal before it's sent", addDays(1));
      remind("r_proposal", "Chase the unsigned proposal", addDays(3));
      remind("r_proposal", "Second reminder on the proposal", addDays(7));
      add("r_proposal", "Get the contract signed: tick when signed", addDays(14));
      break;
    case "s11":
      add("r_signed", "Hand over to onboarding with all notes", today());
      add("r_signed", "Send the welcome email", today());
      add("r_signed", "Send the first invoice", today());
      break;
    case "s12":
      add("r_onboard", "Hold the kickoff call; send the 'what we need from you' list", addDays(2));
      break;
    case "s13":
      remind("r_live", "Day-30 check-in: is everything working?", addDays(30));
      remind("r_live", "Day-60 check-in: first uplift; ask for a referral", addDays(60));
      remind("r_live", "Day-90 check-in: full report; ask for a case study", addDays(90));
      break;
    case "nurture":
      remind("r_nurture", "Re-engage: fresh Snapshot or new content", extra.reengageDate || addDays(60));
      break;
    case "lost":
      if (extra.lossReason !== "Unsubscribed") remind("r_lost", "Review: worth re-engaging?", addDays(90));
      break;
    case "s1":
      break;
  }
  return T;
}
