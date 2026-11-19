import { getDailyQuote } from '../data/quotes.js';
import { getDailyThirukural, getThirukuralLines } from '../data/thirukurals.js';

export function DailyWisdomCards() {
  const quote = getDailyQuote();
  const thirukural = getDailyThirukural();
  const [firstLine, secondLine] = getThirukuralLines(thirukural.kural);

  return <section className="daily-wisdom-grid" aria-label="Daily inspiration">
    <blockquote className="daily-quote-card daily-wisdom-card card">
      <p className="eyebrow">Motivation Quote of the Day</p>
      <p>“{quote.text}”</p>
      <cite>{quote.author}</cite>
    </blockquote>
    <article className="daily-kural-card daily-wisdom-card card">
      <p className="eyebrow">Thirukural of the Day · #{thirukural.number}</p>
      <p className="daily-kural-text" lang="ta">
        <span className="daily-kural-line">{firstLine}</span>
        <span className="daily-kural-line">{secondLine}</span>
      </p>
      <p className="daily-kural-meaning">{thirukural.meaning}</p>
    </article>
  </section>;
}
