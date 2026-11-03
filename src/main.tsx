import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './charts.css';
import './mapping.css';
import './flags.css';
import { applyAccent, currentAccent } from './accent';

applyAccent(currentAccent());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
