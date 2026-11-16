import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PageErrorBoundary } from './ui/PageErrorBoundary';
import './styles.css';
import './match-screen.css';
import './game-workspace.css';

// Every page has its own boundary; this outer one only catches a failure elsewhere (owner feedback: never a black screen).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PageErrorBoundary title="This screen" savesFirst={false} onReload={() => window.location.reload()} fullScreen retry={false}>
      <App />
    </PageErrorBoundary>
  </StrictMode>,
);
