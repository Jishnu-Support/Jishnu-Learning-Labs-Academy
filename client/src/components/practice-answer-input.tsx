import type { ReactNode } from 'react';

type PracticeInputQuestion = {
  id: string;
  type: string;
  prompt: string;
  options: unknown;
};

function optionPairs(options: unknown) {
  if (!Array.isArray(options)) return [];
  return options.filter((item): item is { left: string; right: string } =>
    Boolean(item) && typeof item === 'object' && 'left' in item && typeof item.left === 'string' && 'right' in item && typeof item.right === 'string');
}

function stringOptions(options: unknown) {
  return Array.isArray(options) ? options.map((item) => typeof item === 'string' ? item : String(item)) : [];
}

function asRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
}

export function PracticeAnswerInput({
  question,
  value,
  onChange,
}: {
  question: PracticeInputQuestion;
  value: unknown;
  onChange: (answer: unknown) => void;
}) {
  const options = stringOptions(question.options);
  if (question.type === 'TRUE_FALSE' || question.type === 'MCQ_SINGLE') {
    const choices = question.type === 'TRUE_FALSE' ? (options.length ? options : ['True', 'False']) : options;
    return <fieldset className="practice-answer-options"><legend>Your answer</legend>{choices.map((option, index) => (
      <label className="practice-answer-choice" key={`${option}:${index}`}><input type="radio" name={`answer-${question.id}`} checked={value === option} onChange={() => onChange(option)} />{option}</label>
    ))}</fieldset>;
  }
  if (question.type === 'MCQ_MULTIPLE') {
    const selected = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    return <fieldset className="practice-answer-options"><legend>Your answers</legend>{options.map((option, index) => (
      <label className="practice-answer-choice" key={`${option}:${index}`}><input type="checkbox" checked={selected.includes(option)} onChange={(event) => onChange(event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))} />{option}</label>
    ))}</fieldset>;
  }
  if (question.type === 'MATCH') {
    const pairs = optionPairs(question.options);
    const selected = asRecord(value);
    const choices = [...new Set(pairs.map(({ right }) => right))];
    return <div className="practice-match-inputs">{pairs.map(({ left }) => (
      <label className="field" key={left}><span>{left}</span><select className="input" value={selected[left] ?? ''} onChange={(event) => onChange({ ...selected, [left]: event.target.value })}><option value="">Select a match</option>{choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select></label>
    ))}</div>;
  }
  if (question.type === 'FILL_BLANK' || question.type === 'FILL_IN_BLANK') {
    const blankCount = Math.max(1, question.prompt.match(/\{\{blank\}\}|\[blank\]|_{3,}/gi)?.length ?? 0);
    const answers = Array.isArray(value) ? value.map(String) : [typeof value === 'string' ? value : ''];
    const fields: ReactNode[] = Array.from({ length: blankCount }, (_, index) => (
      <label className="field" key={index}><span>{blankCount > 1 ? `Blank ${index + 1}` : 'Your answer'}</span><input className="input" value={answers[index] ?? ''} onChange={(event) => {
        const next = Array.from({ length: blankCount }, (_, answerIndex) => answers[answerIndex] ?? '');
        next[index] = event.target.value;
        onChange(blankCount === 1 ? next[0] : next);
      }} /></label>
    ));
    return <div className="practice-fill-inputs">{fields}</div>;
  }
  return <label className="field"><span>Your answer</span><textarea className="input" value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} /></label>;
}
