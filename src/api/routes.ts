import express from "express";
import { z } from "zod";
import twilio from "twilio";

import { env, hasTwilioConfig } from "../config/env.js";
import { createOutboundCall } from "../core/twilio.js";
import { notifyOpenClaw } from "../core/notify.js";
import { applyDecision } from "../core/decision.js";
import { answerCallbackQuery, editMessage, sendApprovalPrompt, sendMessage } from "../core/telegram.js";
import { buildAssistantIntro, needsHumanConfirmation } from "../core/policy.js";
import { parseBusinessReply } from "../core/extract.js";
import { decideFromReply } from "../core/negotiate.js";
import { setPendingRevision, getPendingRevision, clearPendingRevision } from "../core/reviseSession.js";
import { createCall, getCall, updateStatus, addTranscript, setOutcome, attachTwilioSid, listCalls, updateReservation } from "../core/store.js";

const reservationSchema = z.object({
  requestId: z.string().optional().default(""),
  businessName: z.string(),
  businessPhone: z.string(),
  date: z.string(),
  timePreferred: z.string(),
  partySize: z.number().int().positive(),
  nameForBooking: z.string(),
  constraints: z.any().optional(),
  policy: z.any().optional(),
});

export const router = express.Router();

function parseRevisionText(text: string): { date?: string; timePreferred?: string; partySize?: number } {
  const out: { date?: string; timePreferred?: string; partySize?: number } = {};
  const date = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (date) out.date = date[1];

  const time = text.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/);
  if (time) out.timePreferred = `${time[1].padStart(2, "0")}:${time[2]}`;

  const party = text.match(/(?:party|for|size)\s*(\d{1,2})/i) || text.match(/\b(\d{1,2})\s*(people|persons|guests)\b/i);
  if (party) out.partySize = Number(party[1]);

  return out;
}

async function runRecall(callId: string, patch: { date?: string; timePreferred?: string; partySize?: number }, notes?: string) {
  const call = getCall(callId);
  if (!call) return { error: "Call not found" as const };

  updateReservation(callId, {
    ...(patch.date ? { date: patch.date } : {}),
    ...(patch.timePreferred ? { timePreferred: patch.timePreferred } : {}),
    ...(typeof patch.partySize === "number" ? { partySize: patch.partySize } : {}),
  });

  addTranscript(callId, "system", `Recall requested with updates: ${JSON.stringify({ ...patch, notes })}`);
  updateStatus(callId, "DIALING");

  if (!hasTwilioConfig()) return { simulated: true, call: getCall(callId) };

  const updated = getCall(callId);
  if (!updated) return { error: "Call not found after update" as const };

  try {
    const outbound = await createOutboundCall({ to: updated.reservation.businessPhone, callId });
    attachTwilioSid(callId, outbound.sid);
    addTranscript(callId, "system", `Twilio recall created: ${outbound.sid}`);
    return { simulated: false, call: getCall(callId), twilioCallSid: outbound.sid };
  } catch (error) {
    updateStatus(callId, "FAILED");
    addTranscript(callId, "system", `Twilio recall error: ${error instanceof Error ? error.message : "unknown"}`);
    return { error: "Failed to create recall" as const };
  }
}

function verifyTwilioRequest(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!hasTwilioConfig()) return next();

  const signature = req.header("x-twilio-signature") || "";
  const url = `${env.appBaseUrl}${req.originalUrl}`;
  const params = req.body as Record<string, string>;

  const ok = twilio.validateRequest(env.twilioAuthToken, signature, url, params);
  if (!ok) return res.status(403).json({ error: "Invalid Twilio signature" });
  return next();
}

router.get("/health", (_req, res) => {
  res.json({ ok: true, twilioConfigured: hasTwilioConfig() });
});

router.get("/api/calls", (_req, res) => {
  res.json({ calls: listCalls() });
});

router.post("/api/calls/start", async (req, res) => {
  const parsed = reservationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const call = createCall(parsed.data);
  updateStatus(call.id, "DIALING");
  addTranscript(call.id, "assistant", buildAssistantIntro(call.reservation));

  if (!hasTwilioConfig()) {
    attachTwilioSid(call.id, `SIM-${call.id.slice(0, 8)}`);
    return res.status(202).json({ message: "Call queued (simulation mode)", callId: call.id, simulated: true });
  }

  try {
    const outbound = await createOutboundCall({ to: call.reservation.businessPhone, callId: call.id });
    attachTwilioSid(call.id, outbound.sid);
    addTranscript(call.id, "system", `Twilio call created: ${outbound.sid}`);
    return res.status(202).json({ message: "Twilio call queued", callId: call.id, twilioCallSid: outbound.sid, simulated: false });
  } catch (error) {
    updateStatus(call.id, "FAILED");
    addTranscript(call.id, "system", `Twilio error: ${error instanceof Error ? error.message : "unknown"}`);
    return res.status(502).json({ error: "Failed to create Twilio call" });
  }
});

