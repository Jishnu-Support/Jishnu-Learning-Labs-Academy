import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TutorSampleProfile } from './my-profile-page';

describe('sample Tutor profile', () => {
  it('keeps fake identity masked and updates editable sample fields in place', () => {
    render(<TutorSampleProfile />);
    expect(screen.getByLabelText('Aadhaar card number (masked sample)')).toHaveValue('XXXX-XXXX-1234');
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sample Tutor Two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save sample profile' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Sample Tutor Two');
    expect(screen.getByRole('status')).toHaveTextContent('Sample profile updated in this browser session.');
    expect(screen.getByLabelText('Aadhaar card number (masked sample)')).toHaveValue('XXXX-XXXX-1234');
  });
});
