import { SearchScreen } from '../../src/screens/SearchScreen';
import { ActiveTab } from '../../src/components/ActiveTab';
import { useServerUrl } from '../../src/session';

export default function Route() {
  const serverUrl = useServerUrl();
  return (
    <ActiveTab serverUrl={serverUrl} defer>
      <SearchScreen serverUrl={serverUrl} />
    </ActiveTab>
  );
}
