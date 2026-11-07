// Docs: docs/03 - Features/Playback.md
// Purpose: remembers where the person was before leaving for a service's own pages.
import type { Title } from '@/sdk/types';

export interface ReturnState { route?: string; onboardingStep?: number; titleKey?: string; title?: Title; ob?: unknown; profileId?: string }
const KEY = 'dholphin-return';
let current: () => Partial<ReturnState> = () => ({});

export const setReturnContext = (fn: () => Partial<ReturnState>) => (current = fn);
export function saveReturn(extra: Partial<ReturnState> = {}) {
  sessionStorage.setItem(KEY, JSON.stringify({ ...current(), ...extra }));
}
export function takeReturn(): ReturnState | null {
  const raw = sessionStorage.getItem(KEY);
  sessionStorage.removeItem(KEY);
  return raw ? (JSON.parse(raw) as ReturnState) : null;
}
