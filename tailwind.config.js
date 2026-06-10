/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        sidebar: {
          bg: 'var(--sidebar-bg)',
          text: 'var(--sidebar-text)',
          active: 'var(--sidebar-text-active)',
          hover: 'var(--sidebar-hover)',
          divider: 'var(--sidebar-divider)',
          category: 'var(--sidebar-category-text)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          light: 'var(--accent-light)',
          dark: 'var(--accent-dark)',
          glow: 'var(--accent-glow)',
        },
        panel: {
          bg: 'var(--panel-bg)',
          border: 'var(--panel-border)',
          header: 'var(--panel-header-bg)',
        },
        list: {
          hover: 'var(--list-hover)',
          active: 'var(--list-active)',
          source: 'var(--list-source)',
          title: 'var(--list-title)',
          'title-read': 'var(--list-title-read)',
          summary: 'var(--list-summary)',
          time: 'var(--list-time)',
        },
        reading: {
          title: 'var(--reading-title)',
          text: 'var(--reading-text)',
          meta: 'var(--reading-meta)',
          link: 'var(--reading-link)',
        },
        star: {
          DEFAULT: 'var(--star-color)',
          inactive: 'var(--star-inactive)',
        },
      },
    },
  },
  plugins: [],
};
