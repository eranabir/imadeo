import { useEffect, useState } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Input } from './Input';

interface Props {
  open: boolean;
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

/**
 * Replaces window.prompt.
 *
 * That API is not just unstyled — browsers silently suppress it in a number of
 * situations (repeat dialogs, embedded frames), which is why creating a folder
 * appeared to do nothing at all.
 */
export function PromptDialog({
  open,
  title,
  description,
  label = 'Name',
  placeholder,
  initialValue = '',
  confirmLabel = 'Create',
  onSubmit,
  onClose,
}: Props) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!value.trim()} onClick={submit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Input
        label={label}
        placeholder={placeholder}
        value={value}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
        }}
      />
    </Dialog>
  );
}
