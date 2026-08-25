import { BrowseScreen } from '../../src/screens/BrowseScreen';
import { ActiveTab } from '../../src/components/ActiveTab';
import { useServerUrl } from '../../src/session';

export default function Route() {
  const serverUrl = useServerUrl();
  return (
    <ActiveTab serverUrl={serverUrl} defer>
      <BrowseScreen serverUrl={serverUrl} folderId={null} />
    </ActiveTab>
  );
}
