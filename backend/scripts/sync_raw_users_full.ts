/**
 * Full Oracle Fusion -> PostgreSQL user directory sync.
 *
 * Why this exists: the runtime API path (oracleService.getUsers) pages SCIM in
 * batches of 100, and Oracle's ASE SCIM rejects startIndex > 3000 for that page
 * size (ASE_SCIM_UNSUPPORTED_START_IDX). That caps the directory at 3000 of 3044
 * users. Requesting 500 per page lifts the cap and the whole directory syncs.
 *
 * Mapping and persistence are identical to the live API path, so the rows written
 * here are indistinguishable from rows written by the running server.
 *
 * Usage: npx tsx scripts/sync_raw_users_full.ts
 */

import { OracleFusionClient } from '../src/oracle/client.js';
import { userRoleRawDbService } from '../src/services/userRoleRawDbService.js';
import { userAccessReportService } from '../src/services/userAccessReportService.js';
import { extractUserCategory } from '../src/services/oracleService.js';
import { classifyRoleRecord } from '../src/services/roleClassification.js';
import { mockRoles } from '../src/services/mockData.js';

const PAGE_SIZE = 500;

function normalizeAssignedRoles(rolesList: any[] | undefined): any[] {
  if (!rolesList) return [];
  const seenCodes = new Set<string>();
  const normalized: any[] = [];

  for (const r of rolesList) {
    let code = '';
    let name = '';
    let isCustom = false;

    if (typeof r === 'string') {
      const resolved = mockRoles.find((x: any) => x.roleCode === r || x.displayName === r);
      code = resolved ? resolved.roleCode : r;
      name = resolved ? resolved.displayName : r;
      isCustom = r.startsWith('CLAAPS_') || r.startsWith('CUSTOM_');
    } else {
      code = r.value || r.roleCode || '';
      name = r.displayName || r.display || r.roleName || code || 'Unknown Role Name';
      isCustom = code.startsWith('CLAAPS_') || code.startsWith('CUSTOM_');
    }

    if (code && !seenCodes.has(code)) {
      seenCodes.add(code);
      normalized.push({
        roleName: name,
        roleCode: code,
        category: classifyRoleRecord({ name: code, roleCode: code, displayName: name } as any),
        isCustom,
      });
    }
  }

  return normalized;
}

async function main(): Promise<void> {
  const client = new OracleFusionClient();

  const [workers, bipRows] = await Promise.all([
    userAccessReportService.getWorkersCached().catch(() => [] as any[]),
    userAccessReportService.getBipRowsCached().catch(() => [] as any[]),
  ]);

  const workerMap = new Map<string, any>();
  for (const w of workers as any[]) {
    if (w?.Username) workerMap.set(String(w.Username).toUpperCase(), w);
  }
  const bipMap = new Map<string, { roleName: string; roleCode: string; autoProvisioned: 'Yes' | 'No' | null }>();
  for (const r of bipRows as any[]) {
    if (!r?.username) continue;
    bipMap.set(`${String(r.username).toUpperCase()}|${String(r.roleCode || '').toUpperCase()}`, {
      roleName: r.roleName || '',
      roleCode: r.roleCode || '',
      autoProvisioned: r.autoProvisioned ?? null,
    });
  }

  let startIndex = 1;
  let totalSaved = 0;
  let totalFetched = 0;

  while (true) {
    const res = await client.getUsers({ count: PAGE_SIZE, startIndex });
    const resources: any[] = res?.Resources || [];
    if (resources.length === 0) break;

    const mapped = resources.map((r: any) => {
      const base = {
        id: r.id,
        userName: r.userName || '',
        userCategory: extractUserCategory(r),
        displayName: r.name?.formatted || r.displayName || `${r.name?.givenName || ''} ${r.name?.familyName || ''}`.trim(),
        firstName: r.name?.givenName || '',
        lastName: r.name?.familyName || '',
        email: r.emails?.find?.((e: any) => e.primary)?.value || r.emails?.[0]?.value || '',
        phone: r.phoneNumbers?.find?.((p: any) => p.primary)?.value || null,
        active: typeof r.active === 'boolean' ? r.active : true,
        assignedRoles: normalizeAssignedRoles(r.roles || r.assignedRoles),
      };

      const worker = workerMap.get(String(base.userName).toUpperCase()) || null;
      const assignments: any[] = worker?.assignments || [];
      const assignment =
        assignments.find((a: any) => a.PrimaryAssignmentFlag === true) ||
        assignments.find((a: any) => a.PrimaryFlag === true) ||
        assignments[0] || null;

      const enrichedRoles = base.assignedRoles.map((role: any) => {
        const code = typeof role === 'string' ? role : role.roleCode || role.value || '';
        const bip = bipMap.get(`${String(base.userName).toUpperCase()}|${String(code || '').toUpperCase()}`);
        const roleName = typeof role === 'string' ? code : role.roleName || role.displayName || code;
        const roleCode = typeof role === 'string' ? code : role.roleCode || code;
        return {
          ...(typeof role === 'string' ? {} : role),
          roleName,
          roleCode,
          category: typeof role === 'string' ? role.category : role.category,
          autoProvisioned: bip?.autoProvisioned ?? (typeof role === 'string' ? null : role.autoProvisioned) ?? null,
        };
      });

      return {
        ...base,
        assignedRoles: enrichedRoles,
        personId: worker?.PersonId ? String(worker.PersonId) : null,
        personNumber: worker?.PersonNumber ? String(worker.PersonNumber) : null,
        department: assignment?.DepartmentName || null,
        job: assignment?.JobName || null,
        businessUnit: assignment?.BusinessUnitName || null,
        location: assignment?.LocationName || null,
        manager: assignment?.ManagerName || null,
      };
    });

    const saved = await userRoleRawDbService.saveRawUsersBatch(mapped);
    totalSaved += saved;
    totalFetched += resources.length;
    console.log(`[Users Full Sync] startIndex=${startIndex} fetched=${resources.length} saved=${saved}`);

    if (resources.length < PAGE_SIZE) break;
    startIndex += resources.length;
  }

  const dbCount = await userRoleRawDbService.getRawUserCount();
  console.log(`[Users Full Sync] Fetched ${totalFetched} users, saved ${totalSaved}, table now holds ${dbCount}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[Users Full Sync] Error:', err);
  process.exit(1);
});
