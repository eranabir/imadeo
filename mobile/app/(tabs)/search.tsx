import { SearchScreen } from '../../src/screens/SearchScreen';
import { useServerUrl } from '../../src/session';

export default function Route() {
  const serverUrl = useServerUrl();
  return <SearchScreen serverUrl={serverUrl} />;
}
