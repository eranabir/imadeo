import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { Button, Dialog, Input } from '../ui';

export interface VaultStatus {
  isConfigured: boolean;
  isUnlocked: boolean;
  unlockedUntil: string | null;
}

export function useVaultStatus() {
  return useQuery({
    queryKey: ['auth', 'vault'],
    queryFn: async () => (await api.get<VaultStatus>('/auth/vault')).data,
    // The unlock expires on its own, so do not serve a stale "unlocked".
    staleTime: 10_000,
  });
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Runs once the vault is unlocked, e.g. the action that needed it. */
  onUnlocked?: () => void;
}

/**
 * Sets the vault PIN the first time and unlocks it thereafter.
 *
 * The PIN never leaves this dialog: the server keeps it only as a bcrypt hash
 * and uses it to unwrap the vault's content key, so losing it means losing
 * access — which is why the setup step says so plainly.
 */
export function VaultDialog({ open, onClose, onUnlocked }: Props) {
  const queryClient = useQueryClient();
  const { data: status } = useVaultStatus();

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isSetup = status && !status.isConfigured;

  const reset = () => {
    setPin('');
    setConfirmPin('');
    setError(null);
  };

  const done = () => {
    void queryClient.invalidateQueries();
    reset();
    onUnlocked?.();
    onClose();
  };

  const setPinMutation = useMutation({
    mutationFn: async () => (await api.post('/auth/vault/pin', { pin })).data,
    // Setting a PIN does not unlock the session, so follow straight on.
    onSuccess: async () => {
      await api.post('/auth/vault/unlock', { pin });
      done();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const unlock = useMutation({
    mutationFn: async () => (await api.post('/auth/vault/unlock', { pin })).data,
    onSuccess: done,
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = () => {
    setError(null);
    if (!/^\d{4,12}$/.test(pin)) {
      setError('The PIN must be 4 to 12 digits.');
      return;
    }
    if (isSetup && pin !== confirmPin) {
      setError('The two PINs do not match.');
      return;
    }
    (isSetup ? setPinMutation : unlock).mutate();
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={isSetup ? 'Set a vault PIN' : 'Unlock the vault'}
      description={
        isSetup
          ? 'Locked folders and albums are hidden from the timeline, search and every share link. There is no way to recover this PIN, so keep it somewhere safe.'
          : 'Enter your PIN to open locked folders and albums on this device.'
      }
      footer={
        <>
          <Button
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={isSetup ? <ShieldCheck size={15} /> : <KeyRound size={15} />}
            disabled={setPinMutation.isPending || unlock.isPending}
            onClick={submit}
          >
            {isSetup ? 'Set PIN' : 'Unlock'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !isSetup) submit();
          }}
          placeholder="••••"
        />

        {isSetup && (
          <Input
            label="Confirm PIN"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={confirmPin}
            onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ''))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
            placeholder="••••"
          />
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <p className="flex items-start gap-2 rounded-control bg-surface-sunken px-3 py-2.5 text-xs text-content-muted">
          <Lock size={13} className="mt-0.5 shrink-0" />
          The vault re-locks itself automatically after a period of inactivity, and on every
          other device you are signed in to.
        </p>
      </div>
    </Dialog>
  );
}
