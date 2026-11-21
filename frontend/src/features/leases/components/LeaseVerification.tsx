import type { Lease } from '@leaseguard/domain'

import { DateDisplay, SignOff } from '@/components/shared'

export interface LeaseVerificationProps {
  lease: Pick<Lease, 'verified' | 'verifiedAt'>
  /** The verifier's name, only when the member is loaded: a sign-off never shows a placeholder as if it were a person. */
  signer: string | undefined
}

/**
 * Who verified the lease terms and when. A name shows only when the member is loaded; a verified lease whose verifier
 * cannot be named still shows that it was verified, and an unverified one shows the open sign-off mark.
 */
export function LeaseVerification({ lease, signer }: LeaseVerificationProps) {
  if (!lease.verified) return <SignOff pendingLabel="Terms not verified" />
  if (signer) return <SignOff by={signer} at={lease.verifiedAt} />
  return (
    <span className="text-sm text-muted-foreground">
      Terms verified
      {lease.verifiedAt ? (
        <>
          {' · '}
          <DateDisplay value={lease.verifiedAt} className="tabular-nums" />
        </>
      ) : null}
    </span>
  )
}
