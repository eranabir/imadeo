import { PeopleAndPetsScreen } from '../../src/screens/PeopleAndPetsScreen';
import { ActiveTab } from '../../src/components/ActiveTab';
import { useServerUrl } from '../../src/session';

export default function PeopleAndPetsRoute() {
  const serverUrl = useServerUrl();
  return (
    <ActiveTab serverUrl={serverUrl} defer>
      <PeopleAndPetsScreen serverUrl={serverUrl} />
    </ActiveTab>
  );
}
