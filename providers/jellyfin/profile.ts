// Docs: docs/06 - API/Jellyfin and Seerr Provider.md
// Purpose: what this device can play, as a Jellyfin device profile. From CoolDash's Jellyfin app.
// Codec strings: docs/other-downloaded-docs/jellyfin/guides/04-codec-support.md

export type CanPlay = (mime: string) => boolean;

/** Probes the page's <video>: "probably"/"maybe" both count (Chromium says "probably" for what it decodes). */
export function videoProbe(): CanPlay {
  const v = document.createElement('video');
  return (mime) => {
    try {
      return v.canPlayType(mime) !== '' || (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mime));
    } catch {
      return false;
    }
  };
}

export interface Codecs { video: string[]; audio: string[]; hevc: boolean; av1: boolean; vp9: boolean }

export function codecs(can: CanPlay): Codecs {
  const hevc = can('video/mp4; codecs="hvc1.1.6.L120.90"') || can('video/mp4; codecs="hev1.1.6.L120.90"');
  const av1 = can('video/mp4; codecs="av01.0.08M.08"');
  const vp9 = can('video/webm; codecs="vp9"');
  const video = ['h264', ...(hevc ? ['hevc'] : []), ...(av1 ? ['av1'] : []), ...(vp9 ? ['vp9'] : [])];
  const audio = ['aac', 'mp3', ...(can('audio/mp4; codecs="opus"') || can('audio/webm; codecs="opus"') ? ['opus'] : []), ...(can('audio/mp4; codecs="flac"') || can('audio/flac') ? ['flac'] : []), ...(can('audio/mp4; codecs="ac-3"') ? ['ac3'] : []), ...(can('audio/mp4; codecs="ec-3"') ? ['eac3'] : [])];
  return { video, audio, hevc, av1, vp9 };
}

/** The DeviceProfile sent with PlaybackInfo. `maxBitrate` in bits per second (the settings' quality). */
export function deviceProfile(c: Codecs, maxBitrate: number) {
  const webmVideo = ['vp8', ...(c.vp9 ? ['vp9'] : []), ...(c.av1 ? ['av1'] : [])].join(',');
  return {
    Name: 'CoolDash TV',
    MaxStreamingBitrate: maxBitrate,
    MaxStaticBitrate: maxBitrate,
    DirectPlayProfiles: [
      { Container: 'mp4,m4v', Type: 'Video', VideoCodec: c.video.join(','), AudioCodec: c.audio.join(',') },
      { Container: 'webm', Type: 'Video', VideoCodec: webmVideo, AudioCodec: 'vorbis,opus' },
      // Chromium opens Matroska with these codecs (most home libraries are MKV)
      { Container: 'mkv', Type: 'Video', VideoCodec: c.video.join(','), AudioCodec: c.audio.join(',') },
    ],
    TranscodingProfiles: [
      { Container: 'ts', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac', Protocol: 'hls', Context: 'Streaming', MaxAudioChannels: '2', MinSegments: 1 },
    ],
    ContainerProfiles: [],
    CodecProfiles: [
      // A browser plays only a file's first audio track: choosing another makes the server convert, with that one.
      // `IsSecondaryAudio`: Docs: Jellyfin/api/schemas (ProfileConditionValue). Checked against a real server.
      { Type: 'VideoAudio', Conditions: [{ Condition: 'Equals', Property: 'IsSecondaryAudio', Value: 'false', IsRequired: false }] },
      // the Pi's decoder: 8-bit H.264 up to 1080p (higher is converted by the server)
      { Type: 'Video', Codec: 'h264', Conditions: [
        { Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '8', IsRequired: false },
        { Condition: 'LessThanEqual', Property: 'Width', Value: '1920', IsRequired: false },
      ] },
    ],
    // text subtitles as WebVTT files next to the video; pictures (PGS, VobSub) and styled ASS are drawn into it
    SubtitleProfiles: [
      { Format: 'vtt', Method: 'External' },
      { Format: 'srt', Method: 'External' },
      { Format: 'subrip', Method: 'External' },
      { Format: 'ass', Method: 'Encode' },
      { Format: 'ssa', Method: 'Encode' },
      { Format: 'pgssub', Method: 'Encode' },
      { Format: 'dvdsub', Method: 'Encode' },
    ],
  };
}

/** Quality choices in Settings (bits per second). */
export const QUALITIES = [
  { label: 'Best', bps: 120_000_000 },
  { label: '1080p · 20 Mbps', bps: 20_000_000 },
  { label: '720p · 8 Mbps', bps: 8_000_000 },
  { label: '480p · 3 Mbps', bps: 3_000_000 },
] as const;
