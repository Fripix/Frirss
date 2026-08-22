import { useState, useRef, useEffect, useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useThemeStore } from '../../stores/themeStore';
import { useUiStore } from '../../stores/uiStore';
import { useFeedStore } from '../../stores/feedStore';
import ToggleSwitch from '../ToggleSwitch';
import type { Tag } from '../../types';
import { TabResetButton } from './TabResetButton';

// Label grouping item (Preferences labels tab)
interface PrefLabelChild { tag: Tag; leafName: string; fullName: string }
interface PrefLabelItem { type: 'single' | 'parent' | 'group'; tag?: Tag; name: string; children?: PrefLabelChild[] }

type DropPosition = 'before' | 'after' | 'onto';
interface DropTarget { id: string; position: DropPosition }

/**
 * Group labels by prefix (same logic as Sidebar) for hierarchical display.
 */
function groupLabelsForPrefs(labels: Tag[], labelOrder: string[] = [], sortAlpha = true): PrefLabelItem[] {
  const childrenByPrefix: Record<string, PrefLabelChild[]> = {};
  const flatByName: Record<string, { tag: Tag; name: string }> = {};

  labels.forEach((tag) => {
    const fullName = tag.id.split('/label/').pop();
    if (!fullName) return;
    const slashIdx = fullName.indexOf('/');
    if (slashIdx > 0) {
      const prefix = fullName.substring(0, slashIdx);
      if (!childrenByPrefix[prefix]) childrenByPrefix[prefix] = [];
      childrenByPrefix[prefix].push({ tag, leafName: fullName.substring(slashIdx + 1), fullName });
    } else {
      flatByName[fullName] = { tag, name: fullName };
    }
  });

  const result: PrefLabelItem[] = [];
  const allNames = new Set([...Object.keys(flatByName), ...Object.keys(childrenByPrefix)]);
  const sorted = [...allNames].sort();

  sorted.forEach((name) => {
    const flat = flatByName[name];
    const children = childrenByPrefix[name];
    if (flat && children) {
      result.push({ type: 'parent', tag: flat.tag, name: flat.name, children });
    } else if (children) {
      result.push({ type: 'group', name, children });
    } else if (flat) {
      result.push({ type: 'single', tag: flat.tag, name: flat.name });
    }
  });

  // Apply custom order
  if (!sortAlpha && labelOrder.length > 0) {
    result.sort((a, b) => {
      const aId = a.tag?.id || a.children?.[0]?.tag.id || '';
      const bId = b.tag?.id || b.children?.[0]?.tag.id || '';
      const ai = labelOrder.indexOf(aId);
      const bi = labelOrder.indexOf(bId);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    result.forEach((item) => {
      if (item.children) {
        item.children.sort((a, b) => {
          const ai = labelOrder.indexOf(a.tag.id);
          const bi = labelOrder.indexOf(b.tag.id);
          if (ai === -1 && bi === -1) return 0;
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        });
      }
    });
  }

  return result;
}

export default function LabelsTab({ resetLabelColors }: { resetLabelColors: () => void }) {
  const { t } = useTranslation();
  const labels = useFeedStore((s) => s.labels);
  const renameLabel = useFeedStore((s) => s.renameLabel);
  const deleteLabel = useFeedStore((s) => s.deleteLabel);
  const loadLabelCounts = useFeedStore((s) => s.loadLabelCounts);
  const { labelColors, setLabelColor, toggleLabelInherit, removeLabelColor, getLabelColor, renameLabelColor } = useThemeStore();
  const { labelOrder, setLabelOrder, labelSortAlpha, setLabelSortAlpha, showLabelCounts, setShowLabelCounts } = useUiStore();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [dropGroupTarget, setDropGroupTarget] = useState<string | null>(null); // group name being hovered ('' = standalone)

  const grouped = groupLabelsForPrefs(labels, labelOrder, labelSortAlpha);

  // Build flat list of all label IDs for drag-reorder
  const allLabelIds = labels.map((l) => l.id);

  // Collect all group names (for "move to" dropdown)
  const groupNames = useMemo(() => {
    const names = new Set<string>();
    labels.forEach((tag) => {
      const fullName = tag.id.split('/label/').pop();
      if (!fullName) return;
      const slashIdx = fullName.indexOf('/');
      if (slashIdx > 0) names.add(fullName.substring(0, slashIdx));
      else names.add(fullName);
    });
    return [...names].sort();
  }, [labels]);

  // Resolve the parent of a label by its ID
  function getParentOf(labelId: string): string | null {
    const fullName = labelId.split('/label/').pop() ?? '';
    const slashIdx = fullName.indexOf('/');
    return slashIdx > 0 ? fullName.substring(0, slashIdx) : null;
  }

  // Move label to a different parent
  async function moveLabel(labelId: string, newParentName: string) {
    const fullName = labelId.split('/label/').pop() ?? '';
    const slashIdx = fullName.indexOf('/');
    const leafName = slashIdx > 0 ? fullName.substring(slashIdx + 1) : fullName;
    const currentParent = slashIdx > 0 ? fullName.substring(0, slashIdx) : null;

    if (newParentName === currentParent) return; // no change
    if (!newParentName && newParentName !== '') return;
    const newName = newParentName === '' ? leafName : `${newParentName}/${leafName}`;
    const newLabelId = `user/-/label/${newName}`;
    await renameLabel(labelId, newName);
    // Migrate label color entry to new ID
    renameLabelColor(labelId, newLabelId);
  }

  // Rename label + migrate color entry
  async function renameLabelWithColor(oldLabelId: string, newName: string) {
    const newLabelId = `user/-/label/${newName}`;
    const ok = await renameLabel(oldLabelId, newName);
    if (ok) renameLabelColor(oldLabelId, newLabelId);
    return ok;
  }

  // Delete label + remove color entry
  async function deleteLabelWithColor(labelId: string) {
    const ok = await deleteLabel(labelId);
    if (ok) removeLabelColor(labelId);
    return ok;
  }

  // Handle drop on a group header → move label into that group
  function handleGroupDrop(groupName: string) {
    if (!dragId) return;
    const currentParent = getParentOf(dragId);
    if (groupName === '' && currentParent === null) { cleanup(); return; }
    if (groupName === currentParent) { cleanup(); return; }
    moveLabel(dragId, groupName);
    cleanup();
  }

  function cleanup() {
    setDragId(null);
    setDropTarget(null);
    setDropGroupTarget(null);
  }

  // Unified drop handler: reorder (before/after) or nest (onto)
  function handleDrop(draggedId: string, targetId: string, position: DropPosition) {
    if (!draggedId || draggedId === targetId) { cleanup(); return; }

    // ── "onto" → nest the dragged label into the target's group ──
    if (position === 'onto') {
      const targetName = targetId.split('/label/').pop() ?? '';
      const targetSlash = targetName.indexOf('/');
      // If target is already a child, use its parent as group name
      const groupName = targetSlash > 0 ? targetName.substring(0, targetSlash) : targetName;
      // Don't nest into self
      const draggedName = draggedId.split('/label/').pop();
      if (groupName === draggedName) { cleanup(); return; }
      moveLabel(draggedId, groupName);
      cleanup();
      return;
    }

    // ── "before"/"after" → reorder ──
    const ids = labelOrder.length > 0 ? [...labelOrder] : allLabelIds;
    allLabelIds.forEach((id) => { if (!ids.includes(id)) ids.push(id); });
    const fromIdx = ids.indexOf(draggedId);
    if (fromIdx >= 0) ids.splice(fromIdx, 1);
    const toIdx = ids.indexOf(targetId);
    if (toIdx === -1) {
      ids.push(draggedId);
    } else {
      ids.splice(position === 'after' ? toIdx + 1 : toIdx, 0, draggedId);
    }
    setLabelOrder(ids);
    if (labelSortAlpha) setLabelSortAlpha(false);
    cleanup();
  }

  // Shared props for all LabelRow instances
  const dragProps = { dragId, setDragId, dropTarget, setDropTarget, onDrop: handleDrop, onDragCleanup: cleanup };

  if (labels.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.labels.noLabels')}. {t('preferences.labels.noLabelsHint')}
        </p>
      </div>
    );
  }

  return (
    <div
      className="space-y-4"
      onDragOver={(e) => { if (dragId) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
    >
      {/* Sort toggle */}
      <div className="flex items-center justify-between">
        <p className="text-[11px]" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.labels.description')}
        </p>
        <div className="flex items-center gap-2 select-none flex-shrink-0">
          <ToggleSwitch checked={labelSortAlpha} onChange={setLabelSortAlpha} ariaLabel="A→Z" />
          <span className="text-[11px] whitespace-nowrap" style={{ color: 'var(--list-summary)' }}>
            A→Z
          </span>
        </div>
      </div>

      {/* Show article count per label */}
      <div className="flex items-center justify-between select-none">
        <span className="text-[11px]" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.labels.showCounts')}
        </span>
        <ToggleSwitch
          checked={showLabelCounts}
          onChange={(next) => {
            setShowLabelCounts(next);
            if (next) loadLabelCounts();
          }}
          ariaLabel={t('preferences.labels.showCounts')}
        />
      </div>

      {/* Standalone labels — always rendered to prevent layout shift during drag */}
      <div>
        <GroupDropHeader
          label={t('preferences.labels.simpleLabels')}
          groupName=""
          dragId={dragId}
          dropGroupTarget={dropGroupTarget}
          setDropGroupTarget={setDropGroupTarget}
          onGroupDrop={handleGroupDrop}
          getParentOf={getParentOf}
        />
        <div className="space-y-0.5">
          {grouped.filter((i) => i.type === 'single').map((item) => {
            const tag = item.tag!;
            return (
              <LabelRow
                key={tag.id}
                labelId={tag.id}
                name={item.name}
                color={labelColors[tag.id]?.color || ''}
                effectiveColor={getLabelColor(tag.id)}
                onChangeColor={(c) => setLabelColor(tag.id, c)}
                onRemoveColor={() => removeLabelColor(tag.id)}
                onRename={renameLabelWithColor}
                onDelete={deleteLabelWithColor}
                groupNames={groupNames}
                currentParent={null}
                onMoveToParent={(p) => moveLabel(tag.id, p)}
                draggable={!labelSortAlpha}
                {...dragProps}
              />
            );
          })}
        </div>
      </div>

      {/* Groups */}
      {grouped.filter((i) => i.type !== 'single').map((item) => {
        const parentId = item.type === 'parent' && item.tag ? item.tag.id : null;
        const parentEntry = parentId ? labelColors[parentId] : null;
        const parentColor = parentEntry?.color || '';
        const inheritEnabled = parentEntry?.inherit !== false;

        return (
          <div key={item.name}>
            <GroupDropHeader
              label={item.name}
              groupName={item.name}
              dragId={dragId}
              dropGroupTarget={dropGroupTarget}
              setDropGroupTarget={setDropGroupTarget}
              onGroupDrop={handleGroupDrop}
              getParentOf={getParentOf}
            />

            {/* Parent label */}
            {parentId && (
              <div className="space-y-0.5 mb-2">
                <LabelRow
                  labelId={parentId}
                  name={item.name}
                  isParent
                  color={parentColor}
                  effectiveColor={getLabelColor(parentId)}
                  onChangeColor={(c) => setLabelColor(parentId, c)}
                  onRemoveColor={() => removeLabelColor(parentId)}
                  onRename={renameLabelWithColor}
                  onDelete={deleteLabelWithColor}
                  groupNames={groupNames}
                  currentParent={null}
                  onMoveToParent={(p) => moveLabel(parentId, p)}
                  draggable={!labelSortAlpha}
                  {...dragProps}
                />
                {parentColor && (
                  <label className="flex items-center gap-2 pl-8 py-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={inheritEnabled}
                      onChange={() => toggleLabelInherit(parentId)}
                      className="accent-[var(--accent)] w-3.5 h-3.5"
                    />
                    <span className="text-[11px]" style={{ color: 'var(--list-summary)' }}>
                      {t('preferences.labels.applyToSub')}
                    </span>
                  </label>
                )}
              </div>
            )}

            {/* Child labels */}
            <div className="space-y-0.5 pl-3" style={{ borderLeft: `2px solid ${parentColor || 'var(--panel-border)'}` }}>
              {(item.children ?? []).map(({ tag, leafName }) => {
                const childEntry = labelColors[tag.id];
                const hasOwnColor = !!childEntry?.color;
                return (
                  <LabelRow
                    key={tag.id}
                    labelId={tag.id}
                    name={leafName}
                    color={childEntry?.color || ''}
                    effectiveColor={getLabelColor(tag.id)}
                    inherited={!hasOwnColor && inheritEnabled && !!parentColor}
                    onChangeColor={(c) => setLabelColor(tag.id, c)}
                    onRemoveColor={() => removeLabelColor(tag.id)}
                    onRename={renameLabelWithColor}
                    onDelete={deleteLabelWithColor}
                    groupNames={groupNames}
                    currentParent={item.name}
                    onMoveToParent={(p) => moveLabel(tag.id, p)}
                    draggable={!labelSortAlpha}
                    {...dragProps}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Reset label colors */}
      {Object.keys(labelColors).length > 0 && (
        <TabResetButton label={t('preferences.labels.resetColors')} onReset={resetLabelColors} />
      )}
    </div>
  );
}

/**
 * Group header that acts as a drop zone for dragging labels between groups.
 * Highlights with accent color when a label from another group is dragged over.
 */
interface GroupDropHeaderProps {
  label: string;
  groupName: string;
  dragId: string | null;
  dropGroupTarget: string | null;
  setDropGroupTarget: (name: string | null) => void;
  onGroupDrop: (groupName: string) => void;
  getParentOf: (labelId: string) => string | null;
}
function GroupDropHeader({ label, groupName, dragId, dropGroupTarget, setDropGroupTarget, onGroupDrop, getParentOf }: GroupDropHeaderProps) {
  const { t } = useTranslation();
  const isOver = dropGroupTarget === groupName;
  // Only show drop highlight if the dragged label is from a different group
  const isDifferentGroup = dragId && (() => {
    const parent = getParentOf(dragId);
    if (groupName === '') return parent !== null; // highlight standalone only if label has a parent
    return parent !== groupName; // highlight if label is NOT already in this group
  })();
  const showDropZone = dragId && isDifferentGroup;

  return (
    <h3
      className={`text-[11px] font-bold uppercase tracking-widest mb-2 px-2 -mx-2 rounded-md transition-all ${
        isOver && isDifferentGroup ? 'ring-2' : ''
      }`}
      style={{
        color: isOver && isDifferentGroup ? 'var(--accent)' : 'var(--list-summary)',
        background: isOver && isDifferentGroup ? 'var(--accent-glow)' : showDropZone ? 'var(--panel-header-bg)' : 'transparent',
        '--tw-ring-color': 'var(--accent)',
        padding: showDropZone ? '8px 8px' : '6px 8px',
        border: showDropZone && !isOver ? '1px dashed var(--list-summary)' : showDropZone && isOver ? '1px solid var(--accent)' : '1px solid transparent',
      } as CSSProperties}
      onDragOver={(e) => {
        if (!dragId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropGroupTarget(groupName);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          if (dropGroupTarget === groupName) setDropGroupTarget(null);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onGroupDrop(groupName);
      }}
    >
      {label}
      {showDropZone && !isOver && (
        <span className="ml-2 text-[10px] font-normal normal-case tracking-normal opacity-50" style={{ color: 'var(--list-summary)' }}>
          ← {t('preferences.labels.dropHere')}
        </span>
      )}
      {isOver && isDifferentGroup && (
        <span className="ml-2 text-[10px] font-normal normal-case tracking-normal" style={{ color: 'var(--accent)' }}>
          ← {t('preferences.labels.dropHere')}
        </span>
      )}
    </h3>
  );
}

interface LabelRowProps {
  labelId: string;
  name: string;
  color: string;
  effectiveColor: string | null;
  isParent?: boolean;
  inherited?: boolean;
  onChangeColor: (color: string) => void;
  onRemoveColor: () => void;
  onRename: (oldLabelId: string, newName: string) => Promise<boolean>;
  onDelete: (labelId: string) => Promise<boolean>;
  groupNames: string[];
  currentParent: string | null;
  onMoveToParent: (parent: string) => void;
  draggable: boolean;
  dragId: string | null;
  setDragId: (id: string | null) => void;
  dropTarget: DropTarget | null;
  setDropTarget: (t: DropTarget | null) => void;
  onDrop: (draggedId: string, targetId: string, position: DropPosition) => void;
  onDragCleanup: () => void;
}
function LabelRow({
  labelId, name, color, effectiveColor, isParent, inherited,
  onChangeColor, onRemoveColor, onRename, onDelete,
  groupNames, currentParent, onMoveToParent,
  draggable, dragId, setDragId, dropTarget, setDropTarget, onDrop, onDragCleanup,
}: LabelRowProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'rename' | 'confirmDelete' | 'move' | null>(null);
  const [renameValue, setRenameValue] = useState(name);
  const displayColor = color || effectiveColor || 'var(--accent)';
  const isDragging = dragId === labelId;
  const isDropTarget = dropTarget?.id === labelId;

  if (mode === 'rename') {
    return (
      <div className="flex items-center gap-2 py-1 px-2 rounded-md" style={{ background: 'var(--panel-header-bg)' }}>
        <form
          className="flex-1 flex items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (renameValue.trim() && renameValue.trim() !== name) {
              await onRename(labelId, renameValue.trim());
            }
            setMode(null);
          }}
        >
          <input
            autoFocus
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            className="flex-1 text-xs px-2 py-1 rounded border outline-none"
            style={{
              borderColor: 'var(--accent)',
              color: 'var(--list-title)',
              background: 'var(--panel-bg)',
            }}
            onKeyDown={(e) => { if (e.key === 'Escape') setMode(null); }}
          />
          <button
            type="submit"
            className="p-0.5 rounded transition-colors hover:bg-black/5"
            style={{ color: 'var(--accent)' }}
            title={t('preferences.labels.validate')}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setMode(null)}
            className="p-0.5 rounded transition-colors hover:bg-black/5"
            style={{ color: 'var(--list-summary)' }}
            title={t('preferences.labels.cancel')}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </form>
      </div>
    );
  }

  if (mode === 'confirmDelete') {
    return (
      <div className="flex items-center gap-2 py-1.5 px-2 rounded-md" style={{ background: 'var(--panel-header-bg)' }}>
        <span className="text-xs flex-1" style={{ color: 'var(--danger)' }}>
          {t('preferences.labels.confirmDelete', { name })}
        </span>
        <button
          onClick={async () => { await onDelete(labelId); setMode(null); }}
          className="px-2 py-0.5 rounded text-[10px] font-medium text-white"
          style={{ background: 'var(--danger)' }}
        >
          {t('preferences.labels.delete')}
        </button>
        <button
          onClick={() => setMode(null)}
          className="px-2 py-0.5 rounded text-[10px]"
          style={{ color: 'var(--list-summary)' }}
        >
          {t('preferences.labels.cancel')}
        </button>
      </div>
    );
  }

  if (mode === 'move') {
    // Available targets: standalone (empty string) + all group names except current parent
    const targets = [{ value: '', label: t('preferences.labels.noParent') }];
    groupNames.forEach((g) => {
      if (g !== name && g !== currentParent) {
        targets.push({ value: g, label: g });
      }
    });

    return (
      <div className="flex items-center gap-2 py-1.5 px-2 rounded-md" style={{ background: 'var(--panel-header-bg)' }}>
        <span className="text-xs" style={{ color: 'var(--list-summary)' }}>{t('preferences.labels.moveTo')}</span>
        <select
          autoFocus
          className="flex-1 text-xs px-2 py-1 rounded border outline-none"
          style={{
            borderColor: 'var(--accent)',
            color: 'var(--list-title)',
            background: 'var(--panel-bg)',
          }}
          onChange={(e) => {
            onMoveToParent(e.target.value);
            setMode(null);
          }}
          defaultValue="__none__"
        >
          <option disabled value="__none__">{t('preferences.labels.choose')}</option>
          {targets.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <button
          onClick={() => setMode(null)}
          className="p-0.5 rounded transition-colors hover:bg-black/5"
          style={{ color: 'var(--list-summary)' }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  const isDropOnto = isDropTarget && dropTarget.position === 'onto';
  const isDropBefore = isDropTarget && dropTarget.position === 'before';
  const isDropAfter = isDropTarget && dropTarget.position === 'after';

  return (
    <div
      className="relative"
      onDragOver={(e) => {
        if (!dragId || dragId === labelId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const h = rect.height;
        let position: DropPosition;
        if (h > 0 && y < h * 0.25) position = 'before';
        else if (h > 0 && y > h * 0.75) position = 'after';
        else position = 'onto';
        setDropTarget({ id: labelId, position });
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          if (dropTarget?.id === labelId) setDropTarget(null);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dragId && dropTarget) {
          onDrop(dragId, dropTarget.id, dropTarget.position);
        }
      }}
    >
      {/* Drop indicator: line + dot (before/after) */}
      {(isDropBefore || isDropAfter) && (
        <div
          className="absolute left-0 right-0 flex items-center z-10 pointer-events-none"
          style={{ top: isDropBefore ? -1 : undefined, bottom: isDropAfter ? -1 : undefined }}
        >
          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 -ml-1" style={{ background: 'var(--accent)' }} />
          <div className="flex-1 h-[3px] rounded-full" style={{ background: 'var(--accent)' }} />
        </div>
      )}

      {/* Row content */}
      <div
        className={`flex items-center gap-1.5 py-1.5 px-2 rounded-md group transition-all max-md:min-h-[44px] ${
          isDragging ? 'opacity-30 scale-95' : isDropOnto ? 'ring-2' : 'hover:bg-black/[.03]'
        }`}
        style={isDropOnto ? ({
          background: 'var(--accent-glow)',
          '--tw-ring-color': 'var(--accent)',
        } as CSSProperties) : undefined}
        draggable={draggable}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', labelId);
          e.dataTransfer.effectAllowed = 'move';
          setDragId(labelId);
        }}
        onDragEnd={() => { if (onDragCleanup) onDragCleanup(); else { setDragId(null); setDropTarget(null); } }}
      >
        {/* Drag handle */}
        {draggable && (
          <svg className="w-4 h-4 flex-shrink-0 opacity-40 hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity" fill="currentColor" viewBox="0 0 20 20" style={{ color: 'var(--list-summary)' }}>
            <path d="M7 2a2 2 0 10.001 4.001A2 2 0 007 2zm0 6a2 2 0 10.001 4.001A2 2 0 007 8zm0 6a2 2 0 10.001 4.001A2 2 0 007 14zm6-12a2 2 0 10.001 4.001A2 2 0 0013 2zm0 6a2 2 0 10.001 4.001A2 2 0 0013 8zm0 6a2 2 0 10.001 4.001A2 2 0 0013 14z" />
          </svg>
        )}

        {/* Tag icon preview */}
        <svg
          className="w-3.5 h-3.5 flex-shrink-0"
          style={{ color: displayColor, opacity: color ? 1 : 0.5 }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
        </svg>

        {/* Label name */}
        <span
          className={`flex-1 text-xs truncate ${isParent ? 'font-semibold' : ''}`}
          style={{ color: isDropOnto ? 'var(--accent)' : 'var(--reading-text)' }}
        >
          {name}
          {isDropOnto && (
            <span className="ml-1.5 text-[10px] font-normal" style={{ color: 'var(--accent)' }}>
              ← {t('preferences.labels.nestHere')}
            </span>
          )}
          {!isDropOnto && inherited && (
            <span className="ml-1 text-[10px] italic" style={{ color: 'var(--list-summary)' }}>
              ({t('preferences.labels.inherited')})
            </span>
          )}
        </span>

        {/* Actions: move + rename + delete (visible on hover) */}
        <button
          onClick={() => setMode('move')}
          className="p-0.5 rounded transition-colors opacity-0 group-hover:opacity-100 hover:bg-black/5"
          style={{ color: 'var(--list-summary)' }}
          title={t('preferences.labels.moveTooltip')}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
          </svg>
        </button>
        <button
          onClick={() => { setRenameValue(name); setMode('rename'); }}
          className="p-0.5 rounded transition-colors opacity-0 group-hover:opacity-100 hover:bg-black/5"
          style={{ color: 'var(--list-summary)' }}
          title={t('preferences.labels.rename')}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
          </svg>
        </button>
        <button
          onClick={() => setMode('confirmDelete')}
          className="p-0.5 rounded transition-colors opacity-0 group-hover:opacity-100 hover:bg-red-50"
          style={{ color: 'var(--danger, #ef4444)' }}
          title={t('preferences.labels.delete')}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </button>

        {/* Color picker */}
        <LabelColorPicker
          color={color}
          effectiveColor={effectiveColor}
          onChangeColor={onChangeColor}
          onRemoveColor={onRemoveColor}
        />
      </div>
    </div>
  );
}

/* ── Label Color Picker — swatches + hex input ─────────────────────── */
const LABEL_SWATCHES = [
  // Row 1 — reds / pinks
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  // Row 2 — blues / purples
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  // Row 3 — neutrals / earth
  '#78716c', '#737373', '#71717a', '#6b7280',
  '#92400e', '#991b1b', '#1e3a5f', '#064e3b',
];

interface LabelColorPickerProps {
  color: string;
  effectiveColor: string | null;
  onChangeColor: (color: string) => void;
  onRemoveColor: () => void;
}
function LabelColorPicker({ color, effectiveColor, onChangeColor, onRemoveColor }: LabelColorPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(color || effectiveColor || '#4cd4a1');
  const [openUp, setOpenUp] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const displayColor = color || effectiveColor || 'var(--accent)';

  // Sync hex field when color prop changes
  useEffect(() => {
    setHex(color || effectiveColor || '#4cd4a1');
  }, [color, effectiveColor]);

  // Decide popover direction on open
  useEffect(() => {
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUp(spaceBelow < 200);
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (
        popRef.current && !popRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function applyHex(v: string) {
    const clean = v.startsWith('#') ? v : `#${v}`;
    if (/^#[0-9a-fA-F]{6}$/.test(clean)) {
      onChangeColor(clean.toLowerCase());
      setHex(clean.toLowerCase());
    }
  }

  return (
    <div className="relative flex items-center gap-0.5 flex-shrink-0">
      {/* Swatch button to toggle popover */}
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className="w-5 h-5 rounded-md border cursor-pointer transition-transform hover:scale-110 flex-shrink-0"
        style={{
          background: displayColor,
          borderColor: color ? 'rgba(0,0,0,0.15)' : 'var(--panel-border)',
          opacity: color ? 1 : 0.5,
        }}
        title={t('preferences.labels.chooseColor')}
      />

      {/* Remove color button */}
      {color && (
        <button
          onClick={() => { onRemoveColor(); setOpen(false); }}
          className="p-0.5 rounded transition-colors hover:bg-black/10"
          style={{ color: 'var(--list-summary)' }}
          title={t('preferences.labels.removeColor')}
        >
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {/* Popover */}
      {open && (
        <div
          ref={popRef}
          className="fixed z-50 rounded-lg shadow-xl border p-3 w-[220px]"
          style={{
            background: 'var(--panel-bg)',
            borderColor: 'var(--panel-border)',
            ...(btnRef.current ? (() => {
              const r = btnRef.current.getBoundingClientRect();
              return {
                left: Math.max(8, r.right - 220),
                ...(openUp
                  ? { bottom: window.innerHeight - r.top + 4 }
                  : { top: r.bottom + 4 }),
              };
            })() : {}),
          }}
        >
          {/* Swatches grid */}
          <div className="grid grid-cols-8 gap-1 mb-3">
            {LABEL_SWATCHES.map((sw) => (
              <button
                key={sw}
                onClick={() => { onChangeColor(sw); setHex(sw); }}
                className="w-5 h-5 rounded-md border transition-transform hover:scale-125"
                style={{
                  background: sw,
                  borderColor: (color || effectiveColor || '') === sw
                    ? 'var(--list-title)'
                    : 'rgba(0,0,0,0.1)',
                  boxShadow: (color || effectiveColor || '') === sw
                    ? '0 0 0 2px var(--panel-bg), 0 0 0 3px var(--list-title)'
                    : 'none',
                }}
                title={sw}
              />
            ))}
          </div>

          {/* Hex input + native picker */}
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 max-md:w-[44px] max-md:h-[44px] rounded-md border flex-shrink-0 relative overflow-hidden cursor-pointer"
              style={{
                background: color || effectiveColor || '#4cd4a1',
                borderColor: 'rgba(0,0,0,0.1)',
              }}
              onClick={() => pickerRef.current?.click()}
              title={t('preferences.labels.customColor')}
            >
              <input
                ref={pickerRef}
                type="color"
                value={(color || effectiveColor || '#4cd4a1').startsWith('#') ? (color || effectiveColor || '#4cd4a1') : '#4cd4a1'}
                onChange={(e) => { onChangeColor(e.target.value); setHex(e.target.value); }}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
            </div>
            <div className="flex-1 flex items-center rounded-md border overflow-hidden"
              style={{ borderColor: 'var(--panel-border)', background: 'var(--panel-header-bg)' }}
            >
              <span className="pl-2 text-[11px] font-mono" style={{ color: 'var(--list-summary)' }}>#</span>
              <input
                type="text"
                value={hex.replace('#', '')}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
                  setHex(`#${v}`);
                  if (v.length === 6) applyHex(`#${v}`);
                }}
                onBlur={() => applyHex(hex)}
                onKeyDown={(e) => { if (e.key === 'Enter') { applyHex(hex); e.currentTarget.blur(); } }}
                className="flex-1 text-[11px] font-mono px-1 py-1.5 bg-transparent outline-none"
                style={{ color: 'var(--list-title)' }}
                maxLength={6}
                placeholder="4cd4a1"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
