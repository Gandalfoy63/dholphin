// Docs: docs/03 - Features/Playback.md
// Purpose: tests for the player's rules: subtitle files, skip and next-episode timing, held-key seeking, previews.
import { describe, expect, it } from 'vitest';
import { clock, cuesAt, nextAt, parseCues, seekStep, segmentAt, trickplaySpot } from './playback';
import { pickTracks } from '../../providers/jellyfin';

describe('subtitles', () => {
  it('reads WebVTT with settings, notes and tags', () => {
    const cues = parseCues('WEBVTT\n\nNOTE a note\n\n1\n00:00:01.000 --> 00:00:03.500 line:90%\n<i>Hello</i> <c.yellow>there</c>\nsecond line\n\n00:01:00.000 --> 00:01:02.000\nA & B');
    expect(cues).toEqual([
      { start: 1, end: 3.5, html: '<i>Hello</i> there<br>second line' },
      { start: 60, end: 62, html: 'A &amp; B' },
    ]);
  });
  it('reads SubRip, and never lets markup through', () => {
    const cues = parseCues('1\r\n00:00:02,5 --> 00:00:04,000\r\n<script>x</script>{\\an8}Hi\r\n');
    expect(cues[0]).toEqual({ start: 2.5, end: 4, html: 'xHi' });
  });
  it('shows the cues of the moment', () => {
    const cues = parseCues('WEBVTT\n\n00:01.000 --> 00:03.000\na\n\n00:02.000 --> 00:04.000\nb');
    expect(cuesAt(cues, 2.5).map((c) => c.html)).toEqual(['a', 'b']);
    expect(cuesAt(cues, 3)).toHaveLength(1);
    expect(cuesAt(cues, 5)).toHaveLength(0);
  });
});

describe('skipping', () => {
  const segs = [{ kind: 'intro' as const, startSec: 5, endSec: 60 }, { kind: 'credits' as const, startSec: 2500, endSec: 2600 }];
  it('offers a skip while the segment plays, not in its last second', () => {
    expect(segmentAt(segs, 30)?.kind).toBe('intro');
    expect(segmentAt(segs, 59.5)).toBeUndefined();
    expect(segmentAt(segs, 4)).toBeUndefined();
  });
  it('offers the next episode at the credits, or 30 s before the end', () => {
    expect(nextAt(segs, 2600, true)).toBe(2500);
    expect(nextAt(segs, 2600, false)).toBeNull();
    expect(nextAt([], 2600, true)).toBe(2570);
    expect(nextAt([], 300, true)).toBeNull();
    // Credits in the middle (a film within the episode) are not the end.
    expect(nextAt([{ kind: 'credits', startSec: 100, endSec: 200 }], 2600, true)).toBe(2570);
  });
});

describe('seeking', () => {
  it('goes further the longer a key is held', () => {
    expect([0, 1, 2, 3, 4, 6, 8, 9, 20].map((n) => seekStep(n))).toEqual([10, 10, 10, 20, 30, 60, 120, 300, 300]);
    expect(seekStep(0, 30)).toBe(30);
  });
  it('finds the preview picture in its tile', () => {
    const tp = { width: 320, height: 180, cols: 10, rows: 10, intervalMs: 10_000, count: 250 };
    expect(trickplaySpot(tp, 0)).toEqual({ tile: 0, x: 0, y: 0 });
    expect(trickplaySpot(tp, 125)).toEqual({ tile: 0, x: 640, y: 180 });
    expect(trickplaySpot(tp, 1010)).toEqual({ tile: 1, x: 320, y: 0 });
    expect(trickplaySpot(tp, 99999)).toEqual({ tile: 2, x: 2880, y: 720 });
  });
  it('writes times', () => {
    expect([0, 65, 3723].map(clock)).toEqual(['0:00', '1:05', '1:02:03']);
  });
});

describe('tracks to start with', () => {
  const media = {
    Id: 'm', DefaultAudioStreamIndex: 1, DefaultSubtitleStreamIndex: 5,
    MediaStreams: [
      { Index: 1, Type: 'Audio', Language: 'eng' }, { Index: 2, Type: 'Audio', Language: 'fre' },
      { Index: 3, Type: 'Subtitle', Language: 'fre', IsForced: true, DeliveryMethod: 'External', DeliveryUrl: '/a' },
      { Index: 4, Type: 'Subtitle', Language: 'fre', DeliveryMethod: 'External', DeliveryUrl: '/b' },
      { Index: 5, Type: 'Subtitle', Language: 'eng', DeliveryMethod: 'Encode' },
      { Index: 6, Type: 'Subtitle', Language: 'ger', DeliveryMethod: 'Encode' },
    ],
  };
  it('keeps the server default without a preference', () => expect(pickTracks(media)).toEqual({ audioId: 1, subtitleId: 5 }));
  it('follows the languages chosen before, full subtitles over forced ones', () => expect(pickTracks(media, { audioLang: 'fre', subtitleLang: 'fre' })).toEqual({ audioId: 2, subtitleId: 4 }));
  it('turns subtitles off when they were off', () => expect(pickTracks(media, { subtitleLang: null }).subtitleId).toBe(-1));
  it('never picks drawn-in subtitles by language alone', () => expect(pickTracks(media, { subtitleLang: 'ger' }).subtitleId).toBe(5));
  it('takes a chosen track as it is', () => expect(pickTracks(media, { audioId: 2, subtitleId: 6 })).toEqual({ audioId: 2, subtitleId: 6 }));
});
