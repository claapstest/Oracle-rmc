import React, { useEffect, useState } from 'react';
import {
  Bookmark,
  Check,
  Filter,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';

export interface IncidentFilterValues {
  statuses: string[];
  states: string[];
  search: string;
  globalUser: string;
  role: string;
  accessEntitlement: string;
  accessPointName: string;
  accessPointType: string;
  priority: string;
  groupingValue: string;
  group: string;
  dataSource: string;
  incidentInformation: string;
  createdBy: string;
  investigator: string;
  lastUpdatedBy: string;
}

export interface IncidentFacetOptions {
  createdBy: string[];
  investigator: string[];
  lastUpdatedBy: string[];
  states: string[];
  accessPointTypes: string[];
  dataSources: string[];
  groups: string[];
  priorities: string[];
}

export const EMPTY_INCIDENT_FILTERS: IncidentFilterValues = {
  statuses: [],
  states: [],
  search: '',
  globalUser: '',
  role: '',
  accessEntitlement: '',
  accessPointName: '',
  accessPointType: '',
  priority: '',
  groupingValue: '',
  group: '',
  dataSource: '',
  incidentInformation: '',
  createdBy: '',
  investigator: '',
  lastUpdatedBy: '',
};

export interface SavedIncidentSearch {
  id: string;
  name: string;
  builtIn?: boolean;
  filters: IncidentFilterValues;
}

export const BUILT_IN_SAVED_SEARCHES: SavedIncidentSearch[] = [
  {
    id: 'all',
    name: 'All Results',
    builtIn: true,
    filters: { ...EMPTY_INCIDENT_FILTERS },
  },
  {
    id: 'pending',
    name: 'Pending Results (Assigned + Remediate)',
    builtIn: true,
    filters: {
      ...EMPTY_INCIDENT_FILTERS,
      statuses: ['ASSIGNED', 'REMEDIATE'],
      states: ['IN_INVESTIGATION'],
    },
  },
  {
    id: 'accepted',
    name: 'Accepted Exceptions',
    builtIn: true,
    filters: {
      ...EMPTY_INCIDENT_FILTERS,
      statuses: ['ACCEPTED'],
    },
  },
  {
    id: 'resolved',
    name: 'Resolved / Closed',
    builtIn: true,
    filters: {
      ...EMPTY_INCIDENT_FILTERS,
      statuses: ['RESOLVED'],
    },
  },
];

const STATUS_OPTIONS = [
  { key: 'ASSIGNED', label: 'Assigned', color: '#3B82F6' },
  { key: 'REMEDIATE', label: 'Remediate', color: '#F59E0B' },
  { key: 'ACCEPTED', label: 'Accepted', color: '#8B5CF6' },
  { key: 'RESOLVED', label: 'Resolved', color: '#10B981' },
];

const DEFAULT_STATES = [
  { value: 'IN_INVESTIGATION', label: 'In Investigation' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'CLOSED', label: 'Closed' },
];

export function countActiveIncidentFilters(f: IncidentFilterValues): number {
  let count = 0;
  if (f.statuses.length > 0) count += f.statuses.length;
  if (f.states.length > 0) count += f.states.length;
  const textKeys: (keyof IncidentFilterValues)[] = [
    'search',
    'globalUser',
    'role',
    'accessEntitlement',
    'accessPointName',
    'accessPointType',
    'priority',
    'groupingValue',
    'group',
    'dataSource',
    'incidentInformation',
    'createdBy',
    'investigator',
    'lastUpdatedBy',
  ];
  for (const k of textKeys) {
    const val = f[k];
    if (typeof val === 'string' && val.trim()) count++;
  }
  return count;
}

export interface ActiveFilterChip {
  key: keyof IncidentFilterValues | 'statuses' | 'states';
  label: string;
  valueLabel: string;
  rawValue?: string;
}

export function getActiveFilterChips(f: IncidentFilterValues): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];
  if (f.statuses.length > 0) {
    chips.push({
      key: 'statuses',
      label: 'Status',
      valueLabel: f.statuses
        .map(s => STATUS_OPTIONS.find(o => o.key === s)?.label || s)
        .join('; '),
    });
  }
  if (f.states.length > 0) {
    chips.push({
      key: 'states',
      label: 'State',
      valueLabel: f.states
        .map(s => DEFAULT_STATES.find(o => o.value === s)?.label || s)
        .join(', '),
    });
  }
  const labels: Array<[keyof IncidentFilterValues, string]> = [
    ['search', 'Search'],
    ['accessEntitlement', 'Access Entitlement'],
    ['globalUser', 'Global User'],
    ['role', 'Role'],
    ['accessPointName', 'Access Point'],
    ['accessPointType', 'Access Point Type'],
    ['priority', 'Priority'],
    ['groupingValue', 'Grouping Value'],
    ['group', 'Group'],
    ['dataSource', 'Data Source'],
    ['incidentInformation', 'Incident Info'],
    ['createdBy', 'Created By'],
    ['investigator', 'Investigator'],
    ['lastUpdatedBy', 'Last Updated By'],
  ];
  for (const [k, label] of labels) {
    const val = f[k];
    if (typeof val === 'string' && val.trim()) {
      chips.push({ key: k, label, valueLabel: val.trim() });
    }
  }
  return chips;
}

