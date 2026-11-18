// Docs: docs/04 - Architecture/Server.md
// Purpose: tests the addresses tried for a server as typed: a domain over https first, the home network over http first.
import { describe, expect, it } from 'vitest';
import { candidateOrigins, normalizeOrigin } from './origin';

describe('a server address as typed', () => {
  it('tries a domain over https first: a server behind a reverse proxy', () => {
    expect(candidateOrigins('tv.example.com')).toEqual(['https://tv.example.com', 'http://tv.example.com']);
    expect(candidateOrigins('example.com/dholphin/')).toEqual(['https://example.com/dholphin', 'http://example.com/dholphin']);
  });
  it('tries the home network over http first', () => {
    expect(candidateOrigins('192.168.1.20:8080')).toEqual(['http://192.168.1.20:8080', 'https://192.168.1.20:8080']);
    for (const a of ['localhost:8080', 'nas.local', 'nas', 'box.lan:8988']) expect(candidateOrigins(a)[0]).toMatch(/^http:\/\//);
  });
  it('keeps a scheme given, and only it', () => {
    expect(candidateOrigins('https://tv.example.com/')).toEqual(['https://tv.example.com']);
    expect(candidateOrigins('http://tv.example.com:8080')).toEqual(['http://tv.example.com:8080']);
    expect(normalizeOrigin('  192.168.1.20:8080/ ')).toBe('http://192.168.1.20:8080');
  });
  it('refuses nothing typed, or no address', () => {
    expect(candidateOrigins('  ')).toEqual([]);
    expect(normalizeOrigin('http://')).toBeNull();
  });
});
