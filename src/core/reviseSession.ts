const pendingByChat = new Map<string, string>();

export function setPendingRevision(chatId: string, callId: string) {
  pendingByChat.set(chatId, callId);
}

export function getPendingRevision(chatId: string) {
  return pendingByChat.get(chatId);
}

export function clearPendingRevision(chatId: string) {
  pendingByChat.delete(chatId);
}
