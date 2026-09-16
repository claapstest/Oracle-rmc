export function classifyRoleRecord(res: any): 'Job' | 'Duty' | 'Data' | 'Abstract' | 'GRC' | 'Other' {
  const cat = (res.category || '').toUpperCase();
  const name = (res.name || res.roleCode || res.value || '').toUpperCase();
  const displayName = (res.displayName || res.roleName || '').toUpperCase();

  // 1. GRC roles
  if (name.startsWith('ORA_GTG_') || name.startsWith('ORA_GTR_') || name.startsWith('CLAAPS_GTG_') || cat === 'GRC') {
    return 'GRC';
  }

  // 2. Duty roles (Must be evaluated BEFORE checking cat === 'JOB' or cat === 'ABSTRACT' because Oracle SCIM tags Duty roles as JOB or ABSTRACT)
  if (
    cat === 'DUTY' ||
    name.endsWith('_DUTY') ||
    name.includes('_DUTY_') ||
    name.endsWith(' DUTY') ||
    name.includes(' DUTY ') ||
    displayName.endsWith(' DUTY') ||
    displayName.includes(' DUTY ') ||
    displayName.endsWith(' DUTYCOPY') ||
    displayName.includes(' DUTYCOPY') ||
    name.endsWith('_DY') ||
    name.includes('_DY_')
  ) {
    return 'Duty';
  }

  // 3. Abstract roles
  if (cat === 'ABSTRACT' || name.endsWith('_ABSTRACT') || name.includes('_ABSTRACT_')) {
    return 'Abstract';
  }

  // 4. Data roles (including Oracle Fusion data security roles with ledger/org extensions)
  if (
    cat === 'DATA' ||
    name.endsWith('_DATA') ||
    name.includes('_DATA_') ||
    name.endsWith('_DF') ||
    (cat === 'NONE' && (name.includes(' LEDGER') || name.includes(' ORG') || (res.description && res.description.includes('Data Access Set'))))
  ) {
    return 'Data';
  }

  // 5. Job roles
  if (cat === 'JOB' || name.endsWith('_JOB') || name.includes('_JOB_')) {
    return 'Job';
  }

  return 'Other';
}
