import { PeopleScreen } from '../../src/screens/PeopleScreen';
import { useServerUrl } from '../../src/session';

export default function Route() {
  const serverUrl = useServerUrl();
  return <PeopleScreen serverUrl={serverUrl} />;
}
