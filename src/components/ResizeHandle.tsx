import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

interface ResizeHandleProps {
  onResize: (delta: number) => void;
}

export default function ResizeHandle({ onResize }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);

  const onMouseDown = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
    startX.current = e.clientX;
  }, []);

  useEffect(() => {
    if (!dragging) return;

    function onMouseMove(e: MouseEvent) {
      const delta = e.clientX - startX.current;
      startX.current = e.clientX;
      onResize(delta);
    }

    function onMouseUp() {
      setDragging(false);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging, onResize]);

  return (
    <div
      className={`resize-handle ${dragging ? 'active' : ''}`}
      onMouseDown={onMouseDown}
    />
  );
}