interface IncidentFilterPanelProps {
  isTxControl: boolean;
  draftFilters: IncidentFilterValues;
  appliedFilters: IncidentFilterValues;
  facets: IncidentFacetOptions;
  facetsLoading?: boolean;
  activeSavedSearchId: string;
  preFilterPage?: number | null;
  loading?: boolean;
  onChangeDraft: (next: IncidentFilterValues) => void;
  onSelectSavedSearch: (presetId: string, filters: IncidentFilterValues) => void;
  onApply: (filtersToApply: IncidentFilterValues) => void;
  onRemoveAll: () => void;
  onClose: () => void;
}

export const IncidentFilterPanel: React.FC<IncidentFilterPanelProps> = ({
  isTxControl,
  draftFilters,
  appliedFilters,
  facets,
  facetsLoading = false,
  activeSavedSearchId,
  preFilterPage,
  loading = false,
  onChangeDraft,
  onSelectSavedSearch,
  onApply,
  onRemoveAll,
  onClose,
}) => {
  const storageKey = `veyra_incident_saved_searches_v1_${isTxControl ? 'tx' : 'access'}`;
  const [customSearches, setCustomSearches] = useState<SavedIncidentSearch[]>([]);
  const [isSavingNew, setIsSavingNew] = useState(false);
  const [newSearchName, setNewSearchName] = useState('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setCustomSearches(parsed);
      } else {
        setCustomSearches([]);
      }
    } catch {
      setCustomSearches([]);
    }
  }, [storageKey]);

  const allSavedSearches = [...BUILT_IN_SAVED_SEARCHES, ...customSearches];
  const appliedCount = countActiveIncidentFilters(appliedFilters);
  const draftCount = countActiveIncidentFilters(draftFilters);

  const toggleStatus = (key: string) => {
    const exists = draftFilters.statuses.includes(key);
    const nextStatuses = exists
      ? draftFilters.statuses.filter(s => s !== key)
      : [...draftFilters.statuses, key];
    onChangeDraft({ ...draftFilters, statuses: nextStatuses });
  };

  const setField = (key: keyof IncidentFilterValues, value: string) => {
    onChangeDraft({ ...draftFilters, [key]: value });
  };

  const handleSavePreset = () => {
    const trimmed = newSearchName.trim();
    if (!trimmed) return;
    const newItem: SavedIncidentSearch = {
      id: `custom-${Date.now()}`,
      name: trimmed,
      filters: { ...draftFilters },
    };
    const next = [...customSearches, newItem];
    setCustomSearches(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore quota errors */
    }
    setNewSearchName('');
    setIsSavingNew(false);
    onSelectSavedSearch(newItem.id, newItem.filters);
  };

  const handleDeleteCustomSearch = (id: string) => {
    const next = customSearches.filter(s => s.id !== id);
    setCustomSearches(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    if (activeSavedSearchId === id) {
      onSelectSavedSearch('all', { ...EMPTY_INCIDENT_FILTERS });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onApply(draftFilters);
    }
  };

  // Merge built-in state options with any extra DB states
  const mergedStateOptions = (() => {
    const map = new Map<string, string>();
    for (const s of DEFAULT_STATES) map.set(s.value, s.label);
    for (const raw of facets.states || []) {
      const upper = raw.toUpperCase();
      if (!map.has(upper) && !Array.from(map.keys()).some(k => upper.includes(k.replace('_', ' ')))) {
        map.set(raw, raw);
      }
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  })();

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.74rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: '0.3rem',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    fontSize: '0.8rem',
    padding: '0.4rem 0.6rem',
  };

  return (
    <aside
      aria-label="Incident Search and Filters"
      style={{
        width: '295px',
        flexShrink: 0,
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: '10px',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'calc(100vh - 180px)',
        position: 'sticky',
        top: '1rem',
        overflow: 'hidden',
        boxShadow: '0 4px 16px rgba(15, 23, 42, 0.08)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '0.8rem 0.95rem',
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.4rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <Filter size={15} style={{ color: 'var(--accent-blue)' }} />
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-header)' }}>
            Filters
          </span>
          {appliedCount > 0 && (
            <span
              className="badge"
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                backgroundColor: 'rgba(59, 130, 246, 0.14)',
                color: 'var(--accent-blue)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
              }}
            >
              {appliedCount} active
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {(appliedCount > 0 || draftCount > 0) && (
            <button
              type="button"
              onClick={onRemoveAll}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-blue)',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                padding: '0.15rem 0.25rem',
              }}
              title={preFilterPage ? `Reset all filters and return to Page ${preFilterPage}` : 'Reset all filters'}
            >
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsSavingNew(prev => !prev)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              padding: '0.15rem 0.25rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.2rem',
            }}
            title="Save current filter criteria as a reusable view"
          >
            <Save size={12} />
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '0.15rem',
              display: 'inline-flex',
              alignItems: 'center',
            }}
            title="Close Filter Panel & restore navigation sidebar"
            aria-label="Close Filter Panel"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Inline Save View Prompt */}
      {isSavingNew && (
        <div
          style={{
            padding: '0.65rem 0.95rem',
            borderBottom: '1px solid var(--border-color)',
            backgroundColor: 'rgba(59, 130, 246, 0.06)',
            display: 'flex',
            gap: '0.4rem',
            alignItems: 'center',
          }}
        >
          <input
            type="text"
            className="form-input"
            placeholder="Saved search name..."
            value={newSearchName}
            onChange={e => setNewSearchName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSavePreset();
              }
            }}
            style={{ flex: 1, fontSize: '0.78rem', padding: '0.3rem 0.5rem' }}
            autoFocus
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSavePreset}
            disabled={!newSearchName.trim()}
            style={{ fontSize: '0.74rem', padding: '0.32rem 0.6rem' }}
          >
            Save
          </button>
        </div>
      )}

      {/* Scrollable Filter Fields */}
      <div
        style={{
          padding: '0.85rem 0.95rem',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.8rem',
          flex: 1,
        }}
      >
        {/* Saved Search */}
        <div>
          <label htmlFor="incident-saved-search" style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Bookmark size={12} style={{ color: 'var(--accent-blue)' }} />
            Saved Search
          </label>
          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
            <select
              id="incident-saved-search"
              className="form-select"
              value={activeSavedSearchId}
              onChange={e => {
                const id = e.target.value;
                const found = allSavedSearches.find(s => s.id === id);
                if (found) {
                  onSelectSavedSearch(found.id, { ...found.filters });
                  if (found.id === 'all') {
                    onRemoveAll();
                  } else {
                    onApply({ ...found.filters });
                  }
                }
              }}
              style={inputStyle}
            >
              {allSavedSearches.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              {activeSavedSearchId === 'custom-unsaved' && (
                <option value="custom-unsaved">Custom Filter</option>
              )}
            </select>
            {customSearches.some(s => s.id === activeSavedSearchId) && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => handleDeleteCustomSearch(activeSavedSearchId)}
                style={{ padding: '0.38rem', color: 'var(--accent-red)' }}
                title="Delete saved search"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '0.1rem 0' }} />

        {/* Quick Search */}
        <div>
          <label htmlFor="filter-quick-search" style={labelStyle}>
            Quick Search (Result ID / Keyword)
          </label>
          <input
            id="filter-quick-search"
            type="text"
            className="form-input"
            placeholder={isTxControl ? 'Result ID, Grouping Value, Group...' : 'Result ID, User, Role...'}
            value={draftFilters.search}
            onChange={e => setField('search', e.target.value)}
            onKeyDown={handleKeyDown}
            style={inputStyle}
          />
        </div>

        {/* Status (Multi-Select Checkboxes like Oracle Assigned;Remediate) */}
        <div>
          <span style={labelStyle}>Status (Multi-select)</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
            {STATUS_OPTIONS.map(opt => {
              const checked = draftFilters.statuses.includes(opt.key);
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => toggleStatus(opt.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.35rem 0.5rem',
                    borderRadius: '6px',
                    fontSize: '0.76rem',
                    fontWeight: checked ? 700 : 500,
                    cursor: 'pointer',
                    border: checked ? `1px solid ${opt.color}` : '1px solid var(--border-color)',
                    backgroundColor: checked ? `${opt.color}18` : 'var(--bg-primary)',
                    color: checked ? opt.color : 'var(--text-secondary)',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      width: '13px',
                      height: '13px',
                      borderRadius: '3px',
                      border: `1.5px solid ${checked ? opt.color : 'var(--text-muted)'}`,
                      backgroundColor: checked ? opt.color : 'transparent',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      color: '#fff',
                    }}
                  >
                    {checked && <Check size={9} strokeWidth={3} />}
                  </span>
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* State */}
        <div>
          <label htmlFor="filter-state" style={labelStyle}>State</label>
          <select
            id="filter-state"
            className="form-select"
            value={draftFilters.states[0] || 'ALL'}
            onChange={e => {
              const val = e.target.value;
              onChangeDraft({ ...draftFilters, states: val === 'ALL' ? [] : [val] });
            }}
            style={inputStyle}
          >
            <option value="ALL">All States</option>
            {mergedStateOptions.map(st => (
              <option key={st.value} value={st.value}>{st.label}</option>
            ))}
          </select>
        </div>

        {/* Domain-Adaptive Fields: Access vs Transaction */}
        {!isTxControl ? (
          <>
            <div>
              <label htmlFor="filter-access-entitlement" style={labelStyle}>Access Entitlement</label>
              <input
                id="filter-access-entitlement"
                type="text"
                className="form-input"
                placeholder="Contains entitlement..."
                value={draftFilters.accessEntitlement}
                onChange={e => setField('accessEntitlement', e.target.value)}
                onKeyDown={handleKeyDown}
                style={inputStyle}
              />
            </div>

            <div>
              <label htmlFor="filter-global-user" style={labelStyle}>Global User</label>
              <input
                id="filter-global-user"
                type="text"
                className="form-input"
                placeholder="Username or name..."
                value={draftFilters.globalUser}
                onChange={e => setField('globalUser', e.target.value)}
                onKeyDown={handleKeyDown}
                style={inputStyle}
              />
            </div>

            <div>
              <label htmlFor="filter-role" style={labelStyle}>Role</label>
              <input
                id="filter-role"
                type="text"
                className="form-input"
                placeholder="Role name..."
                value={draftFilters.role}
                onChange={e => setField('role', e.target.value)}
                onKeyDown={handleKeyDown}
                style={inputStyle}
              />
            </div>

            <div>
              <label htmlFor="filter-access-point" style={labelStyle}>Access Point</label>
              <input
                id="filter-access-point"
                type="text"
                className="form-input"
                placeholder="Privilege or role point..."
                value={draftFilters.accessPointName}
                onChange={e => setField('accessPointName', e.target.value)}
                onKeyDown={handleKeyDown}
                style={inputStyle}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div>
                <label htmlFor="filter-ap-type" style={labelStyle}>Point Type</label>
                <select
                  id="filter-ap-type"
                  className="form-select"
                  value={draftFilters.accessPointType || 'ALL'}
                  onChange={e => setField('accessPointType', e.target.value === 'ALL' ? '' : e.target.value)}
                  style={inputStyle}
                >
                  <option value="ALL">All</option>
                  {(facets.accessPointTypes.length > 0 ? facets.accessPointTypes : ['Privilege', 'Role']).map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="filter-priority" style={labelStyle}>Priority</label>
                <select
                  id="filter-priority"
                  className="form-select"
                  value={draftFilters.priority || 'ALL'}
                  onChange={e => setField('priority', e.target.value === 'ALL' ? '' : e.target.value)}
                  style={inputStyle}
                >
                  <option value="ALL">All</option>
                  {(facets.priorities.length > 0 ? facets.priorities : ['1', '2', '3']).map(pr => (
                    <option key={pr} value={pr}>{pr}</option>
                  ))}
                </select>
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <label htmlFor="filter-grouping-value" style={labelStyle}>Grouping Value</label>
              <input
                id="filter-grouping-value"
                type="text"
                className="form-input"
                placeholder="Contains grouping value..."
                value={draftFilters.groupingValue}
                onChange={e => setField('groupingValue', e.target.value)}
                onKeyDown={handleKeyDown}
                style={inputStyle}
              />
            </div>

            <div>
              <label htmlFor="filter-tx-group" style={labelStyle}>Group</label>
              <input
                id="filter-tx-group"
                type="text"
                list="tx-incident-group-options"
                className="form-input"
                placeholder="Contains or select group..."
                value={draftFilters.group}
                onChange={e => setField('group', e.target.value)}
                onKeyDown={handleKeyDown}
                style={inputStyle}
              />
              {facets.groups.length > 0 && (
                <datalist id="tx-incident-group-options">
                  {facets.groups.map(g => <option key={g} value={g} />)}
                </datalist>
              )}
            </div>

            <div>
              <label htmlFor="filter-data-source" style={labelStyle}>Data Source</label>
              <select
                id="filter-data-source"
                className="form-select"
                value={draftFilters.dataSource || 'ALL'}
                onChange={e => setField('dataSource', e.target.value === 'ALL' ? '' : e.target.value)}
                style={inputStyle}
              >
                <option value="ALL">All Data Sources</option>
                {(facets.dataSources.length > 0 ? facets.dataSources : ['Oracle Cloud']).map(ds => (
                  <option key={ds} value={ds}>{ds}</option>
                ))}
              </select>
            </div>
          </>
        )}

        {/* Common Detail & Audit Fields */}
        <div>
          <label htmlFor="filter-incident-info" style={labelStyle}>Incident Information</label>
          <input
            id="filter-incident-info"
            type="text"
            className="form-input"
            placeholder="Contains incident text..."
            value={draftFilters.incidentInformation}
            onChange={e => setField('incidentInformation', e.target.value)}
            onKeyDown={handleKeyDown}
            style={inputStyle}
          />
        </div>

        <div>
          <label htmlFor="filter-created-by" style={labelStyle}>
            Created By {facetsLoading ? '...' : ''}
          </label>
          <select
            id="filter-created-by"
            className="form-select"
            value={draftFilters.createdBy || 'ALL'}
            onChange={e => setField('createdBy', e.target.value === 'ALL' ? '' : e.target.value)}
            style={inputStyle}
          >
            <option value="ALL">All Creators</option>
            {facets.createdBy.map(u => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="filter-investigator" style={labelStyle}>
            Investigator {facetsLoading ? '...' : ''}
          </label>
          <select
            id="filter-investigator"
            className="form-select"
            value={draftFilters.investigator || 'ALL'}
            onChange={e => setField('investigator', e.target.value === 'ALL' ? '' : e.target.value)}
            style={inputStyle}
          >
            <option value="ALL">All Investigators</option>
            {facets.investigator.map(u => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="filter-last-updated-by" style={labelStyle}>
            Last Updated By {facetsLoading ? '...' : ''}
          </label>
          <select
            id="filter-last-updated-by"
            className="form-select"
            value={draftFilters.lastUpdatedBy || 'ALL'}
            onChange={e => setField('lastUpdatedBy', e.target.value === 'ALL' ? '' : e.target.value)}
            style={inputStyle}
          >
            <option value="ALL">All Updaters</option>
            {facets.lastUpdatedBy.map(u => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Footer Actions */}
      <div
        style={{
          padding: '0.75rem 0.95rem',
          borderTop: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.45rem',
        }}
      >
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onApply(draftFilters)}
          disabled={loading}
          style={{
            width: '100%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.4rem',
            fontSize: '0.84rem',
            fontWeight: 700,
            padding: '0.5rem 0.85rem',
          }}
        >
          <Search size={14} />
          <span>{loading ? 'Searching...' : 'Search'}</span>
        </button>

        {appliedCount > 0 && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onRemoveAll}
            disabled={loading}
            style={{
              width: '100%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.35rem',
              fontSize: '0.78rem',
              padding: '0.4rem 0.75rem',
              color: 'var(--accent-red)',
            }}
            title={preFilterPage ? `Remove all filters and return to Page ${preFilterPage}` : 'Remove all filters'}
          >
            <RotateCcw size={13} />
            <span>
              Remove Filters{preFilterPage ? ` (Back to Page ${preFilterPage})` : ''}
            </span>
          </button>
        )}
      </div>
    </aside>
  );
};

