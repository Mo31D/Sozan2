import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './simple-ui.css';
import './simple-v2.css';
import './simple/v2/attendance.css';
import './simple/v2/schedule.css';
import './simple/v2/management.css';
import './simple/v2/money.css';
import './appointments/appointments.css';
import './control-center.css';
import './mobile-compact.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing #root element');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // The application itself remains fully usable; PWA caching is best-effort.
    });
  });
}
