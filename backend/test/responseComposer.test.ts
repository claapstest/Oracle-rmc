/**
 * Focused unit tests for backend/src/ai/responseComposer.ts (VEYRA-101.7).
 *
 * Characterization tests: they pin the behaviour of the response formatter that
 * was previously inline in orchestrator.ts, so the extraction is provably a
 * move and not a behaviour change.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStructuredResponse } from '../src/ai/responseComposer.js';
import type { ToolExecutionResult } from '../src/tools/index.js';

function result(overrides: Partial<ToolExecutionResult> = {}): ToolExecutionResult {
  return {
    tool: 'testTool',
    parameters: {},
    dataSource: 'Test Source',
    timestamp: '2026-11-05T10:15:00.000Z',
    success: true,
    data: {},
    ...overrides
  };
}

test('LIST_USERS / MULTIPLE_ROLES builds the users table and risk indicator', () => {
  const data = {
    users: [
      {
        userName: 'jdoe',
        displayName: 'Jane Doe',
        active: true,
        assignedRoles: [{}, {}],
        riskLevel: 'High'
      }
    ],
    totalAnalyzed: 10,
    totalMatching: 1
  };

  const out = buildStructuredResponse(
    'LIST_USERS',
    { filterType: 'MULTIPLE_ROLES' },
    result({ data }),
    { summary: 'Users reviewed.', keyFindings: ['One user has multiple roles.'], riskHighlights: [] }
  );

  assert.equal(out.title, 'Users with Multiple Roles');
  assert.equal(out.summary, 'Users reviewed.');
  assert.deepEqual(out.keyFindings, ['One user has multiple roles.']);
  assert.match(out.riskHighlights[0], /^RISK INDICATOR: 1 users have multiple role assignments\./);
  assert.equal(out.table.type, 'users');
  assert.deepEqual(out.table.rows[0], {
    id: 'jdoe',
    displayName: 'Jane Doe',
    userName: 'jdoe',
    active: true,
    roleCount: 2,
    riskLevel: 'High',
    recommendation: 'View Details'
  });
  assert.deepEqual(out.actions, [
    { label: 'Explore Users List', actionType: 'NAVIGATE', params: { page: 'users', filter: 'MULTIPLE_ROLES' } }
  ]);
  assert.equal(out.metadata.source, 'Test Source');
  assert.equal(out.metadata.totalCount, 10);
  assert.equal(out.metadata.matchingCount, 1);
  assert.equal(typeof out.metadata.retrievedAt, 'string');
  assert.equal(out.isAiInvestigation, false);
  assert.equal(out.user, null);
});

test('GET_USER formats the security profile and investigation action', () => {
  const data = {
    displayName: 'Jane Doe',
    userName: 'jdoe',
    active: false,
    assignedRoles: [{}],
    filteredRoleCategory: 'DUTY'
  };

  const out = buildStructuredResponse('GET_USER', {}, result({ data }), {});

  assert.equal(out.title, 'Assigned Duty Roles: Jane Doe');
  assert.equal(out.table.type, 'general');
  assert.deepEqual(out.table.rows[2], { id: '3', attribute: 'Status', value: 'Inactive' });
  assert.deepEqual(out.table.rows[3], {
    id: '4',
    attribute: 'Duty Roles Configured',
    value: '1 active duty role(s) assigned'
  });
  assert.deepEqual(out.actions, [
    {
      label: 'Deep Investigation Workspace',
      actionType: 'INVESTIGATE',
      params: { type: 'user', id: 'jdoe', name: 'Jane Doe', initialTab: 'OVERVIEW' }
    }
  ]);
  assert.deepEqual(out.user, data);
});

test('APPLICATION_KNOWLEDGE passes through the supplied table/actions and investigation flag', () => {
  const table = { type: 'general', columns: ['A'], rows: [{ id: '1', a: 'b' }] };
  const actions = [{ label: 'Open', actionType: 'NAVIGATE', params: { page: 'roles' } }];

  const out = buildStructuredResponse(
    'APPLICATION_KNOWLEDGE',
    {},
    result({ data: { title: 'Duty Roles', table, actions } }),
    { isAiInvestigation: true }
  );

  assert.equal(out.title, 'Duty Roles');
  assert.deepEqual(out.table, table);
  assert.deepEqual(out.actions, actions);
  assert.equal(out.isAiInvestigation, true);
  assert.equal(out.metadata.totalCount, 1);
});

test('unknown intent falls back to the generic Security Details envelope', () => {
  const out = buildStructuredResponse('SOMETHING_NEW', {}, result({ data: {} }), {});

  assert.equal(out.title, 'Security Details');
  assert.equal(out.summary, 'Retrieved security data from the Test Source.');
  assert.equal(out.table, undefined);
  assert.deepEqual(out.actions, []);
  assert.equal(out.metadata.totalCount, 1);
  assert.equal(out.metadata.matchingCount, 1);
});
