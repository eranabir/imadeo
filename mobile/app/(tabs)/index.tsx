import { LibraryScreen } from '../../src/screens/LibraryScreen';
import { ActiveTab } from '../../src/components/ActiveTab';
import { useServerUrl } from '../../src/session';

export default function Route() {
  const serverUrl = useServerUrl();
  return <ActiveTab serverUrl={serverUrl}><LibraryScreen serverUrl={serverUrl} /></ActiveTab>;
}
