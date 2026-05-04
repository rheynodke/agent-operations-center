import { useEffect, useRef } from 'react';

export function useAutoScroll<T extends HTMLElement>(dependencies: React.DependencyList) {
  const scrollRef = useRef<T>(null);
  const isAtBottom = useRef(true);
  const initialScrollDone = useRef(false);

  // Track if user is at the bottom
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      const threshold = 150; // px
      const position = container.scrollTop + container.clientHeight;
      isAtBottom.current = container.scrollHeight - position <= threshold;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    // Run once on mount to set initial state
    handleScroll();
    
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto scroll when dependencies change
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    if (!initialScrollDone.current) {
      initialScrollDone.current = true;
      // Instant scroll on first load
      container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
      return;
    }

    if (isAtBottom.current) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, dependencies);

  return scrollRef;
}
