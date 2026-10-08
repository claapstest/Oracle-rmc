import React from 'react';
import AppUsersList from '../components/AppUsersList';

interface UserManagementProps {
  hasAccess?: (pageId: string) => boolean;
  onInvestigateUser?: (userId: string, displayName: string) => void;
}

export default function UserManagement({ hasAccess, onInvestigateUser }: UserManagementProps) {
  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', width: '100%', margin: '0 auto' }}>
      <AppUsersList hasAccess={hasAccess} onInvestigateUser={onInvestigateUser} />
    </div>
  );
}
