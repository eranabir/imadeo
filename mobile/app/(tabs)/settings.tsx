import { SettingsScreen } from '../../src/screens/SettingsScreen';
import { useSession } from '../../src/session';

export default function Route() {
  const {
    server,
    changeServer,
    addServerAddress,
    removeServerAddress,
    activateServerAddress,
  } = useSession();

  if (!server) return null;

  return (
    <SettingsScreen
      server={server}
      onAddServerAddress={addServerAddress}
      onRemoveServerAddress={removeServerAddress}
      onActivateServerAddress={activateServerAddress}
      onChangeServer={() => void changeServer()}
    />
  );
}
