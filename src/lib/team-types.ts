export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED"
export type DeliveryStatus = "QUEUED" | "LEASED" | "SENT" | "RETRYABLE_FAILED" | "PERMANENTLY_FAILED" | "CANCELLED"

export interface TeamMember {
  id: string
  userId: string
  name: string
  email: string
  status: "ACTIVE" | "REVOKED"
  joinedAt: string
  revision: number
}

export interface TeamInvitation {
  id: string
  publicId: string
  companyId: string
  email: string
  status: InvitationStatus
  expiresAt: string
  generation: number
  revision: number
  invitedBy: string
  acceptedBy: string | null
  acceptedAt: string | null
  delivery: { status: DeliveryStatus; attemptCount: number; sentAt: string | null; errorCode: string | null } | null
  createdAt: string
  updatedAt: string
}

export interface TeamPage {
  members: TeamMember[]
  invitations: TeamInvitation[]
  memberCursor: string | null
  invitationCursor: string | null
}

export interface SessionBootstrap {
  acceptedCompanyIds: string[]
  claimCursor: string | null
  claimComplete: boolean
  invitationStatus: InvitationStatus | "UNAVAILABLE" | "GOOGLE_LOGIN_REQUIRED" | null
  targetCompanyId: string | null
  requiresGoogleLogin: boolean
  nextAction: "COMPANY" | "NO_COMPANY"
}
