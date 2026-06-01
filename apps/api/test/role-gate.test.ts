import { describe, expect, it } from 'bun:test'
import { ulid } from 'ulid'
import { db } from '@/db'
import { issueRoles, rolesTable } from '@/db/schema'
import { issueHasAssignedRole } from '@/engines/issue/role-invoke'
import { createTestIssue, createTestProject, expectSuccess } from './helpers'

describe('issueHasAssignedRole — Command Room gate', () => {
  it('is false for a normal issue and true once a role is assigned', async () => {
    const projectId = await createTestProject('RoleGate')
    const issue = expectSuccess(await createTestIssue(projectId)) as { id: string }
    const issueId = issue.id

    // A normal issue has no assigned roles — the host/role path must be skipped.
    expect(await issueHasAssignedRole(issueId)).toBe(false)

    // Assign a role → it becomes a Command Room chatroom.
    const roleId = ulid()
    await db.insert(rolesTable).values({
      id: roleId,
      projectId,
      name: 'reviewer',
      displayName: 'Reviewer',
      type: 'internal',
      issueId,
    })
    await db.insert(issueRoles).values({ id: ulid(), issueId, roleId })

    expect(await issueHasAssignedRole(issueId)).toBe(true)
  })
})
