import { LibraryScreen } from '../../src/screens/LibraryScreen';
import { useServerUrl } from '../../src/session';

export default function Route() {
  const serverUrl = useServerUrl();
  return <LibraryScreen serverUrl={serverUrl} />;
}
