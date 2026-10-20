export const inputStyle = { border: '1px solid var(--panel-border)', color: 'var(--list-title)', background: 'var(--panel-header-bg)' } as const;
export const inputClass = 'prefs-tap-row w-full px-3 py-1.5 text-sm rounded-md min-h-[36px]';
export const quietBtn = 'prefs-tap-btn px-2.5 py-1.5 text-xs rounded-md cursor-pointer disabled:opacity-40 disabled:cursor-default';

export function BlockTitle({ children }: { children: string }) {
  return (
    <h3 className="flex items-center gap-2.5 text-sm font-bold" style={{ color: 'var(--list-title)' }}>
      <span aria-hidden="true" className="inline-block w-1 h-4 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
      {children}
    </h3>
  );
}
