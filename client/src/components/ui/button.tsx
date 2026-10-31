import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const buttonStyles = cva('button', {
  variants: { variant: { primary: 'button-primary', secondary: 'button-secondary', danger: 'button-danger', ghost: 'button-ghost' } },
  defaultVariants: { variant: 'primary' },
});

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles>;

export function Button({ className, variant, ...props }: ButtonProps) {
  return <button className={cn(buttonStyles({ variant }), className)} {...props} />;
}
