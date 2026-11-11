import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { EntityId } from '@leaseguard/domain'

import { onboardingKeys } from '@/features/company/api/queries'

import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'
import { useActiveCompanyId } from '@/lib/data/useActiveCompanyId'

import type { FacebookSdk } from '../embedded-signup/embeddedSignup'
import { loadFacebookSdk } from '../embedded-signup/facebookSdk'

import { getWhatsAppIntegrationSource } from './selectSource'
import type {
  WhatsAppDisconnectResult,
  WhatsAppMessageTemplate,
  WhatsAppVerificationRequest,
  WhatsAppBusinessAccount,
  WhatsAppPhoneNumber,
  WhatsAppCapabilities,
  WhatsAppOnboardingCompletion,
  WhatsAppOnboardingResult,
  WhatsAppOnboardingSession,
  WhatsAppActivation,
  WhatsAppSetup,
  WhatsAppTestMessage,
  WhatsAppTestMessageRequest,
} from './source'

export const whatsAppAccountKeys = createEntityKeys('whatsapp-business-account')
/** Deployment-wide, so not keyed by company. */
export const whatsAppCapabilityKeys = { all: ['whatsapp-capabilities'] as const }

/** What this LeaseGuard deployment is configured for (the same for every company). */
export function useWhatsAppCapabilities(): UseQueryResult<WhatsAppCapabilities> {
  return useQuery({ queryKey: whatsAppCapabilityKeys.all, queryFn: () => getWhatsAppIntegrationSource().getCapabilities() })
}

export const whatsAppTemplateKeys = createEntityKeys('whatsapp-message-template')

/** How often the numbers are refreshed while a verification may still be running. */
export const VERIFICATION_POLL_MS = 3000

/**
 * Whether verification may still change a number: it is pending verification and a step is still pending
 * (being checked) or none has been recorded yet. A step waiting for the admin's PIN does not count.
 */
export function isVerificationRunning(accounts: readonly WhatsAppBusinessAccount[] | undefined): boolean {
  return (accounts ?? []).some((account) => account.numbers.some(isNumberVerificationRunning))
}

/** The same, for one number (e.g. the registration PIN is only asked for once its run has finished). */
export function isNumberVerificationRunning(n: WhatsAppPhoneNumber): boolean {
  return (
    n.connectionStatus === 'pending_verification' &&
    (n.verificationSteps.length === 0 || n.verificationSteps.some((step) => step.status === 'pending'))
  )
}

/** The active company's WhatsApp Business Accounts with their numbers; polled while a verification runs. */
export function useWhatsAppBusinessAccounts(): UseQueryResult<WhatsAppBusinessAccount[]> {
  return useCompanyQuery(
    (companyId) => whatsAppAccountKeys.lists(companyId),
    (companyId) => getWhatsAppIntegrationSource().listBusinessAccounts(companyId),
    { refetchInterval: (query) => (isVerificationRunning(query.state.data) ? VERIFICATION_POLL_MS : false) },
  )
}

/** The message templates Meta holds for the active company's accounts. */
export function useWhatsAppMessageTemplates(): UseQueryResult<WhatsAppMessageTemplate[]> {
  return useCompanyQuery(
    (companyId) => whatsAppTemplateKeys.lists(companyId),
    (companyId) => getWhatsAppIntegrationSource().listMessageTemplates(companyId),
  )
}

/** Company admins: verify a number again; the numbers list then polls until the run settles. */
export function useVerifyWhatsAppNumber(): UseMutationResult<WhatsAppVerificationRequest, Error, { numberId: EntityId }> {
  const companyId = useActiveCompanyOrThrow()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ numberId }) => getWhatsAppIntegrationSource().verifyNumber(companyId(), numberId),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: whatsAppAccountKeys.all }),
        queryClient.invalidateQueries({ queryKey: whatsAppSetupKeys.all }),
      ]),
  })
}

/** Company admins: register a number with a 6-digit PIN. The PIN is never kept by the web app. */
export function useRegisterWhatsAppNumber(): UseMutationResult<WhatsAppVerificationRequest, Error, { numberId: EntityId; pin: string }> {
  const companyId = useActiveCompanyOrThrow()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ numberId, pin }) => getWhatsAppIntegrationSource().registerNumber(companyId(), numberId, pin),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: whatsAppAccountKeys.all }),
        queryClient.invalidateQueries({ queryKey: whatsAppSetupKeys.all }),
      ]),
  })
}

