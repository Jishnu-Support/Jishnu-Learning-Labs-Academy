export type Thirukural = {
  number: number;
  kural: string;
  meaning: string;
};
export const thirukurals: Thirukural[];
export function getDailyThirukural(date?: Date): Thirukural;
export function getThirukuralLines(kural: string): [string, string];
