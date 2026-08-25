import { SettingsScreen } from '../../src/screens/SettingsScreen';
import { useSession } from '../../src/session';
import { ActiveTab } from '../../src/components/ActiveTab';

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
    <ActiveTab serverUrl={server.url} defer>
      <SettingsScreen
        server={server}
        onAddServerAddress={addServerAddress}
        onRemoveServerAddress={removeServerAddress}
        onActivateServerAddress={activateServerAddress}
        onChangeServer={() => void changeServer()}
      />
    </ActiveTab>
  );
}
