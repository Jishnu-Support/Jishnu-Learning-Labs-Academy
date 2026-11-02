type Props = {
  className?: string;
};

export function BrandLogo({ className }: Props) {
  return <img className={className} src="/brand/jishnu-logo.png" alt="Jishnu Learning Labs — Empowering Minds" />;
}
