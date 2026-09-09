import { HandoffSummary } from '@/services/lnkz-api';

export type HandoffState = 'active' | 'revoked' | 'exhausted' | 'expired';

export function getHandoffState(handoff: HandoffSummary, now = Date.now()): HandoffState {
  if (handoff.revokedAt) return 'revoked';
  if (handoff.uses >= handoff.maxUses) return 'exhausted';
  if (new Date(handoff.expiresAt).getTime() <= now) return 'expired';
  return handoff.active ? 'active' : 'expired';
}