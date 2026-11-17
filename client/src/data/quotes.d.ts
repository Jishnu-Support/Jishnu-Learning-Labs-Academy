export type Quote = { text: string; author: string };
export const quotes: readonly Quote[];
export function getDailyQuote(date?: Date): Quote;
