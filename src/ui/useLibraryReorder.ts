import { useI18n } from './i18n.js';
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type PointerEvent } from 'react';
import './library-reorder.css';

/** Shared mouse drag and keyboard ordering for root library rows only. */
export function useLibraryReorder(ids: string[], disabled: boolean, onReorder: (ids: string[]) => Promise<unknown>) {
  const { t } = useI18n();
  const group = useId();
  const pointer = useRef<{ id: string; x: number; y: number; moving: boolean }>();
  const suppressClick = useRef(false);
  const committing = useRef(false);
  const [dragId, setDragId] = useState<string>();
  const [drop, setDrop] = useState<{ id: string; after: boolean }>();
  const [announcement, setAnnouncement] = useState('');
  const clear = () => { pointer.current = undefined; setDragId(undefined); setDrop(undefined); };
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !pointer.current) return;
      // Cancelling a drag must not also close its surrounding employee dialog.
      event.preventDefault(); event.stopPropagation(); suppressClick.current = true; clear();
    };
    document.addEventListener('keydown', cancel, true);
    return () => document.removeEventListener('keydown', cancel, true);
  }, []);
  useEffect(() => { if (disabled) clear(); }, [disabled]);
  const destination = (x: number, y: number) => {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-library-order-id]');
    if (row?.dataset.libraryOrderGroup !== group || !ids.includes(row.dataset.libraryOrderId!)) return;
    const box = row.getBoundingClientRect();
    return { id: row.dataset.libraryOrderId!, after: y > box.top + box.height / 2 };
  };
  async function commit(next: string[], focusId: string) {
    if (disabled || committing.current || next.every((id, index) => id === ids[index])) return;
    committing.current = true;
    try { const result = await onReorder(next); setAnnouncement(result === false ? "排序未保存，请查看错误提示后重试。" : "排序已保存，使用 Alt 加上下方向键继续调整。"); }
    catch { setAnnouncement("排序未保存，请查看错误提示后重试。"); }
    finally { committing.current = false; requestAnimationFrame(() => { const row = [...document.querySelectorAll<HTMLButtonElement>('[data-library-order-id]')].find(row => row.dataset.libraryOrderGroup === group && row.dataset.libraryOrderId === focusId); row?.focus({ preventScroll: true }); }); }
  }
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const source = pointer.current;
    if (!source || disabled) return;
    if (!source.moving && Math.hypot(event.clientX - source.x, event.clientY - source.y) < 5) return;
    source.moving = true; suppressClick.current = true; setDragId(source.id);
    const sidebar = event.currentTarget.closest<HTMLElement>('.wf-sidebar');
    if (sidebar) { const bounds = sidebar.getBoundingClientRect(); if (event.clientY < bounds.top + 30) sidebar.scrollTop -= 12; else if (event.clientY > bounds.bottom - 30) sidebar.scrollTop += 12; }
    setDrop(destination(event.clientX, event.clientY));
  };
  function rowProps(id: string): ButtonHTMLAttributes<HTMLButtonElement> & { 'data-library-order-id': string; 'data-library-order-group': string; 'data-library-movable': boolean } {
    return {
      'data-library-order-id': id, 'data-library-order-group': group, 'data-library-movable': !disabled && ids.length > 1,
      'aria-keyshortcuts': 'Alt+ArrowUp Alt+ArrowDown',
      'aria-description': t("按住鼠标上下拖拽排序；也可按 Alt 加上下方向键。"),
      className: `${dragId === id ? ' wf-library-order-dragging' : ''}${drop?.id === id && dragId !== id ? ` wf-library-order-${drop.after ? 'after' : 'before'}` : ''}`,
      onPointerDown: event => {
        suppressClick.current = false;
        if (disabled || ids.length < 2 || event.button !== 0 || event.pointerType === 'touch') return;
        pointer.current = { id, x: event.clientX, y: event.clientY, moving: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: move,
      onPointerUp: event => {
        const source = pointer.current, target = source?.moving ? destination(event.clientX, event.clientY) : undefined;
        clear();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (!source || !target || source.id === target.id || disabled) return;
        const next = ids.filter(item => item !== source.id); next.splice(next.indexOf(target.id) + (target.after ? 1 : 0), 0, source.id);
        void commit(next, source.id);
      },
      onPointerCancel: clear, onLostPointerCapture: clear,
      onClickCapture: event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } },
      onKeyDown: event => {
        if (disabled || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); const from = ids.indexOf(id), to = from + (event.key === 'ArrowUp' ? -1 : 1);
        if (from < 0 || to < 0 || to >= ids.length) return;
        const next = [...ids]; [next[from], next[to]] = [next[to]!, next[from]!]; void commit(next, id);
      },
    };
  }
  return { rowProps, announcement: t(announcement) };
}
