const introElements = [
  ['logo', '[data-testid="intro-logo"]', true],
  ['headline', '[data-testid="intro-headline"]', true],
  ['organization', '[data-testid="intro-organization"]', false],
  ['tagline', '[data-testid="intro-tagline"]', true],
  ['dots', '[data-testid="intro-dots"]', true],
] as const;

export function getIntroLayoutIssues(root: ParentNode, viewportWidth: number, viewportHeight: number): string[] {
  const issues: string[] = [];
  const measured = introElements.flatMap(([name, selector, required]) => {
    const element = root.querySelector<HTMLElement>(selector);
    if (!element) {
      if (required) issues.push(`${name} is missing`);
      return [];
    }
    const rect = element.getBoundingClientRect();
    return [{ name, rect }];
  });

  for (const { name, rect } of measured) {
    if (rect.width <= 0 || rect.height <= 0) issues.push(`${name} has no visible area`);
    if (rect.left < 0 || rect.top < 0 || rect.right > viewportWidth || rect.bottom > viewportHeight) {
      issues.push(`${name} leaves the viewport`);
    }
  }

  for (let first = 0; first < measured.length; first += 1) {
    for (let second = first + 1; second < measured.length; second += 1) {
      const a = measured[first];
      const b = measured[second];
      if (a && b &&
        a.rect.left < b.rect.right && a.rect.right > b.rect.left &&
        a.rect.top < b.rect.bottom && a.rect.bottom > b.rect.top) {
        issues.push(`${a.name} overlaps ${b.name}`);
      }
    }
  }

  return issues;
}
