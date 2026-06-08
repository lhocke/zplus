import './style.css';
import { isThemeName, DEFAULT_THEME } from './ui/themes.js';
import { mountShell } from './ui/shell.js';

// Apply saved theme before first paint to avoid a flash of the default.
const saved = localStorage.getItem('zork-theme');
const theme = isThemeName(saved) ? saved : DEFAULT_THEME;
document.documentElement.setAttribute('data-theme', theme);

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  mountShell(app);
}
