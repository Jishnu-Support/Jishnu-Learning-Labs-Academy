export const quotes = [
  { text: 'Every small lesson learned today makes tomorrow easier.', author: 'Jishnu Learning Labs' },
  { text: 'Curiosity turns a question into a new opportunity.', author: 'Jishnu Learning Labs' },
  { text: 'Progress grows when you keep showing up.', author: 'Jishnu Learning Labs' },
  { text: 'A clear goal gives your effort somewhere to go.', author: 'Jishnu Learning Labs' },
  { text: 'Practice is how new ideas become your own.', author: 'Jishnu Learning Labs' },
  { text: 'One focused step is still a step forward.', author: 'Jishnu Learning Labs' },
  { text: 'Mistakes are useful clues on the way to understanding.', author: 'Jishnu Learning Labs' },
  { text: 'Your pace is valid; keep moving with purpose.', author: 'Jishnu Learning Labs' },
  { text: 'Learning begins when you make room for a new idea.', author: 'Jishnu Learning Labs' },
  { text: 'A little consistency can carry a big ambition.', author: 'Jishnu Learning Labs' },
  { text: 'Ask, explore, and let understanding take shape.', author: 'Jishnu Learning Labs' },
  { text: 'Today is a good day to learn one useful thing.', author: 'Jishnu Learning Labs' },
  { text: 'Effort becomes progress when you return to the work.', author: 'Jishnu Learning Labs' },
  { text: 'Strong foundations are built one concept at a time.', author: 'Jishnu Learning Labs' },
  { text: 'Give your attention to the next small step.', author: 'Jishnu Learning Labs' },
  { text: 'A thoughtful question can open a whole new path.', author: 'Jishnu Learning Labs' },
  { text: 'Keep your goals close and your curiosity closer.', author: 'Jishnu Learning Labs' },
  { text: 'Confidence follows the practice you put in.', author: 'Jishnu Learning Labs' },
  { text: 'Every attempt teaches you something worth keeping.', author: 'Jishnu Learning Labs' },
  { text: 'Take your time; understanding is worth building well.', author: 'Jishnu Learning Labs' },
  { text: 'Make today count with one deliberate effort.', author: 'Jishnu Learning Labs' },
  { text: 'A new skill grows each time you choose to practice.', author: 'Jishnu Learning Labs' },
  { text: 'Notice how far you have come, then keep going.', author: 'Jishnu Learning Labs' },
  { text: 'Learning is stronger when curiosity leads the way.', author: 'Jishnu Learning Labs' },
  { text: 'Small wins are the building blocks of big goals.', author: 'Jishnu Learning Labs' },
  { text: 'Be patient with the process and persistent with your aim.', author: 'Jishnu Learning Labs' },
  { text: 'Use what you know to make sense of what is next.', author: 'Jishnu Learning Labs' },
  { text: 'A steady learner can turn challenge into capability.', author: 'Jishnu Learning Labs' },
  { text: 'Your next breakthrough may start with one more question.', author: 'Jishnu Learning Labs' },
  { text: 'Keep learning; the possibilities keep growing.', author: 'Jishnu Learning Labs' },
];

export function getDailyQuote(date = new Date()) {
  const year = date.getFullYear();
  const dayOfYear = Math.floor(
    (Date.UTC(year, date.getMonth(), date.getDate()) - Date.UTC(year, 0, 1)) / 86_400_000,
  );
  return quotes[dayOfYear % quotes.length];
}
