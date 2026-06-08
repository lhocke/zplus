import './style.css';
import { isThemeName, DEFAULT_THEME } from './ui/themes.js';

// Apply saved theme before first paint to avoid a flash of the default.
const saved = localStorage.getItem('zork-theme');
const theme = isThemeName(saved) ? saved : DEFAULT_THEME;
document.documentElement.setAttribute('data-theme', theme);

// Mount a loading state. The real shell (src/shell/) lands in a later task
// and will replace this element when it's ready.
const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  const loading = document.createElement('div');
  loading.className = 'zork-loading';
  loading.textContent = 'LOADING…';
  app.appendChild(loading);
}
