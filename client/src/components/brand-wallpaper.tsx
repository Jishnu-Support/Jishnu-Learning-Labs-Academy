export type BrandWallpaperVariant = 'intro' | 'auth' | 'app';

export function BrandWallpaper({ variant }: { variant: BrandWallpaperVariant }) {
  return (
    <div
      className={`brand-wallpaper brand-wallpaper--${variant}`}
      data-variant={variant}
      aria-hidden="true"
      style={{ pointerEvents: 'none' }}
    />
  );
}
