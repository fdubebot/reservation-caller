export type ParsedBusinessReply = {
  raw: string;
  availability: "yes" | "no" | "unknown";
  offeredTimes: string[];
  hasDeposit: boolean;
  hasCancellationPolicy: boolean;
  needsCallback: boolean;
  confidence: number;
};

export type NegotiationDecision = {
  status: "confirm" | "reject" | "clarify" | "needs_approval";
  reason: string;
  proposedTime?: string;
  notes?: string;
};
