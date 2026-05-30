// Boot entry. Real wiring (Game + shell + assist) lands in Phase 4.
const app = document.querySelector<HTMLDivElement>('#app');
if (app) app.textContent = 'boot';
