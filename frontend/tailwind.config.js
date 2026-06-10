/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ready:   { DEFAULT: '#22c55e', light: '#dcfce7', dark: '#16a34a' },
        review:  { DEFAULT: '#eab308', light: '#fef9c3', dark: '#ca8a04' },
        localize:{ DEFAULT: '#3b82f6', light: '#dbeafe', dark: '#2563eb' },
        escalate:{ DEFAULT: '#ef4444', light: '#fee2e2', dark: '#dc2626' },
        surface: '#f8fafc',
        border:  '#e2e8f0',
      },
    },
  },
  plugins: [],
}
