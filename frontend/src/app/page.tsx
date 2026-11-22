import { configuredEnvironments, defaultEnvironment } from '@/infrastructure/environments';
import { Dashboard } from '@/ui/components/Dashboard';

export const dynamic = 'force-dynamic';

export default function Page() {
  return <Dashboard environments={configuredEnvironments()} initial={defaultEnvironment()} />;
}
