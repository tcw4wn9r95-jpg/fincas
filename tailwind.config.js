/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm, elegant, minimalist palette.
        canvas: '#f6f3ec', // soft cream background
        paper: '#fbf9f4', // raised surfaces / cards
        ink: '#1c2521', // primary text — near-black green
        muted: '#6b7670', // secondary text
        line: '#e6e0d4', // hairline borders
        forest: {
          DEFAULT: '#1f3d34', // primary brand green
          soft: '#2e5347',
          tint: '#e8efe9',
        },
        sage: '#6fae93', // positive / growth
        clay: '#c2724e', // caution / expense accent
        gold: '#c9a14a', // highlight
      },
      fontFamily: {
        serif: ['Fraunces', 'Georgia', 'Cambria', 'serif'],
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(28,37,33,0.04), 0 8px 24px rgba(28,37,33,0.06)',
        lift: '0 2px 6px rgba(28,37,33,0.06), 0 18px 48px rgba(28,37,33,0.10)',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'draw-in': {
          '0%': { strokeDashoffset: '1' },
          '100%': { strokeDashoffset: '0' },
        },
        'splash-out': {
          '0%': { opacity: '1' },
          '100%': { opacity: '0', visibility: 'hidden' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.22,1,0.36,1) both',
        'fade-in': 'fade-in 0.6s ease both',
      },
    },
  },
  plugins: [],
}
