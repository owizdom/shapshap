// Shared types for the ShapShap conversation eval harness. Erasable TypeScript only.

// One step as Chord reports it in the chat response (docs: chat.txt, section 4).
export interface Step {
  title?: string | null;
  instruction?: unknown;
  tool_name?: string | null;
  success?: boolean | null;
  latency_ms?: number | null;
  result?: unknown;
  structured?: unknown;
  structured_type?: string | null;
  citations?: unknown;
}

export interface ChatResponse {
  thread_id: string | null;
  reply: string | null;
  agent_invoked: boolean;
  reason: string | null;
  steps: Step[] | null;
}

export interface TurnRecord {
  customer: string;
  reply: string | null;
  agent_invoked: boolean;
  reason: string | null;
  steps: Step[];
}

export interface Transcript {
  scenario: string;
  run: number;
  session_id: string;
  sender_id: string;
  turns: TurnRecord[];
  error?: string;
}

export interface GradeResult { pass: boolean; detail: string }

export interface Check { grader: string; args?: Record<string, unknown> }

export interface Scenario {
  id: string;
  description: string;
  turns: string[]; // scripted customer messages, 1 to 3
  checks: Check[]; // scenario-specific graders, run in addition to DEFAULT_CHECKS
}

export interface GradeCtx { scenario: Scenario; transcript: Transcript }

export type Grader = (ctx: GradeCtx, args: Record<string, unknown>) => GradeResult;

export interface ChordClient {
  send(input: { session_id: string; sender_id: string; text: string }): Promise<ChatResponse>;
  // cumulative credits consumed according to GET /v1/usage
  usage(): Promise<number>;
}
