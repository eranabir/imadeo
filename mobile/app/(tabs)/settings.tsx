import { SettingsScreen } from '../../src/screens/SettingsScreen';
import { useSession } from '../../src/session';

export default function Route() {
  const { server, changeServer, leave } = useSession();

  return (
    <SettingsScreen
      serverUrl={server?.url ?? ''}
      onChangeServer={() => void changeServer()}
      onSignOut={() => void leave()}
    />
  );
}
