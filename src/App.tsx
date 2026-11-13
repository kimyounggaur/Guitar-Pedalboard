import { ErrorBoundary } from './components/ErrorBoundary';
import { StorageNotice } from './components/StorageNotice';
import { SessionProtection } from './components/SessionProtection';
import { AppShell } from './components/AppShell';

export default function App() {
  return <ErrorBoundary><StorageNotice /><SessionProtection /><AppShell /></ErrorBoundary>;
}
