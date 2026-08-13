import type { ComponentType, ReactNode } from 'react';

interface Props {
  icon: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

/** One empty-state treatment, so every "nothing here yet" screen matches. */
export function EmptyState({ icon: Icon, title, description, action }: Props) {
  return (
    <div className="grid place-items-center px-6 py-28 text-center">
      <span className="mb-4 grid h-14 w-14 place-items-center rounded-full bg-surface-sunken">
        <Icon size={24} className="text-content-muted" strokeWidth={1.6} />
      </span>
      <p className="font-medium">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-content-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