router.post("/api/twilio/status", verifyTwilioRequest, (req, res) => {
  const callId = String(req.query.callId || req.body?.callId || "");
  const status = String(req.body?.CallStatus || req.body?.status || "");
  if (!callId || !status) return res.status(400).json({ error: "callId and status required" });

  const mapped =
    status === "ringing" || status === "initiated"
      ? "DIALING"
      : status === "answered"
        ? "CONNECTED"
        : status === "completed"
          ? "ENDED"
          : "NEGOTIATION";

  updateStatus(callId, mapped);
  addTranscript(callId, "system", `Twilio status: ${status}`);
  return res.json({ ok: true });
});

router.post("/api/openclaw/callback", (req, res) => {
  const event = String(req.body?.event || "");
  const callId = String(req.body?.callId || "");
  if (!event) return res.status(400).json({ error: "event required" });

  if (event === "approval_required") {
    const call = getCall(callId);
    if (!call) return res.status(404).json({ error: "Call not found" });

    return res.json({
      ok: true,
      message: `Approval needed: ${call.reservation.businessName} for ${call.reservation.partySize} on ${call.reservation.date} ${call.reservation.timePreferred}.`,
      actions: [
        { label: "Approve", method: "POST", path: "/api/openclaw/decision", body: { callId, decision: "approve" } },
        { label: "Revise", method: "POST", path: "/api/openclaw/decision", body: { callId, decision: "revise" } },
        { label: "Cancel", method: "POST", path: "/api/openclaw/decision", body: { callId, decision: "cancel" } },
      ],
    });
  }

  return res.json({ ok: true, event, callId });
});

router.post("/api/openclaw/decision", (req, res) => {
  const callId = String(req.body?.callId || "");
  const decision = String(req.body?.decision || "") as "approve" | "revise" | "cancel";
  const notes = typeof req.body?.notes === "string" ? req.body.notes : undefined;

  if (!callId || !decision) return res.status(400).json({ error: "callId and decision required" });
  if (!["approve", "revise", "cancel"].includes(decision)) return res.status(400).json({ error: "Invalid decision" });

  const result = applyDecision(callId, decision, notes);
  if ("error" in result) return res.status(404).json({ error: result.error });

  return res.json({ ok: true, call: result.call });
});

router.post("/api/telegram/webhook", async (req, res) => {
  if (env.telegramWebhookSecret) {
    const got = req.header("x-telegram-bot-api-secret-token") || "";
    if (got !== env.telegramWebhookSecret) return res.status(403).json({ error: "Invalid Telegram secret" });
  }

  const msg = req.body?.message;
  if (msg?.chat?.id && typeof msg?.text === "string") {
    const chatId = String(msg.chat.id);
    const pendingCallId = getPendingRevision(chatId);
    if (pendingCallId) {
      const patch = parseRevisionText(msg.text);
      if (!patch.date && !patch.timePreferred && typeof patch.partySize !== "number") {
        await sendMessage(chatId, "I couldn’t parse changes. Try: 2026-02-22 20:00 for 2");
        return res.json({ ok: true, message: "No revision fields parsed" });
      }

      const result = await runRecall(pendingCallId, patch, msg.text);
      clearPendingRevision(chatId);

      if ("error" in result) {
        await sendMessage(chatId, `❌ Revision failed for ${pendingCallId}: ${result.error}`);
        return res.json({ ok: true, message: `Revision failed: ${result.error}` });
      }

      const when = [patch.date, patch.timePreferred].filter(Boolean).join(" ") || "(unchanged)";
      const party = typeof patch.partySize === "number" ? String(patch.partySize) : "(unchanged)";
      await sendMessage(
        chatId,
        `🔁 Recall queued for ${pendingCallId}\nWhen: ${when}\nParty size: ${party}${result.simulated ? "\nMode: simulation" : ""}`,
      );

      return res.json({ ok: true, message: "Revision accepted and recall queued", callId: pendingCallId, ...result });
    }
  }

  const cb = req.body?.callback_query;
  if (!cb) return res.json({ ok: true });

  const data = String(cb.data || "");
  const parts = data.split("|");
  if (parts.length !== 3 || parts[0] !== "rc") {
    await answerCallbackQuery(String(cb.id), "Unknown action");
    return res.json({ ok: true });
  }

  const decision = parts[1] as "approve" | "revise" | "cancel";
  const callId = parts[2];

  if (decision === "revise") {
    const chatId = String(cb.message?.chat?.id || "");
    if (chatId) setPendingRevision(chatId, callId);
    await answerCallbackQuery(String(cb.id), "Send new time/date, e.g. '2026-02-22 20:00 for 2'");
    const messageId = cb.message?.message_id;
    if (chatId && messageId) {
      await editMessage(chatId, messageId, `✏️ Send revised details now (example: 2026-02-22 20:00 for 2). Call ${callId}`);
    }
    return res.json({ ok: true, action: "revise_requested", callId });
  }

  const result = applyDecision(callId, decision, undefined);
  if ("error" in result) {
    await answerCallbackQuery(String(cb.id), "Call not found");
    return res.json({ ok: true });
  }

  await answerCallbackQuery(String(cb.id), `Decision saved: ${decision}`);
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  if (chatId && messageId) {
    await editMessage(chatId, messageId, `✅ Decision recorded: ${decision} (call ${callId})`);
  }

  return res.json({ ok: true, call: result.call });
});

