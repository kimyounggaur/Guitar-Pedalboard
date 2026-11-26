import { AppErrorBoundary } from './app/AppErrorBoundary';
import { ToastRegion } from './components/Toast';
import { SessionProtection } from './components/SessionProtection';
import { AppShell } from './components/AppShell';

export default function App() {
  return <AppErrorBoundary><ToastRegion /><SessionProtection /><AppShell /></AppErrorBoundary>;
}
