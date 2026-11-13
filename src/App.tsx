import { ErrorBoundary } from './components/ErrorBoundary';
import { StorageNotice } from './components/StorageNotice';
import { AppShell } from './components/AppShell';

export default function App() {
  return <ErrorBoundary><StorageNotice /><AppShell /></ErrorBoundary>;
}