router.post("/api/twilio/voice", verifyTwilioRequest, (req, res) => {
  const callId = String(req.query.callId || "");
  const call = getCall(callId);
  if (!call) return res.status(404).send("Unknown call");

  updateStatus(callId, "DISCOVERY");

  const vr = new twilio.twiml.VoiceResponse();
  vr.say({ voice: "alice" }, buildAssistantIntro(call.reservation));
  vr.say({ voice: "alice" }, "Could you confirm availability and any important conditions like deposit or cancellation policy?");

  const gather = vr.gather({
    input: ["speech"],
    speechTimeout: "auto",
    action: `/api/twilio/gather?callId=${encodeURIComponent(callId)}`,
    method: "POST",
  });
  gather.say({ voice: "alice" }, "I am listening.");

  vr.say({ voice: "alice" }, "Sorry, I did not catch that.");
  vr.redirect({ method: "POST" }, `/api/twilio/voice?callId=${encodeURIComponent(callId)}`);

  res.type("text/xml").send(vr.toString());
});

router.post("/api/twilio/gather", verifyTwilioRequest, (req, res) => {
  const callId = String(req.query.callId || "");
  const speech = String(req.body?.SpeechResult || "").trim();
  const call = getCall(callId);
  if (!call) return res.status(404).send("Unknown call");

  addTranscript(callId, "business", speech || "(no speech captured)");

  const vr = new twilio.twiml.VoiceResponse();

  if (!speech) {
    vr.say({ voice: "alice" }, "I did not hear a response. I will follow up later. Thank you.");
    updateStatus(callId, "FAILED");
    setOutcome(callId, { status: "failed", needsUserApproval: false, confidence: 0.4, reason: "No speech captured" });
    vr.hangup();
    return res.type("text/xml").send(vr.toString());
  }

  const parsed = parseBusinessReply(speech);
  const decision = decideFromReply(parsed, call.reservation);

  if (decision.status === "reject") {
    updateStatus(callId, "FAILED");
    setOutcome(callId, {
      status: "failed",
      needsUserApproval: false,
      confidence: parsed.confidence,
      reason: decision.reason,
    });
    void notifyOpenClaw("call_failed", { callId, businessName: call.reservation.businessName, reason: decision.reason });
    vr.say({ voice: "alice" }, "Understood, thank you for checking. Have a great day.");
    vr.hangup();
    return res.type("text/xml").send(vr.toString());
  }

  if (decision.status === "confirm") {
    const confirmedTime = decision.proposedTime || call.reservation.timePreferred;
    setOutcome(callId, {
      status: "confirmed",
      needsUserApproval: false,
      confidence: parsed.confidence,
      reason: decision.reason,
      confirmedDetails: {
        date: call.reservation.date,
        time: confirmedTime,
        partySize: call.reservation.partySize,
        name: call.reservation.nameForBooking,
        notes: decision.notes,
      },
    });

    updateStatus(callId, "CONFIRMED");
    void notifyOpenClaw("call_confirmed", { callId, businessName: call.reservation.businessName });

    vr.say({ voice: "alice" }, `Perfect. Please confirm the reservation under ${call.reservation.nameForBooking}. Thank you.`);
    vr.hangup();
    return res.type("text/xml").send(vr.toString());
  }

  if (decision.status === "needs_approval") {
    setOutcome(callId, {
      status: "pending",
      needsUserApproval: true,
      confidence: parsed.confidence,
      reason: decision.reason,
      confirmedDetails: {
        date: call.reservation.date,
        time: decision.proposedTime || call.reservation.timePreferred,
        partySize: call.reservation.partySize,
        name: call.reservation.nameForBooking,
        notes: decision.notes,
      },
    });

    updateStatus(callId, "WAITING_USER_APPROVAL");
    void notifyOpenClaw("approval_required", {
      callId,
      businessName: call.reservation.businessName,
      phone: call.reservation.businessPhone,
      date: call.reservation.date,
      time: decision.proposedTime || call.reservation.timePreferred,
      partySize: call.reservation.partySize,
      notes: decision.notes,
    });
    void sendApprovalPrompt({
      callId,
      businessName: call.reservation.businessName,
      date: call.reservation.date,
      time: decision.proposedTime || call.reservation.timePreferred,
      partySize: call.reservation.partySize,
      notes: decision.notes,
    });

    vr.say({ voice: "alice" }, "Thank you. I need to confirm final details with Felix and will call back if needed.");
    vr.hangup();
    return res.type("text/xml").send(vr.toString());
  }

  const clarificationAttempts = call.transcript.filter((t) => t.speaker === "business").length;
  if (clarificationAttempts >= 3) {
    updateStatus(callId, "WAITING_USER_APPROVAL");
    setOutcome(callId, {
      status: "pending",
      needsUserApproval: true,
      confidence: parsed.confidence,
      reason: "Ambiguous after multiple clarification attempts",
      confirmedDetails: {
        date: call.reservation.date,
        time: call.reservation.timePreferred,
        partySize: call.reservation.partySize,
        name: call.reservation.nameForBooking,
        notes: speech,
      },
    });
    void sendApprovalPrompt({
      callId,
      businessName: call.reservation.businessName,
      date: call.reservation.date,
      time: call.reservation.timePreferred,
      partySize: call.reservation.partySize,
      notes: "Ambiguous response after multiple attempts",
    });
    vr.say({ voice: "alice" }, "Thank you. I will confirm details with Felix and follow up if needed.");
    vr.hangup();
    return res.type("text/xml").send(vr.toString());
  }

  updateStatus(callId, "NEGOTIATION");
  vr.say({ voice: "alice" }, "Thanks. Could you repeat the available time and any reservation conditions?");
  const gather = vr.gather({
    input: ["speech"],
    speechTimeout: "auto",
    action: `/api/twilio/gather?callId=${encodeURIComponent(callId)}`,
    method: "POST",
  });
  gather.say({ voice: "alice" }, "I am listening.");

  return res.type("text/xml").send(vr.toString());
});

