import React from 'react';

export interface TableLoadingStateProps {
  title?: string;
  subtitle?: string;
  colSpan?: number;
  skeletonRows?: number;
  minHeight?: string;
}

export const TableLoadingState: React.FC<TableLoadingStateProps> = ({
  title = 'Loading records from Oracle Fusion...',
  subtitle = 'Retrieving live data, please wait',
  colSpan = 8,
  skeletonRows = 3,
  minHeight = '280px'
}) => {
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: '2rem 1rem', textAlign: 'center' }}>
        <ContentLoadingState
          title={title}
          subtitle={subtitle}
          minHeight={minHeight}
          showSkeleton={skeletonRows > 0}
          skeletonRows={skeletonRows}
        />
      </td>
    </tr>
  );
};

export interface ContentLoadingStateProps {
  title?: string;
  subtitle?: string;
  minHeight?: string;
  showSkeleton?: boolean;
  skeletonRows?: number;
}

export const ContentLoadingState: React.FC<ContentLoadingStateProps> = ({
  title = 'Loading records from Oracle Fusion...',
  subtitle = 'Retrieving live data, please wait',
  minHeight,
  showSkeleton = false,
  skeletonRows = 3
}) => {
  return (
    <div
      className="real-loading-container animate-fade-in"
      style={{ minHeight: minHeight || 'auto' }}
      role="status"
      aria-live="polite"
    >
      {/* Real Multi-Ring Orbital Animated Spinner */}
      <div className="real-loading-spinner-wrapper">
        <div className="real-loading-outer-ring" />
        <div className="real-loading-inner-ring" />
        <div className="real-loading-core" />
      </div>

      {/* Dynamic Animated Status Title & Subtitle */}
      <div className="real-loading-title">
        <span>{title}</span>
      </div>

      <div className="real-loading-subtitle">
        <span>{subtitle}</span>
        <span className="real-loading-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>

      {/* Optional Shimmering Table Skeleton Bars */}
      {showSkeleton && (
        <div className="real-table-skeleton-rows">
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <div key={i} className="real-table-skeleton-row">
              <div className="real-skeleton-bar" style={{ width: '40px', flexShrink: 0 }} />
              <div
                className="real-skeleton-bar"
                style={{ width: i % 2 === 0 ? '42%' : '35%', minWidth: '120px' }}
              />
              <div className="real-skeleton-bar" style={{ width: '18%', minWidth: '70px' }} />
              <div className="real-skeleton-bar" style={{ width: '14%', minWidth: '60px' }} />
              <div className="real-skeleton-bar" style={{ width: '16%', minWidth: '60px', marginLeft: 'auto' }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