/** Company admins: disconnect a number. */
export function useDisconnectWhatsAppNumber(): UseMutationResult<WhatsAppDisconnectResult, Error, { numberId: EntityId }> {
  const companyId = useActiveCompanyOrThrow()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ numberId }) => getWhatsAppIntegrationSource().disconnectNumber(companyId(), numberId),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: whatsAppAccountKeys.all }),
        queryClient.invalidateQueries({ queryKey: onboardingKeys.all }),
        queryClient.invalidateQueries({ queryKey: whatsAppSetupKeys.all }),
      ]),
  })
}

export const whatsAppSetupKeys = createEntityKeys('whatsapp-setup')

/**
 * Whether Meta may still change the setup without anyone clicking: a test message on its way, a verification or a
 * signup in progress. The setup is then refreshed every few seconds.
 */
export function isSetupWaitingOnMeta(setup: WhatsAppSetup | undefined): boolean {
  return (setup?.steps ?? []).some((step) => step.state === 'waiting_on_meta' && step.step !== 'message_templates')
}

/** The active company's ten WhatsApp setup steps and activation; polled while LeaseGuard waits on Meta. */
export function useWhatsAppSetup(options: { enabled?: boolean } = {}): UseQueryResult<WhatsAppSetup> {
  return useCompanyQuery(
    (companyId) => whatsAppSetupKeys.company(companyId),
    (companyId) => getWhatsAppIntegrationSource().getSetup(companyId),
    { ...options, refetchInterval: (query) => (isSetupWaitingOnMeta(query.state.data) ? VERIFICATION_POLL_MS : false) },
  )
}

/** Company admins: send a test message; the setup then polls until Meta reports it delivered (or it fails). */
export function useSendWhatsAppTestMessage(): UseMutationResult<WhatsAppTestMessage, Error, WhatsAppTestMessageRequest> {
  const companyId = useActiveCompanyOrThrow()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request) => getWhatsAppIntegrationSource().sendTestMessage(companyId(), request),
    onSettled: () => queryClient.invalidateQueries({ queryKey: whatsAppSetupKeys.all }),
  })
}

/** Company admins: activate (true) or deactivate (false) WhatsApp for the company. */
export function useSetWhatsAppActivation(): UseMutationResult<WhatsAppActivation, Error, { active: boolean }> {
  const companyId = useActiveCompanyOrThrow()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ active }) => (active ? getWhatsAppIntegrationSource().activate(companyId()) : getWhatsAppIntegrationSource().deactivate(companyId())),
    onSettled: () => queryClient.invalidateQueries({ queryKey: whatsAppSetupKeys.all }),
  })
}

/** The active company id for a mutation; mutations only run from screens inside an open workspace. */
function useActiveCompanyOrThrow(): () => EntityId {
  const companyId = useActiveCompanyId()
  return () => {
    if (companyId === null) throw new Error('No workspace is selected.')
    return companyId
  }
}

/** A session ready for Meta's popup: the SDK is loaded, so the popup can open straight from a click. */
export interface PreparedWhatsAppSignup {
  companyId: EntityId
  session: WhatsAppOnboardingSession
  sdk: FacebookSdk
}

/**
 * Starts an Embedded Signup session and loads the Facebook SDK. Opening the popup is a separate click
 * (browsers block popups that do not follow a click directly).
 */
export function usePrepareWhatsAppSignup(): UseMutationResult<PreparedWhatsAppSignup, Error, void> {
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: async () => {
      const id = companyId()
      const session = await getWhatsAppIntegrationSource().startOnboarding(id)
      const sdk = await loadFacebookSdk(session.appId, session.graphApiVersion)
      return { companyId: id, session, sdk }
    },
  })
}

/** Sends the popup's result to the API (which exchanges the code at once), then refreshes the numbers. */
export function useCompleteWhatsAppSignup(): UseMutationResult<
  WhatsAppOnboardingResult,
  Error,
  { companyId: EntityId; sessionId: EntityId; completion: WhatsAppOnboardingCompletion }
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ companyId, sessionId, completion }) => getWhatsAppIntegrationSource().completeOnboarding(companyId, sessionId, completion),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: whatsAppAccountKeys.all }),
        queryClient.invalidateQueries({ queryKey: onboardingKeys.all }),
        queryClient.invalidateQueries({ queryKey: whatsAppSetupKeys.all }),
      ]),
  })
}
