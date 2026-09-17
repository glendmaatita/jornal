import { pb } from "./pb"
import type { SessionBootstrap, TeamInvitation, TeamPage } from "./team-types"

const api = (path: string) => `/api/jornal${path}`
const commandKey = () => crypto.randomUUID()

export async function bootstrapSession(invitationPublicId?: string): Promise<SessionBootstrap> {
  let cursor: string | null = null
  let first = true
  const accepted = new Set<string>()
  let result: SessionBootstrap | undefined
  let invitationResult: Pick<SessionBootstrap, "invitationStatus" | "targetCompanyId"> | undefined
  do {
    const page: SessionBootstrap = await pb.send<SessionBootstrap>(api("/session/bootstrap"), {
      method: "POST",
      body: { invitationPublicId: first ? invitationPublicId || undefined : undefined, claimCursor: cursor || undefined },
    })
    result = page
    if (first) invitationResult = { invitationStatus: page.invitationStatus, targetCompanyId: page.targetCompanyId }
    page.acceptedCompanyIds.forEach((id: string) => accepted.add(id))
    cursor = page.claimComplete ? null : page.claimCursor
    first = false
  } while (cursor)
  if (!result) throw new Error("Bootstrap session gagal")
  return { ...result, ...invitationResult, acceptedCompanyIds: [...accepted] }
}

export async function loadTeam(companyId: string): Promise<TeamPage> {
  const members = new Map<string, TeamPage["members"][number]>()
  const invitations = new Map<string, TeamPage["invitations"][number]>()
  let memberCursor: string | null = null
  let invitationCursor: string | null = null
  do {
    const query = new URLSearchParams({ limit: "100" })
    if (memberCursor) query.set("memberCursor", memberCursor)
    if (invitationCursor) query.set("invitationCursor", invitationCursor)
    const page = await pb.send<TeamPage>(api(`/companies/${encodeURIComponent(companyId)}/team?${query}`), {})
    page.members.forEach((member) => members.set(member.id, member))
    page.invitations.forEach((invitation) => invitations.set(invitation.id, invitation))
    memberCursor = page.memberCursor; invitationCursor = page.invitationCursor
  } while (memberCursor || invitationCursor)
  return { members: [...members.values()], invitations: [...invitations.values()], memberCursor: null, invitationCursor: null }
}

export function inviteTeamMember(companyId: string, email: string) {
  return pb.send<TeamInvitation>(api(`/companies/${encodeURIComponent(companyId)}/invitations`), { method: "POST", body: { email, commandKey: commandKey() } })
}
export function resendInvitation(companyId: string, invitation: TeamInvitation) {
  return pb.send<TeamInvitation>(api(`/companies/${encodeURIComponent(companyId)}/invitations/${encodeURIComponent(invitation.id)}/resend`), { method: "POST", body: { expectedRevision: invitation.revision, commandKey: commandKey() } })
}
export function revokeInvitation(companyId: string, invitation: TeamInvitation) {
  return pb.send<TeamInvitation>(api(`/companies/${encodeURIComponent(companyId)}/invitations/${encodeURIComponent(invitation.id)}/revoke`), { method: "POST", body: { expectedRevision: invitation.revision, commandKey: commandKey() } })
}
export function removeTeamMember(companyId: string, userId: string, revision: number) {
  return pb.send<{ userId: string; status: "REVOKED"; revision: number }>(api(`/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(userId)}/remove`), { method: "POST", body: { expectedRevision: revision, commandKey: commandKey() } })
}
export function leaveCompany(companyId: string, revision: number) {
  return pb.send<{ userId: string; status: "REVOKED"; revision: number }>(api(`/companies/${encodeURIComponent(companyId)}/leave`), { method: "POST", body: { expectedRevision: revision, commandKey: commandKey() } })
}
