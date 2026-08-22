import type { HarnessEvent } from "./transport.ts";

export interface Squad {
  id: string;
  name: string;
  harnessParticipantId?: string;
  memberNames: string[];
}

export interface Round {
  id: string;
  name: string;
  objective: string;
}

export interface Challenge {
  id: string;
  squadId: string;
  roundId: string;
  objective: string;
  seededDraftIds: string[];
  status: "draft" | "dispatched";
}

export type DraftOrigin = "human" | "harness";

export interface Draft {
  id: string;
  challengeId: string;
  authorName: string;
  origin: DraftOrigin;
  content: string;
}

export interface Decision {
  id: string;
  challengeId: string;
  squadId: string;
  roundId: string;
  build: string;
  cut: string;
  reason: string;
  consideredDraftIds: string[];
  steererName: string;
}

export interface DispatchPayload {
  objective: string;
  input: string;
  expectedOutput: string;
  constraints: string[];
  decision: Decision;
}

export interface Dispatch {
  id: string;
  challengeId: string;
  squadId: string;
  roundId: string;
  sessionId: string;
  payload: DispatchPayload;
}

export interface Review {
  id: string;
  dispatchId: string;
  squadId: string;
  roundId: string;
  outcome: "accepted" | "returned";
  reason?: string;
  reviewerName: string;
}

export interface Escalation {
  id: string;
  squadId: string;
  roundId: string;
  question: string;
  reason: string;
  returnCount: number;
  status: "pending" | "answered";
  response?: string;
}

export type DomainEvent =
  | {
      sequence: number;
      type: "challenge.created";
      challenge: Challenge;
    }
  | { sequence: number; type: "draft.added"; draft: Draft }
  | {
      sequence: number;
      type: "decision.recorded";
      decision: Decision;
    }
  | {
      sequence: number;
      type: "dispatch.sent";
      dispatch: Dispatch;
    }
  | { sequence: number; type: "review.recorded"; review: Review }
  | {
      sequence: number;
      type: "escalation.raised";
      escalation: Escalation;
    }
  | {
      sequence: number;
      type: "escalation.answered";
      escalation: Escalation;
    }
  | {
      sequence: number;
      type: "model.swapped";
      previousModel: string;
      nextModel: string;
      handoff: string;
    }
  | {
      sequence: number;
      type: "harness.event";
      squadId: string;
      event: HarnessEvent;
    };

export interface WorldState {
  squads: Squad[];
  rounds: Round[];
  challenges: Challenge[];
  drafts: Draft[];
  decisions: Decision[];
  dispatches: Dispatch[];
  reviews: Review[];
  escalations: Escalation[];
}

export interface SeededDraftInput {
  authorName?: string;
  content: string;
  origin?: DraftOrigin;
}

export interface CreateChallengeInput {
  id?: string;
  squadId: string;
  roundId: string;
  objective: string;
  seededDrafts: SeededDraftInput[];
}

export interface RecordDecisionInput {
  id?: string;
  challengeId: string;
  build: string;
  cut: string;
  reason: string;
  consideredDraftIds: string[];
  steererName: string;
}

export interface SendDispatchInput {
  id?: string;
  challengeId: string;
  input: string;
  expectedOutput: string;
  constraints?: string[];
}

export interface RecordReviewInput {
  id?: string;
  dispatchId: string;
  outcome: Review["outcome"];
  reason?: string;
  reviewerName: string;
}
