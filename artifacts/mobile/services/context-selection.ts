export function updateConversationSelection(
  current: string[],
  conversationId: string,
  selected: boolean,
): string[] {
  if (selected) return current.includes(conversationId) ? current : [...current, conversationId];
  return current.filter((id) => id !== conversationId);
}