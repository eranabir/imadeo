import { SettingsScreen } from '../../src/screens/SettingsScreen';
import { useSession } from '../../src/session';

export default function Route() {
  const { server, changeServer } = useSession();

  return (
    <SettingsScreen
      serverUrl={server?.url ?? ''}
      onChangeServer={() => void changeServer()}
    />
  );
}
