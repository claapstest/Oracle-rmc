import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface ReportSelectorOption {
  id: string;
  name: string;
  domain: string;
  description: string;
  icon: any;
}

interface ReportSelectorDropdownProps {
  options: ReportSelectorOption[];
  /** Ordered domain group labels; options are grouped in this order. */
  domains: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  placeholder?: string;
  labelledBy?: string;
}

/**
 * Enterprise grouped report selector.
 * Groups reports under non-selectable domain headers (DOMAIN -> REPORT).
 * Supports mouse, touch, and keyboard interaction (Enter / Space / Arrow keys / Escape).
 */
export const ReportSelectorDropdown: React.FC<ReportSelectorDropdownProps> = ({
  options,
  domains,
  selectedId,
  onSelect,
  placeholder = 'Select a report',
  labelledBy
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.id === selectedId) || null;

  const grouped = domains
    .map(domain => ({
      domain,
      items: options.filter(o => o.domain === domain)
    }))
    .filter(g => g.items.length > 0);

  const flatItems = grouped.flatMap(g => g.items);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Keep the keyboard-active option visible
  useEffect(() => {
    if (!isOpen || activeIndex < 0 || !menuRef.current) return;
    const el = menuRef.current.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, activeIndex]);

  const openMenu = (indexHint?: number) => {
    const selectedIdx = selectedId ? flatItems.findIndex(i => i.id === selectedId) : -1;
    setActiveIndex(indexHint !== undefined ? indexHint : selectedIdx >= 0 ? selectedIdx : 0);
    setIsOpen(true);
  };

  const chooseOption = (id: string) => {
    setIsOpen(false);
    setActiveIndex(-1);
    onSelect(id);
    triggerRef.current?.focus();
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!isOpen) {
        openMenu();
      } else if (e.key === 'Enter' || e.key === ' ') {
        const current = flatItems[activeIndex];
        if (current) chooseOption(current.id);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        openMenu(flatItems.length - 1);
      }
    } else if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev + 1) % flatItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev - 1 + flatItems.length) % flatItems.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const current = flatItems[activeIndex];
      if (current) chooseOption(current.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'Tab') {
      setIsOpen(false);
    }
  };

  const SelectedIcon = selectedOption?.icon;

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: 1, minWidth: '260px', maxWidth: '520px' }}>
      {labelledBy ? <span id={labelledBy} style={{ display: 'none' }}>{placeholder}</span> : null}
      <button
        ref={triggerRef}
        id="report-selector"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls="report-selector-menu"
        aria-label={selectedOption ? `Selected report: ${selectedOption.name}, ${selectedOption.domain}` : placeholder}
        onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        className="btn btn-secondary"
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          padding: '0.55rem 0.85rem',
          fontSize: '0.88rem',
          borderRadius: '8px',
          backgroundColor: '#FFFFFF',
          textAlign: 'left',
          cursor: 'pointer'
        }}
      >
        {SelectedIcon ? (
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px', borderRadius: '6px', backgroundColor: 'var(--accent-blue-light)', color: 'var(--accent-blue)', flexShrink: 0 }}>
            <SelectedIcon size={15} />
          </span>
        ) : null}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selectedOption ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: selectedOption ? 600 : 400 }}>
          {selectedOption ? (
            <>
              {selectedOption.name}
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {selectedOption.domain}</span>
            </>
          ) : (
            placeholder
          )}
        </span>
        <ChevronDown size={16} style={{ color: 'var(--text-muted)', flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }} />
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          id="report-selector-menu"
          role="listbox"
          aria-label="Available reports grouped by domain"
          onKeyDown={handleMenuKeyDown}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            minWidth: '100%',
            width: 'max-content',
            maxWidth: 'min(430px, calc(100vw - 3rem))',
            maxHeight: '380px',
            overflowY: 'auto',
            backgroundColor: '#FFFFFF',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            boxShadow: '0 12px 32px -6px rgba(15, 23, 42, 0.18), 0 2px 6px -1px rgba(15, 23, 42, 0.06)',
            padding: '0.4rem',
            zIndex: 60
          }}
        >
          {grouped.map((group, gi) => (
            <div key={group.domain}>
              {gi > 0 && <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '0.35rem 0.4rem' }} />}
              <div
                role="presentation"
                aria-hidden="true"
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--text-muted)',
                  padding: '0.45rem 0.65rem 0.25rem 0.65rem',
                  userSelect: 'none'
                }}
              >
                {group.domain}
              </div>
              {group.items.map(item => {
                const globalIndex = flatItems.findIndex(i => i.id === item.id);
                const ItemIcon = item.icon;
                const isSelected = item.id === selectedId;
                const isActive = globalIndex === activeIndex;
                return (
                  <div
                    key={item.id}
                    id={`report-option-${item.id}`}
                    role="option"
                    aria-selected={isSelected}
                    data-option-index={globalIndex}
                    onClick={() => chooseOption(item.id)}
                    onMouseEnter={() => setActiveIndex(globalIndex)}
                    title={item.description}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.65rem',
                      padding: '0.5rem 0.65rem',
                      borderRadius: '7px',
                      cursor: 'pointer',
                      backgroundColor: isActive ? '#F1F5F9' : isSelected ? 'var(--accent-blue-light)' : 'transparent'
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '7px', backgroundColor: isSelected ? 'var(--accent-blue)' : 'var(--accent-blue-light)', color: isSelected ? '#ffffff' : 'var(--accent-blue)', flexShrink: 0 }}>
                      {ItemIcon ? <ItemIcon size={15} /> : null}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.name}
                    </span>
                    {isSelected && <Check size={15} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
