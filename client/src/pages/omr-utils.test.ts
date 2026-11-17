import { describe, expect, it } from 'vitest';
import { gradeOmrAnswers, readOmrAnswers, selectQuestions, type OmrQuestion } from './omr-utils';

const bank: OmrQuestion[] = Array.from({ length: 5 }, (_, index) => ({
  id: `math-${index}`,
  subject: 'Mathematics',
  difficulty: 'EASY',
  question: `Question ${index}`,
  options: ['A', 'B', 'C', 'D'],
  correctAnswer: 'B',
  explanation: 'Sample explanation',
}));

describe('question paper helpers', () => {
  it('selects the requested number from the chosen subject and difficulty without mutating the bank', () => {
    const selected = selectQuestions(bank, 'Mathematics', 'EASY', 3, () => 0.5);
    expect(selected).toHaveLength(3);
    expect(selected.every((question) => question.subject === 'Mathematics' && question.difficulty === 'EASY')).toBe(true);
    expect(bank.map((question) => question.id)).toEqual(['math-0', 'math-1', 'math-2', 'math-3', 'math-4']);
    expect(() => selectQuestions(bank, 'Physics', 'EASY', 1)).toThrow('valid number');
  });

  it('grades unanswered and incorrect answers as well as correct ones', () => {
    expect(gradeOmrAnswers(bank.slice(0, 3), ['B', 'A', ''], 2)).toEqual({
      correctCount: 1,
      marks: 2,
      totalMarks: 6,
      percentage: 33,
      answers: [{ selected: 'B', correct: true }, { selected: 'A', correct: false }, { selected: '', correct: false }],
    });
  });

  it('reads one marked bubble and leaves blank or multiple marks for manual entry', () => {
    const width = 700;
    const height = 990;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < data.length; index += 4) {
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = 255;
    }
    const mark = (questionIndex: number, optionIndex: number) => {
      const centerX = Math.round(width * (0.06 + 0.88 * (0.4 + (optionIndex + 0.5) * 0.15)));
      const centerY = Math.round(height * (0.22 + (0.73 * (questionIndex + 0.5)) / 2));
      for (let y = centerY - 5; y <= centerY + 5; y += 1) {
        for (let x = centerX - 5; x <= centerX + 5; x += 1) {
          const offset = (y * width + x) * 4;
          data[offset] = 20;
          data[offset + 1] = 20;
          data[offset + 2] = 20;
        }
      }
    };
    mark(0, 2);
    mark(1, 0);
    mark(1, 1);
    expect(readOmrAnswers({ data, width, height }, 2)).toEqual(['C', null]);
    expect(() => readOmrAnswers({ data, width: 1000, height: 1000 }, 2)).toThrow('portrait photo');
  });
});
