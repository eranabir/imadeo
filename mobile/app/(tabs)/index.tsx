import { LibraryScreen } from '../../src/screens/LibraryScreen';
import { ActiveTab } from '../../src/components/ActiveTab';
import { useSession } from '../../src/session';

export default function Route() {
  const { server } = useSession();
  if (!server) return null;
  return <ActiveTab serverUrl={server.url}><LibraryScreen server={server} /></ActiveTab>;
}
