import { describe, expect, it, vi } from 'vitest';
import { getIntroLayoutIssues } from './intro-layout';

function makeIntroElements(rectangles: Record<string, DOMRect>) {
  const root = document.createElement('div');
  for (const [name, rect] of Object.entries(rectangles)) {
    const element = document.createElement('div');
    element.dataset.testid = `intro-${name}`;
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect);
    root.append(element);
  }
  return root;
}

describe('getIntroLayoutIssues', () => {
  it('requires the headline elements that must be checked', () => {
    expect(getIntroLayoutIssues(document.createElement('div'), 360, 640)).toEqual([
      'logo is missing',
      'headline is missing',
      'tagline is missing',
      'dots is missing',
    ]);
  });

  it('measures intro element bounds and accepts a non-overlapping layout inside the viewport', () => {
    const root = makeIntroElements({
      logo: new DOMRect(62, 250, 236, 51),
      headline: new DOMRect(62, 310, 236, 54),
      tagline: new DOMRect(122, 373, 115, 17),
      dots: new DOMRect(45, 294, 5, 43),
    });

    expect(getIntroLayoutIssues(root, 360, 640)).toEqual([]);
  });

  it('reports overlaps and elements outside the viewport', () => {
    const root = makeIntroElements({
      logo: new DOMRect(62, 250, 236, 51),
      headline: new DOMRect(62, 290, 236, 54),
      tagline: new DOMRect(122, 373, 115, 17),
      dots: new DOMRect(-2, 294, 5, 43),
    });

    expect(getIntroLayoutIssues(root, 360, 640)).toEqual([
      'dots leaves the viewport',
      'logo overlaps headline',
    ]);
  });
});
