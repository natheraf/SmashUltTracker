import { describe, expect, it } from 'vitest';
import { characters, gridRows, imageFileOverrides } from '../seed/characters.js';
import { ALL_PERMISSIONS } from '../server/seedData.js';

describe('character seed', () => {
  it('has one entry per grid box', () => {
    const total = gridRows.reduce((a, b) => a + b, 0);
    expect(total).toBe(characters.length);
  });

  it('has 86 entries (the full Ultimate roster per the app rules)', () => {
    expect(characters.length).toBe(86);
  });

  it('has unique slugs and names', () => {
    const slugs = new Set(characters.map((c) => c.slug));
    const names = new Set(characters.map((c) => c.name));
    expect(slugs.size).toBe(characters.length);
    expect(names.size).toBe(characters.length);
  });

  it('keeps special combined slots as single entries', () => {
    const bySlug = new Map(characters.map((c) => [c.slug, c]));
    expect(bySlug.has('pokemon-trainer')).toBe(true);
    expect(bySlug.has('pyra-and-mythra')).toBe(true);
    expect(bySlug.has('rosalina-and-luma')).toBe(true);
    expect(bySlug.has('ice-climbers')).toBe(true);
    expect(bySlug.has('duck-hunt')).toBe(true);
    expect(bySlug.has('banjo-and-kazooie')).toBe(true);
    // Three separate Mii Fighters.
    expect(bySlug.has('mii-brawler')).toBe(true);
    expect(bySlug.has('mii-swordfighter')).toBe(true);
    expect(bySlug.has('mii-gunner')).toBe(true);
    // No individual Pokemon entries.
    expect(bySlug.has('squirtle')).toBe(false);
  });

  it('marks the seven echo fighters', () => {
    const echoes = characters.filter((c) => c.is_echo).map((c) => c.slug);
    expect(echoes).toEqual([
      'dark-samus',
      'daisy',
      'lucina',
      'chrom',
      'dark-pit',
      'ken',
      'richter',
    ]);
  });

  it('places the Mii Fighters last, as in the game', () => {
    const last3 = characters.slice(-3).map((c) => c.slug);
    expect(last3).toEqual(['mii-brawler', 'mii-swordfighter', 'mii-gunner']);
  });

  it('only references image overrides for existing slugs', () => {
    const slugs = new Set(characters.map((c) => c.slug));
    for (const slug of Object.keys(imageFileOverrides)) {
      expect(slugs.has(slug)).toBe(true);
    }
  });
});

describe('role permissions', () => {
  it('admin holds every permission', () => {
    expect(ALL_PERMISSIONS).toContain('use_tracker');
    expect(ALL_PERMISSIONS).toContain('review_submissions');
    expect(ALL_PERMISSIONS.length).toBe(6);
  });
});
