// Docs: docs/02 - Tech/Android App.md
// Purpose: tests how an http picture's address goes through the Android app.
import { describe, expect, it } from 'vitest';
import { throughApp } from './dom';

const APP = 'https://appassets.androidplatform.net';
describe('throughApp', () => {
  it('sends an http server\'s pictures through the app, keeping the path to append sizes to', () => {
    const base = throughApp('http://192.168.1.101:8988/api/img', APP);
    expect(base).toBe(`${APP}/http-image/http%3A%2F%2F192.168.1.101%3A8988/api/img`);
    expect(`${base}/w300/a.jpg`).toBe(`${APP}/http-image/http%3A%2F%2F192.168.1.101%3A8988/api/img/w300/a.jpg`);
  });
  it('keeps the query of a Jellyfin picture', () => {
    expect(throughApp('http://nas:8096/Items/1/Images/Primary?tag=x&fillWidth=500', APP)).toBe(`${APP}/http-image/http%3A%2F%2Fnas%3A8096/Items/1/Images/Primary?tag=x&fillWidth=500`);
  });
  it('leaves https and other addresses alone', () => {
    for (const u of ['https://image.tmdb.org/t/p', './providers/x.svg', 'data:image/png;base64,AA']) expect(throughApp(u, APP)).toBe(u);
  });
});
