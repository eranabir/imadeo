import { PeopleAndPetsScreen } from '../../src/screens/PeopleAndPetsScreen';
import { useServerUrl } from '../../src/session';

export default function PeopleAndPetsRoute() {
  const serverUrl = useServerUrl();
  return <PeopleAndPetsScreen serverUrl={serverUrl} />;
}
