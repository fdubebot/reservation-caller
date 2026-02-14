import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CallRecord, ReservationRequest, CallStatus, CallOutcome } from "../types/reservation.js";
import { env } from "../config/env.js";

const calls = new Map<string, CallRecord>();

function persist() {
  const filePath = path.resolve(env.dataFile);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(Array.from(calls.values()), null, 2));
}

function load() {
  const filePath = path.resolve(env.dataFile);
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return;
  const parsed = JSON.parse(raw) as CallRecord[];
  for (const rec of parsed) {
    calls.set(rec.id, rec);
  }
}

load();

export function createCall(reservation: ReservationRequest): CallRecord {
  const now = new Date().toISOString();
  const id = reservation.requestId || randomUUID();
  const rec: CallRecord = {
    id,
    reservation: { ...reservation, requestId: id },
    status: "INIT",
    createdAt: now,
    updatedAt: now,
    transcript: [{ at: now, speaker: "system", text: "Call created" }],
  };
  calls.set(id, rec);
  persist();
  return rec;
}

export function getCall(id: string): CallRecord | undefined {
  return calls.get(id);
}

export function updateStatus(id: string, status: CallStatus) {
  const rec = calls.get(id);
  if (!rec) return;
  rec.status = status;
  rec.updatedAt = new Date().toISOString();
  persist();
}

export function addTranscript(id: string, speaker: "assistant" | "business" | "system", text: string) {
  const rec = calls.get(id);
  if (!rec) return;
  rec.transcript.push({ at: new Date().toISOString(), speaker, text });
  rec.updatedAt = new Date().toISOString();
  persist();
}

export function setOutcome(id: string, outcome: CallOutcome) {
  const rec = calls.get(id);
  if (!rec) return;
  rec.outcome = outcome;
  rec.updatedAt = new Date().toISOString();
  persist();
}

export function attachTwilioSid(id: string, sid: string) {
  const rec = calls.get(id);
  if (!rec) return;
  rec.twilioCallSid = sid;
  rec.updatedAt = new Date().toISOString();
  persist();
}

export function updateReservation(id: string, patch: Partial<CallRecord["reservation"]>) {
  const rec = calls.get(id);
  if (!rec) return;
  rec.reservation = { ...rec.reservation, ...patch };
  rec.updatedAt = new Date().toISOString();
  persist();
}

export function listCalls() {
  return Array.from(calls.values());
}
