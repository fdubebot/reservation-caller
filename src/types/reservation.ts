export type ReservationRequest = {
  requestId: string;
  businessName: string;
  businessPhone: string;
  date: string;
  timePreferred: string;
  partySize: number;
  nameForBooking: string;
  constraints?: {
    timeFlexMinutes?: number;
    outdoorPreferred?: boolean;
    dietary?: string[];
    accessibility?: string;
    maxWaitMinutes?: number;
  };
  policy?: {
    allowAutoConfirm?: boolean;
    allowDeposit?: boolean;
    requireHumanOnAmbiguity?: boolean;
  };
};

export type CallStatus =
  | "INIT"
  | "DIALING"
  | "CONNECTED"
  | "DISCOVERY"
  | "NEGOTIATION"
  | "PROPOSED_OUTCOME"
  | "WAITING_USER_APPROVAL"
  | "CONFIRMED"
  | "FAILED"
  | "ENDED";

export type CallOutcome = {
  status: "confirmed" | "pending" | "failed" | "voicemail";
  confirmedDetails?: {
    date: string;
    time: string;
    partySize: number;
    name: string;
    notes?: string;
  };
  needsUserApproval: boolean;
  confidence: number;
  reason?: string;
};

export type CallRecord = {
  id: string;
  reservation: ReservationRequest;
  status: CallStatus;
  createdAt: string;
  updatedAt: string;
  transcript: Array<{ at: string; speaker: "assistant" | "business" | "system"; text: string }>;
  outcome?: CallOutcome;
  twilioCallSid?: string;
};
