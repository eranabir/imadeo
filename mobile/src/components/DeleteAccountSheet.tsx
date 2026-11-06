import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text, TextInput, View } from 'react-native';
import { ApiError } from '../lib/api';
import { accountDeletionOptions, deleteOwnAccount, type AccountDeletionOptions } from '../lib/accountDeletion';
import { colors, radius } from '../theme';
import { Button, Sheet, SheetRow } from './ui';

export function DeleteAccountSheet({ open, serverUrl, email, onClose, onDeleted }: {
  open: boolean;
  serverUrl: string;
  email: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [options, setOptions] = useState<AccountDeletionOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [successorId, setSuccessorId] = useState('');
  const [acknowledgeLockout, setAcknowledgeLockout] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    let alive = true;
    setOptions(null); setPassword(''); setConfirmation(''); setSuccessorId(''); setAcknowledgeLockout(false); setError(null);
    if (!open) return;
    setLoading(true);
    void accountDeletionOptions(serverUrl).then(value => { if (alive) setOptions(value); })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : 'Could not read deletion options.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, serverUrl]);

  const ready = !!options && !loading && !busy
    && confirmation.trim().toLowerCase() === email.toLowerCase()
    && (!options.hasPassword || password.length > 0)
    && (!options.requiresSuccessor || !!successorId)
    && (!options.leavesServerWithoutAdmin || acknowledgeLockout);
  const close = () => { if (!pending.current) onClose(); };
  const submit = async () => {
    if (!ready || pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      const receipt = await deleteOwnAccount(serverUrl, {
        confirmationEmail: confirmation.trim(),
        ...(options!.hasPassword ? { currentPassword: password } : {}),
        ...(successorId ? { successorId } : {}),
        ...(options!.leavesServerWithoutAdmin ? { acknowledgeServerLockout: acknowledgeLockout } : {}),
      });
      setPassword(''); setConfirmation('');
      Alert.alert('Account deletion requested',
        `Your sign-in access and shared links have been removed. Your account and media will be permanently deleted after ${receipt.gracePeriodDays} days.`);
      onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not request account deletion.');
      if (cause instanceof ApiError && ['ADMIN_SUCCESSOR_REQUIRED', 'SERVER_LOCKOUT_ACKNOWLEDGEMENT_REQUIRED'].includes(cause.code ?? '')) {
        try { setOptions(await accountDeletionOptions(serverUrl)); } catch { /* keep the original actionable error */ }
      }
    } finally { pending.current = false; setBusy(false); }
  };
  const field = { color: colors.text, fontSize: 16, paddingHorizontal: 16, paddingVertical: 13,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg };

  return <Sheet open={open} title="Delete account" onClose={close}
    description="Delete your account and its media from this server. Your device’s photo library stays available."
    footer={<View style={{ gap: 10 }}>
      <Button label={busy ? 'Requesting deletion…' : 'Delete my account'} variant="danger"
        disabled={!ready} onPress={() => void submit()} />
      <Button label="Cancel" variant="secondary" disabled={busy} onPress={close} />
    </View>}>
    {loading && <ActivityIndicator color={colors.primary} />}
    {options && <View style={{ gap: 14 }}>
      <Text style={{ color: colors.text, fontSize: 14, lineHeight: 21 }}>
        Sign-in access and shared links stop immediately. Your account, photos, videos and other account data will be permanently removed after {options.gracePeriodDays} days. Original files in external libraries and copies in operator-managed backups stay under the server operator’s control.
      </Text>
      {options.willEmptyServer && <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>
        This is the last account on the server. After permanent deletion, the server will need first-administrator setup again.
      </Text>}
      {options.leavesServerWithoutAdmin && <View>
        <Text style={{ color: colors.text, fontSize: 14, lineHeight: 21 }}>
          Disabled accounts will remain on this server. Deleting your account leaves it without an administrator, and first-administrator setup will not reopen automatically.
        </Text>
        <SheetRow icon={acknowledgeLockout ? 'check' : 'lock'} label="I understand the server will have no administrator"
          disabled={busy} onPress={() => setAcknowledgeLockout(value => !value)} />
      </View>}
      {options.requiresSuccessor && <View>
        <Text style={{ color: colors.text, fontSize: 14, lineHeight: 21, marginBottom: 8 }}>
          You are the last administrator. Choose an account to take over administration so the other users keep access to a managed server.
        </Text>
        {options.successors.map(user => <SheetRow key={user.id} icon={successorId === user.id ? 'check' : 'person'}
          label={user.name || user.email} hint={user.email} disabled={busy} onPress={() => setSuccessorId(user.id)} />)}
      </View>}
      <Text style={{ color: colors.muted, fontSize: 13 }}>Type {email} to confirm</Text>
      <TextInput accessibilityLabel="Account email confirmation" value={confirmation} onChangeText={setConfirmation}
        autoCapitalize="none" autoCorrect={false} keyboardType="email-address" editable={!busy} style={field} />
      {options.hasPassword && <>
        <Text style={{ color: colors.muted, fontSize: 13 }}>Current password</Text>
        <TextInput accessibilityLabel="Current password" value={password} onChangeText={setPassword}
          secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password"
          editable={!busy} style={field} />
      </>}
    </View>}
    {error && <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14, lineHeight: 21, marginTop: 14 }}>{error}</Text>}
  </Sheet>;
}
