import { BrowseScreen } from '../../src/screens/BrowseScreen';
import { useServerUrl } from '../../src/session';

export default function Route() {
  const serverUrl = useServerUrl();
  return <BrowseScreen serverUrl={serverUrl} folderId={null} />;
}
