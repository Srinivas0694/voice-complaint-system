import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void:   'var(--void)',
        panel:  'var(--panel)',
        raised: 'var(--raised)',
        line:   'var(--line)',
        frost:  'var(--frost)',
        ember:  'var(--ember)',
        crit:   'var(--crit)',
        ink:    'var(--ink)',
        mist:   'var(--mist)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        sans:    ['var(--font-body)', 'system-ui', 'sans-serif'],
        mono:    ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: { xl2: '14px' },
    },
  },
  plugins: [],
} satisfies Config;
