import type { Config } from 'tailwindcss';

// Tokens live as CSS custom properties in globals.css (71UI / design.md). This
// maps them onto Tailwind's scale so components use `bg-canvas`, `text-ink-subtle`,
// `border-hairline`, `rounded-lg`, `font-display` — never raw hex.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--color-canvas)',
        surface: 'var(--color-surface)',
        'surface-2': 'var(--color-surface-2)',
        hairline: 'var(--color-hairline)',
        'hairline-strong': 'var(--color-hairline-strong)',
        'ink-strong': 'var(--color-ink-strong)',
        ink: 'var(--color-ink)',
        'ink-subtle': 'var(--color-ink-subtle)',
        primary: 'var(--color-primary)',
        'primary-hover': 'var(--color-primary-hover)',
        'on-primary': 'var(--color-on-primary)',
        link: 'var(--color-link)',
        inverse: 'var(--color-inverse)',
        'inverse-hover': 'var(--color-inverse-hover)',
        'on-inverse': 'var(--color-on-inverse)',
        'control-border': 'var(--color-control-border)',
        success: 'var(--color-success)',
        'success-fill': 'var(--color-success-fill)',
        'on-success': 'var(--color-on-success)',
        'warning-fill': 'var(--color-warning-fill)',
        'on-warning': 'var(--color-on-warning)',
        danger: 'var(--color-danger)',
        'danger-fill': 'var(--color-danger-fill)',
        'on-danger': 'var(--color-on-danger)',
        'info-fill': 'var(--color-info-fill)',
        'on-info': 'var(--color-on-info)',
        up: 'var(--color-up)',
        down: 'var(--color-down)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'ui-serif', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        control: 'var(--radius-control)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        '3xl': 'var(--radius-3xl)',
      },
      boxShadow: {
        ring: 'var(--shadow-ring)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      maxWidth: {
        container: '1280px',
        measure: '680px',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        'out-expo': 'var(--ease-out-expo)',
        standard: 'var(--ease-standard)',
      },
    },
  },
  plugins: [],
};
export default config;
