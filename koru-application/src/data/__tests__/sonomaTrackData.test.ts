import { describe, it, expect } from 'vitest';
import { SONOMA_RACEWAY } from '../trackData';

/**
 * C-2: Production track data for the May 23 Sonoma field test.
 *
 * The reviewer (Apr 29 audit) called out that beginner drivers brake to
 * landmarks, not numbers — and specifically that T10's vision cue should
 * mention the bridge. These tests pin those reviewer-required corners so
 * that a future refactor cannot silently drop the field.
 */
describe('SONOMA_RACEWAY (production track data)', () => {
  const byId = new Map(SONOMA_RACEWAY.corners.map(c => [c.id, c] as const));

  it('is named Sonoma Raceway', () => {
    expect(SONOMA_RACEWAY.name).toBe('Sonoma Raceway');
  });

  it.each([1, 7, 10, 11])('Turn %i has a non-empty visualReference', (id) => {
    const corner = byId.get(id);
    expect(corner, `Turn ${id} missing from SONOMA_RACEWAY`).toBeDefined();
    expect(corner!.visualReference).toBeTruthy();
    expect(corner!.visualReference!.length).toBeGreaterThan(0);
  });

  it("T10's visualReference references the bridge (reviewer's specific call-out)", () => {
    const t10 = byId.get(10)!;
    expect(t10.visualReference!.toLowerCase()).toContain('bridge');
  });
});
