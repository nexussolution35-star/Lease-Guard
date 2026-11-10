import type { FacebookSdk } from './embeddedSignup'

/** Meta's Facebook JavaScript SDK. Loaded only on the WhatsApp integration page, when an admin connects. */
export const FACEBOOK_SDK_URL = 'https://connect.facebook.net/en_US/sdk.js'

declare global {
  interface Window {
    FB?: FacebookSdk
    fbAsyncInit?: () => void
  }
}

let loading: Promise<FacebookSdk> | null = null
let initialisedFor: string | null = null

/**
 * Loads the SDK once (a single script tag) and initialises it for the app id and Graph API version the
 * API's onboarding session named. A failed load can be retried.
 */
export function loadFacebookSdk(appId: string, graphApiVersion: string, timeoutMs = 20_000): Promise<FacebookSdk> {
  loading ??= new Promise<FacebookSdk>((resolve, reject) => {
    if (window.FB) {
      resolve(window.FB)
      return
    }
    const timer = setTimeout(() => fail(new Error('Facebook’s sign-in script did not load. Check your connection or ad blocker, then try again.')), timeoutMs)
    const fail = (error: Error) => {
      clearTimeout(timer)
      loading = null
      script.remove()
      reject(error)
    }
    window.fbAsyncInit = () => {
      clearTimeout(timer)
      if (window.FB) resolve(window.FB)
      else fail(new Error('Facebook’s sign-in script loaded without the SDK.'))
    }
    const script = document.createElement('script')
    script.src = FACEBOOK_SDK_URL
    script.async = true
    script.defer = true
    script.crossOrigin = 'anonymous'
    script.onerror = () => fail(new Error('Facebook’s sign-in script could not be loaded. Check your connection or ad blocker, then try again.'))
    document.body.appendChild(script)
  })
  return loading.then((sdk) => {
    const key = `${appId}:${graphApiVersion}`
    if (initialisedFor !== key) {
      sdk.init({ appId, autoLogAppEvents: true, xfbml: true, version: graphApiVersion })
      initialisedFor = key
    }
    return sdk
  })
}

/** Test-only: forget the loaded SDK. */
export function resetFacebookSdkForTests(): void {
  loading = null
  initialisedFor = null
  delete window.FB
  delete window.fbAsyncInit
}
