// Docs: docs/03 - Features/Playback.md
// Purpose: the player's rules without the screen: subtitle files, what to offer to skip, how far a held key seeks.
import type { Segment, Trickplay } from '@/sdk/types';

export interface Cue { start: number; end: number; html: string }

/** "01:02:03.450", "02:03,450" (SubRip), "2:03.4" → seconds. */
function seconds(s: string): number | null {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number((m[4] ?? '0').padEnd(3, '0')) / 1000;
}

/** Keeps italic, bold and underline; everything else is text. */
function cueHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped
    .replace(/&lt;(\/?)([ibu])(?:\.[^&]*)?&gt;/g, '<$1$2>')
    .replace(/&lt;\/?[^&]*&gt;/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .split('\n').join('<br>');
}

/** WebVTT or SubRip text → cues in time order. Styles, regions and notes are skipped. */
export function parseCues(text: string): Cue[] {
  const out: Cue[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [a, b] = lines[at]!.split('-->');
    const start = seconds(a ?? ''), end = seconds((b ?? '').trim().split(/\s+/)[0] ?? '');
    const body = lines.slice(at + 1).join('\n').trim();
    if (start === null || end === null || !body || end <= start) continue;
    out.push({ start, end, html: cueHtml(body) });
  }
  return out.sort((x, y) => x.start - y.start);
}

/** The cues showing at `t`. */
export const cuesAt = (cues: Cue[], t: number) => cues.filter((c) => c.start <= t && t < c.end);

/** The segment playing at `t`, ending a second early so its button never flashes at the very end. */
export const segmentAt = (segments: Segment[], t: number) => segments.find((s) => t >= s.startSec && t < s.endSec - 1);

/**
 * When to offer the next episode: at the credits, or without them, 30 seconds before the end of anything longer
 * than ten minutes. Null when there is nothing after.
 */
export function nextAt(segments: Segment[], durationSec: number, hasNext: boolean): number | null {
  if (!hasNext || !durationSec) return null;
  const credits = segments.find((s) => s.kind === 'credits' && s.endSec >= durationSec - 5);
  if (credits) return credits.startSec;
  return durationSec > 600 ? durationSec - 30 : null;
}

/** Seconds per press while a key is held: the longer it is held, the further each press goes. */
export const SEEK_STEPS = [10, 10, 10, 20, 30, 30, 60, 60, 120, 300];
export function seekStep(presses: number, least = 10): number {
  return Math.max(least, SEEK_STEPS[Math.min(presses, SEEK_STEPS.length - 1)]!);
}

/** Where the preview picture for `sec` is: which tile, and its offset in it. */
export function trickplaySpot(tp: Pick<Trickplay, 'width' | 'height' | 'cols' | 'rows' | 'intervalMs' | 'count'>, sec: number) {
  const n = Math.max(0, Math.min(tp.count - 1, Math.floor((sec * 1000) / tp.intervalMs)));
  const per = tp.cols * tp.rows;
  const inTile = n % per;
  return { tile: Math.floor(n / per), x: (inTile % tp.cols) * tp.width, y: Math.floor(inTile / tp.cols) * tp.height };
}

/** "1:02:03", "2:03". */
export function clock(s: number): string {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(x).padStart(2, '0')}`;
}
