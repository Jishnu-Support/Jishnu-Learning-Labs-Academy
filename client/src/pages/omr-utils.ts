export type OmrQuestion = {
  id: string;
  subject: string;
  difficulty: string;
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
};

export type OmrGrade = {
  correctCount: number;
  marks: number;
  totalMarks: number;
  percentage: number;
  answers: Array<{ selected: string; correct: boolean }>;
};

const optionLetters = ['A', 'B', 'C', 'D'];

export function selectQuestions(
  bank: OmrQuestion[],
  subject: string,
  difficulty: string,
  count: number,
  random = Math.random,
) {
  const pool = bank.filter((item) => item.subject === subject && item.difficulty === difficulty);
  if (!Number.isInteger(count) || count < 1 || count > pool.length) {
    throw new Error('Choose a valid number of questions for this subject and difficulty.');
  }
  const shuffled = [...pool];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }
  return shuffled.slice(0, count);
}

export function gradeOmrAnswers(questions: OmrQuestion[], answers: string[], marksPerQuestion: number): OmrGrade {
  if (!Number.isFinite(marksPerQuestion) || marksPerQuestion <= 0) {
    throw new Error('Marks per question must be greater than zero.');
  }
  const graded = questions.map((question, index) => {
    const selected = answers[index] ?? '';
    return { selected, correct: Boolean(selected) && selected === question.correctAnswer };
  });
  const correctCount = graded.filter((item) => item.correct).length;
  const totalMarks = questions.length * marksPerQuestion;
  const marks = correctCount * marksPerQuestion;
  return {
    correctCount,
    marks,
    totalMarks,
    percentage: totalMarks ? Math.round((marks / totalMarks) * 100) : 0,
    answers: graded,
  };
}

export function readOmrAnswers(image: { data: Uint8ClampedArray; width: number; height: number }, questionCount: number) {
  const { data, width, height } = image;
  if (!Number.isInteger(questionCount) || questionCount < 1 || width < 100 || height < 100) {
    throw new Error('The answer sheet image could not be read.');
  }
  const aspectRatio = width / height;
  if (Math.abs(aspectRatio - (210 / 297)) > 0.055) {
    throw new Error('Use a portrait photo or scan that shows the complete answer sheet, without cropping.');
  }

  const answers: Array<string | null> = [];
  const sampleRadius = Math.max(2, Math.round(width * 0.004));
  for (let questionIndex = 0; questionIndex < questionCount; questionIndex += 1) {
    const centerY = Math.round(height * (0.22 + (0.73 * (questionIndex + 0.5)) / questionCount));
    const marked: string[] = [];
    for (let optionIndex = 0; optionIndex < optionLetters.length; optionIndex += 1) {
      const centerX = Math.round(width * (0.06 + 0.88 * (0.4 + (optionIndex + 0.5) * 0.15)));
      let darkPixels = 0;
      let sampledPixels = 0;
      for (let y = Math.max(0, centerY - sampleRadius); y <= Math.min(height - 1, centerY + sampleRadius); y += 1) {
        for (let x = Math.max(0, centerX - sampleRadius); x <= Math.min(width - 1, centerX + sampleRadius); x += 1) {
          const offset = (y * width + x) * 4;
          const luminance = 0.299 * data[offset]! + 0.587 * data[offset + 1]! + 0.114 * data[offset + 2]!;
          if (luminance < 100) darkPixels += 1;
          sampledPixels += 1;
        }
      }
      if (sampledPixels && darkPixels / sampledPixels >= 0.2) marked.push(optionLetters[optionIndex]!);
    }
    answers.push(marked.length === 1 ? marked[0]! : null);
  }
  return answers;
}
