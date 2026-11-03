import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BrandWallpaper, type BrandWallpaperVariant } from './brand-wallpaper';

describe('BrandWallpaper', () => {
  it.each<BrandWallpaperVariant>(['intro', 'auth', 'app'])('renders the %s variant as a non-interactive layer', (variant) => {
    const onClick = vi.fn();
    const { container } = render(
      <div>
        <BrandWallpaper variant={variant} />
        <button type="button" onClick={onClick}>Continue</button>
      </div>,
    );
    const wallpaper = container.querySelector(`[data-variant="${variant}"]`);

    expect(wallpaper).toHaveAttribute('aria-hidden', 'true');
    expect(wallpaper).toHaveStyle({ pointerEvents: 'none' });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