router.post("/api/calls/:id/approve", (req, res) => {
  const id = req.params.id;
  const { decision, notes } = req.body as { decision?: "approve" | "revise" | "cancel"; notes?: string };
  if (!decision) return res.status(400).json({ error: "decision required" });

  const result = applyDecision(id, decision, notes);
  if ("error" in result) return res.status(404).json({ error: result.error });

  return res.json({ ok: true, call: result.call });
});

router.post("/api/calls/:id/recall", async (req, res) => {
  const id = req.params.id;
  const { date, timePreferred, partySize, notes } = req.body as {
    date?: string;
    timePreferred?: string;
    partySize?: number;
    notes?: string;
  };

  const result = await runRecall(id, { date, timePreferred, partySize }, notes);
  if ("error" in result) {
    const code = result.error === "Call not found" ? 404 : 502;
    return res.status(code).json({ error: result.error });
  }

  return res.json({ ok: true, ...result });
});

router.get("/api/calls/:id", (req, res) => {
  const call = getCall(req.params.id);
  if (!call) return res.status(404).json({ error: "Call not found" });
  return res.json({ call });
});

router.post("/api/mock/proposed-outcome/:id", (req, res) => {
  const id = req.params.id;
  const call = getCall(id);
  if (!call) return res.status(404).json({ error: "Call not found" });

  const note = String(req.body?.note || "No risk noted");
  const requireApproval = needsHumanConfirmation(note, call.reservation.policy?.allowAutoConfirm ?? false);
  setOutcome(id, {
    status: "pending",
    needsUserApproval: requireApproval,
    confidence: 0.78,
    reason: note,
    confirmedDetails: {
      date: call.reservation.date,
      time: call.reservation.timePreferred,
      partySize: call.reservation.partySize,
      name: call.reservation.nameForBooking,
      notes: note,
    },
  });
  updateStatus(id, requireApproval ? "WAITING_USER_APPROVAL" : "PROPOSED_OUTCOME");

  return res.json({ ok: true, call: getCall(id) });
});
