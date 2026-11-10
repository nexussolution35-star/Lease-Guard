import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FacebookSdk } from './embeddedSignup'
import { FACEBOOK_SDK_URL, loadFacebookSdk, resetFacebookSdkForTests } from './facebookSdk'

const sdkScripts = () => [...document.querySelectorAll('script')].filter((s) => s.src === FACEBOOK_SDK_URL)

afterEach(() => {
  sdkScripts().forEach((s) => s.remove())
  resetFacebookSdkForTests()
})

describe('loadFacebookSdk', () => {
  it('adds the SDK script once and initialises it for the app and Graph API version', async () => {
    const sdk: FacebookSdk = { init: vi.fn(), login: vi.fn() }
    const first = loadFacebookSdk('1234567890', 'v27.0')
    const second = loadFacebookSdk('1234567890', 'v27.0')
    expect(sdkScripts()).toHaveLength(1)

    window.FB = sdk
    window.fbAsyncInit?.()
    await expect(first).resolves.toBe(sdk)
    await expect(second).resolves.toBe(sdk)
    expect(sdk.init).toHaveBeenCalledTimes(1)
    expect(sdk.init).toHaveBeenCalledWith({ appId: '1234567890', autoLogAppEvents: true, xfbml: true, version: 'v27.0' })
  })

  it('explains a blocked script and can be retried', async () => {
    const load = loadFacebookSdk('1234567890', 'v27.0')
    sdkScripts()[0].dispatchEvent(new Event('error'))
    await expect(load).rejects.toThrow(/could not be loaded/)
    expect(sdkScripts()).toHaveLength(0)
    void loadFacebookSdk('1234567890', 'v27.0').catch(() => undefined)
    expect(sdkScripts()).toHaveLength(1)
  })
})
