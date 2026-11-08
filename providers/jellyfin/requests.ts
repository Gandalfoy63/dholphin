// Docs: docs/06 - API/Jellyfin and Seerr Provider.md
// Purpose: Seerr's requests as one clear state each, with the download's progress and its time left.
import type { RequestEntry, RequestStage } from '@/sdk/types';

/** A request as Seerr gives it (GET /request): the fields read here. Docs: Seerr API/Request, Seerr API/Schemas. */
export interface SeerrRequest {
  id: number;
  type?: 'movie' | 'tv';
  /** 1 pending approval, 2 approved, 3 declined, 4 failed, 5 completed. */
  status: number;
  createdAt?: string;
  updatedAt?: string;
  seasons?: { seasonNumber: number; status?: number }[];
  requestedBy?: { id?: number; displayName?: string; jellyfinUsername?: string; username?: string };
  media?: {
    tmdbId?: number;
    mediaType?: 'movie' | 'tv';
    /** 1 unknown, 2 pending, 3 processing, 4 partly available, 5 available, 6 deleted. */
    status?: number;
    downloadStatus?: { size?: number; sizeLeft?: number; timeLeft?: string; estimatedCompletionTime?: string; status?: string; title?: string }[];
  };
}

/**
 * One state per request, as a person would say it. A download in progress wins over everything but a decline:
 * Seerr keeps a request "approved" and its film "processing" from the search until the file is in the library.
 */
export function stageOf(q: SeerrRequest): RequestStage {
  const m = q.media ?? {};
  if (q.status === 3) return 'declined';
  if (q.status === 4) return 'failed';
  if (m.status === 6) return 'deleted';
  if (m.downloadStatus?.length) return 'downloading';
  if (m.status === 5) return 'available';
  if (m.status === 4) return 'partly';
  if (q.status === 1) return 'pending';
  if (m.status === 3) return 'searching';
  return 'approved';
}

export function toEntry(q: SeerrRequest, me: number | null): RequestEntry | null {
  const m = q.media ?? {}, kind = (q.type ?? m.mediaType) === 'tv' ? 'tv' : 'movie';
  if (!m.tmdbId) return null;
  const dl = m.downloadStatus ?? [];
  const size = dl.reduce((a, d) => a + (d.size ?? 0), 0), left = dl.reduce((a, d) => a + (d.sizeLeft ?? 0), 0);
  // The last file to finish says when the whole request is done.
  const eta = dl.map((d) => d.estimatedCompletionTime).filter((x): x is string => !!x).sort().at(-1);
  const by = q.requestedBy;
  return {
    id: String(q.id),
    tmdbId: m.tmdbId,
    kind,
    stage: stageOf(q),
    requestedBy: by?.displayName || by?.jellyfinUsername || by?.username || undefined,
    mine: me != null && by?.id === me,
    requestedAt: q.createdAt ?? null,
    changedAt: q.updatedAt ?? null,
    seasons: kind === 'tv' ? (q.seasons ?? []).map((s) => s.seasonNumber).sort((a, b) => a - b) : undefined,
    download: dl.length ? { progress: size > 0 ? Math.min(1, Math.max(0, 1 - left / size)) : 0, eta: eta ?? null, files: dl.length, state: dl[0]?.status ?? null } : undefined,
  };
}
