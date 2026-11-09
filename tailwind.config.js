/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
      },
      colors: {
        navy: {
          50: '#f2f5fb', 100: '#e3e9f5', 200: '#c4d0ea', 300: '#97acd8',
          400: '#6482c1', 500: '#4262aa', 600: '#324c8f', 700: '#293e74',
          800: '#1f2f58', 900: '#152040', 950: '#0c142b',
        },
        ink: { DEFAULT: '#0f172a', soft: '#475569', faint: '#94a3b8' },
        canvas: '#f7f8fb',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06)',
        lift: '0 4px 16px rgba(15,23,42,0.08)',
      },
    },
  },
  plugins: [],
};
