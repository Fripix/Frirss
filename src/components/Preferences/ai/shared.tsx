export function BlockTitle({ children }: { children: string }) {
  return (
    <h3 className="flex items-center gap-2.5 text-sm font-bold" style={{ color: 'var(--list-title)' }}>
      <span aria-hidden="true" className="inline-block w-1 h-4 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
      {children}
    </h3>
  );
}
