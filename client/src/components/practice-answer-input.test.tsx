import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PracticeAnswerInput } from './practice-answer-input';

describe('PracticeAnswerInput', () => {
  it('uses radio controls for single-choice and true/false questions', () => {
    const onChange = vi.fn();
    const { rerender } = render(<PracticeAnswerInput question={{ id: 'one', type: 'MCQ_SINGLE', prompt: 'Choose one', options: ['A', 'B'] }} value="" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('A'));
    expect(onChange).toHaveBeenCalledWith('A');

    rerender(<PracticeAnswerInput question={{ id: 'two', type: 'TRUE_FALSE', prompt: 'Is it true?', options: ['True', 'False'] }} value="" onChange={onChange} />);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('uses checkboxes for multiple choice and selects for matching', () => {
    const onChange = vi.fn();
    const { rerender } = render(<PracticeAnswerInput question={{ id: 'multi', type: 'MCQ_MULTIPLE', prompt: 'Choose all', options: ['A', 'B'] }} value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('A'));
    expect(onChange).toHaveBeenCalledWith(['A']);

    rerender(<PracticeAnswerInput question={{ id: 'match', type: 'MATCH', prompt: 'Match', options: [{ left: 'One', right: 'First' }, { left: 'Two', right: 'Second' }] }} value={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('One'), { target: { value: 'First' } });
    expect(onChange).toHaveBeenLastCalledWith({ One: 'First' });
  });

  it('renders separate fill-in inputs for marked blanks', () => {
    const onChange = vi.fn();
    render(<PracticeAnswerInput question={{ id: 'fill', type: 'FILL_BLANK', prompt: '___ and {{blank}}', options: null }} value={[]} onChange={onChange} />);
    expect(screen.getByLabelText('Blank 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Blank 2')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Blank 2'), { target: { value: 'answer' } });
    expect(onChange).toHaveBeenCalledWith(['', 'answer']);
  });
});
