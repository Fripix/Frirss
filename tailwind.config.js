/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // Pas de palette ici : l'interface lit les variables du thème directement
  // (`style={{ color: 'var(--…)' }}`, `bg-[var(--…)]`). L'ancienne
  // `theme.extend.colors` ne générait aucune classe utilisée (retirée en 1.8.0).
  theme: { extend: {} },
  plugins: [],
};
