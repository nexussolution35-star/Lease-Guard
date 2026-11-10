# WhatsApp Embedded Signup research: becoming a Tech Provider

Researched 2026-11-10 from Meta primary sources only (developers.facebook.com, the Graph API
reference and Meta's own legal terms). Each claim cites the page it came from. Anything marked
**unconfirmed** was not stated on a primary page I could read.

Abbreviations: **ES** is Embedded Signup. **WABA** is WhatsApp Business Account (now called a
"Messaging account"). **BISU** is a business integration system user access token. **CSW** is the
customer service window.

## 0. Graph API version and big-picture changes (read first)

- **Current Graph API version: v27.0.** The Facebook Login for Business, debug_token, manual flow,
  two-step verification, registration, webhook override and subscribed_apps samples all use
  `v27.0`. The Graph API changelog lists v27.0 as the latest, with v26.0 (introduced July 29, 2026)
  before it.
  - https://developers.facebook.com/docs/graph-api/changelog
  - https://developers.facebook.com/docs/graph-api/reference/debug_token/
- Some pages still have older samples. The Tech Provider onboarding page uses `v21.0` for the token
  exchange, and template management uses `v23.0`. Use v27.0 and pin it in config.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-management
- **The latest ES version is v5 (released October 20, 2026).** v4 (October 8, 2025) is still
  available. v2 and v3, including their public previews, were deprecated on October 15, 2026.
  "Requests for them, and requests with no `version` or an invalid one, are served as v4." v2
  WABA-only sharing (`featureType: "only_waba_sharing"`) keeps working until November 16, 2026.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-5
- **Account model evolution.** The legacy WABA is being split into two accounts:
  - a **WhatsApp account (WAAC)**: the identity layer. It holds the phone number and profile, and
    the client always owns it.
  - a **Messaging account**: holds templates, billing and webhooks. Each partner gets its own.

  "Existing WABA IDs remain the same and denote Messaging account IDs." The phases are:
  - Phase 1 (GA from September 23, 2026): no code changes.
  - Phase 2 (H1 2027): new Graph API version, WAAC IDs, and a new optional `whatsapp_account`
    webhook topic.
  - Phase 3 (H1 2028): mandatory. Phone-number-path APIs must use WAAC IDs, and
    `messaging_account_id` is required in multi-account setups.

  The whole document is "subject to change".
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/onboarding
- **Service messages are no longer free (from October 1, 2026).** Each number gets 1,000 free
  service messages a month. After that, all non-template messages are charged, and so are utility
  templates sent inside an open CSW. See section 7.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- **Users may have no phone number in webhooks.** Webhooks now identify users by a business-scoped
  user ID (BSUID): `user_id`, `from_user_id` and `recipient_user_id`. `wa_id` and `from` "may be
  omitted" when a user has adopted a username. See section 6.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages

## 1. Tech Provider vs Solution Partner

Source for this section unless noted:
https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview

| | Tech Provider (LeaseGuard) | Tech Partner | Solution Partner |
|---|---|---|---|
| Definition | "similar to Solution Partners". Can offer a full range of services alone or with a Solution Partner | "Tech Providers who are, or are eligible to become, Meta Business Partners" | "Meta Business Partners that provide a full range of WhatsApp Business Platform services" |
| Credit line / invoicing clients for Meta usage | **No** | No | Yes. Holds a credit line, extends it to clients and invoices them |
| Who pays Meta for messaging | **The client's own payment method** | The client's own payment method | The partner's credit line (partner is "Bill To Party") |
| Accelerator programme | No (unless upgraded to Tech Partner) | Yes | Yes |
| Tokens | "Use business tokens exclusively" | Same as Tech Provider | System user token for credit sharing; business tokens for the rest |

- "clients onboarded by Tech Providers must provide their own payment method after onboarding is
  complete". Meta bills the client for API usage, and the Tech Provider bills separately for its
  own services. (overview page above)
- The ES overview says the same: "If you are a Tech Provider or Tech Partner, your onboarded
  business customers must add a payment method". Solution Partners "must already have a line of
  credit and have accepted the Credit Allocation API terms".
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview
- The Tech Provider guide says: "Your onboarded clients must add a credit card to your WhatsApp
  Business Platform Account". It also says "Confirmed Tech Providers have access to all support
  channels."
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- Credit-line sharing (`whatsapp_credit_sharing_and_attach`, extended credits) is documented only
  for Solution Partners. It needs a system user token with `business_management`, held by an Admin
  or Financial Editor. The page does not mention Tech Providers. **Treat it as not available to
  LeaseGuard (unconfirmed by an explicit statement).**
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/share-and-revoke-credit-lines
- Each Messaging account is billed separately, with its own payment method and spend limits.
  "Solution Providers are charged only for messages sent through their own Messaging account."
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing

**For LeaseGuard:** the property-management company (the client) owns its WAAC and pays Meta
directly through a payment method in WhatsApp Manager. LeaseGuard never touches Meta billing. This
fits the CLAUDE.md "no payment processing" constraint. LeaseGuard can:
- send messages and manage templates on the client's behalf (subject to Advanced Access);
- receive the client's webhooks;
- register the client's numbers.

LeaseGuard cannot extend credit or invoice for Meta usage.

## 2. Prerequisites and approvals

### 2.1 Business verification
"Your business must be verified before you can start the app review process." You need business
details (name, address, phone, email, website) and possibly documents.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers

### 2.2 App and App Review
- Prerequisite: "A Meta app with the WhatsApp use case and a connected business portfolio". The app
  also needs an icon, a privacy policy and a category.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- The ES integration helper is only available for Business-type apps.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview
- App Review videos:
  - Video 1: a message sent from your app and received in WhatsApp.
  - Video 2: your app creating a message template.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- Each permission needs its own written explanation and screen recording. "you cannot submit a
  screenshot, you must submit a screen recording". "Submissions in draft mode will not be reviewed."
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review

### 2.3 Advanced Access permissions
- `whatsapp_business_management` is "required to access your clients' WhatsApp accounts and
  Messaging accounts". Without Advanced Access, calls on accounts your business does not own
  "return error code 200".
- `whatsapp_business_messaging` is "required to send messages on behalf of your clients".
- `whatsapp_business_manage_events` is needed only for the Marketing Messages API with the
  Conversions API.
- "If you are building an app that other businesses will be using, you must request Advanced
  access for any permissions your app needs."
- Sources:
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- **`business_management`:** the App Review and Tech Provider pages do not list it as a Tech
  Provider requirement. Meta mentions it only for Solution Partner credit-line sharing (system user
  tokens). Do not request it for the Tech Provider path. Whether a v4/v5 configuration auto-selects
  it is **unconfirmed**.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/share-and-revoke-credit-lines
- In v4 and later, choosing products in the Login for Business configuration automatically selects
  the permissions. "All automatically selected permissions need Advanced Access." For the Cloud API
  product these are `whatsapp_business_management` and `whatsapp_business_messaging`.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4

### 2.4 Facebook Login for Business configuration (configuration ID)
- Steps, from the v4 page:
  1. In the App Dashboard, open Facebook Login for Business, then Configurations, then create one.
  2. Choose the **Embedded Signup** login variation.
  3. Select the products (for example Cloud API).
  4. Copy the **configuration ID**.

  "Selecting products automatically sets the configuration to v4."
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4
- "You will receive a Configuration ID that you will use in your code to invoke the login dialog."
  - https://developers.facebook.com/docs/facebook-login/facebook-login-for-business
- Client OAuth settings: add every host or test domain to **Allowed domains** and **Valid OAuth
  redirect URIs**. Enable these toggles:
  - Client OAuth login
  - Web OAuth login
  - Enforce HTTPS
  - Embedded Browser OAuth Login
  - Strict Mode for redirect URIs
  - Login with the JavaScript SDK

  Only HTTPS domains with a valid SSL certificate work. If the domain is not listed, the flow does
  not return data.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation

### 2.5 Recommended ES version
- **v5** is the latest (released October 20, 2026). Use `extras: { version: "v5" }`. v5 keeps v4's
  configuration-driven product selection and makes two changes:
  - WhatsApp Business app onboarding (coexistence) is **on by default**.
  - Session info uses a fixed version 5 object, which returns `messaging_account_ids` in place of
    `waba_id`.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-5
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions
- The ES overview page still calls **v4** "the target version". **Unconfirmed:** whether Meta
  formally recommends v5 over v4. Both are listed as available "until TBD". Whether v5 needs a new
  configuration ID or reuses the v4 one is also **unconfirmed**.

### 2.6 Onboarding limits and Access Verification
- "By default, you can onboard up to 10 new business customers in a rolling 7-day window." "If you
  complete Business Verification, App Review, and Access Verification, your limit is automatically
  increased to 200".
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview
- What Access Verification involves is **unconfirmed**. No page I read describes it.

### 2.7 What works before approval
- "Business apps are automatically approved for Standard Access for all Permissions and Features."
  Test users must have a developer or admin role on the Meta app used for ES. "if you are using the
  API for yourself as a Direct Developer, you do not need Advanced access or app review."
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review
- "You will not be able to onboard business customers until your app has been approved for
  advanced access". In development mode the permissions still appear on ES's authorization screen
  for users with app roles.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview
- You can test ES with your own Facebook account, which the docs warn can have side effects, or
  with **sandbox accounts**. "Sandbox accounts are valid for 30 days, after which they will be
  deactivated and must be reclaimed".
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview
- Short-lived user tokens from the App Dashboard's API Setup panel are meant for early testing,
  such as sending a first test message.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens
- WABAs created through the developer app cannot be onboarded through ES.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview

## 3. Frontend flow

Source unless noted:
https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation

### 3.1 SDK init and launch
```js
FB.init({ appId: '<APP_ID>', autoLogAppEvents: true, xfbml: true, version: 'v27.0' });

const fbLoginCallback = (response) => {
  if (response.authResponse) {
    const code = response.authResponse.code; // send to server immediately
  }
};

FB.login(fbLoginCallback, {
  config_id: '<CONFIGURATION_ID>',
  response_type: 'code',
  override_default_response_type: true,
  extras: { version: 'v5' } // v5 per versions page; the implementation sample shows `setup: {}`
});
```
- `version` in `FB.init` is the Graph API version. ES does not use the SDK for API calls.
- `response_type: 'code'` together with `override_default_response_type: true` returns an
  exchangeable code instead of a token.
- `extras` by ES version, from
  https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions:
  - **v2:** `setup`, `features`, `featureType` and `sessionInfoVersion`.
  - **v3:** drops `sessionInfoVersion`.
  - **v4:** `extras: {}`, with optional `featureType` or `features`. Products come from the
    configuration, not from `extras`.
  - **v5:** `extras: { version: "v5" }`. To opt out of Business app onboarding, add
    `features: [{ name: "whatsapp_business_app_onboarding", enabled: false }]`. "The opt-out
    applies even if you also pass `featureType: "whatsapp_business_app_onboarding"`."
    "`sessionInfoVersion` is ignored if you pass it."
- The `setup` object can pre-fill screens. See
  https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/pre-filled-data
  (not researched in detail).

### 3.2 The `message` event (session info)
```js
window.addEventListener('message', (event) => {
  if (!event.origin.endsWith('facebook.com')) return;
  try {
    const data = JSON.parse(event.data);
    if (data.type === 'WA_EMBEDDED_SIGNUP') { /* forward to server */ }
  } catch { /* non-JSON message */ }
});
```
Note that `endsWith('facebook.com')` is Meta's own sample. A stricter check, such as an exact
`https://www.facebook.com` or `https://web.facebook.com` origin, is safer. Meta does not document
the exact origin list (**unconfirmed**).

**v4 and earlier (session info v3) FINISH payload:** `data.phone_number_id`, `data.waba_id`
(now means the Messaging account ID) and `data.business_id` (the client's business portfolio).
Optional arrays: `ad_account_ids`, `page_ids`, `dataset_ids`, `catalog_ids`,
`instagram_account_ids` and `waba_ids`. Top level: `type: 'WA_EMBEDDED_SIGNUP'` and `event`.
`event` is one of `FINISH`, `FINISH_ONLY_WABA`, `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` or
`FINISH_GRANT_ONLY_API_ACCESS`.

**v5 (session info v5) FINISH payload:** `data` contains:
- `phone_number_id`
- `is_on_biz_app`
- `messaging_account_ids`: "Messaging accounts shared with you. Replaces `waba_id`."
- `primary_waac_ids`: "Empty until WhatsApp account IDs are available in the Graph API", that is,
  until Phase 2.
- `page_ids`, `catalog_ids`, `dataset_ids`, `business_id` and `instagram_account_ids`

`event` is `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` when `is_on_biz_app` is `true`, and `FINISH`
otherwise.
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-5

**CANCEL:** `data.current_step` (for example `PHONE_NUMBER_SETUP`) and `event: 'CANCEL'`.

**ERROR:** `data.error_message`, `data.error_code`, `data.session_id` and `data.timestamp` (Unix
milliseconds, as a string), with `event: 'ERROR'`.

In v5, "Cancel and error events are unchanged from session info version 3."
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-5

**Behaviour notes:**
- Clicking Finish and closing the popup on the final screen both count as success. "The
  exchangeable code is returned to the callback only when the customer clicks Finish." Design for
  a FINISH message that arrives **without** a code.
- **Code lifetime: "The exchangeable token code has a time-to-live of 30 seconds."** Send it to the
  server and exchange it immediately. Do not queue it behind any user step.

## 4. Server side

### 4.1 Token exchange
"Perform all of the requests described below using server-to-server requests. Do not use
client-side requests."
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider

```
GET https://graph.facebook.com/v27.0/oauth/access_token
    ?client_id=<APP_ID>&client_secret=<APP_SECRET>&code=<CODE>
```
- The response is `{ "access_token": "<BUSINESS_TOKEN>", "token_type": "bearer" }`. No
  `expires_in` is shown. The Tech Provider page shows the same call on `v21.0`, and Login for
  Business shows it on `v27.0`.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider
  - https://developers.facebook.com/docs/facebook-login/facebook-login-for-business
- The generic manual login flow requires `redirect_uri`, matching the original one. The ES and
  Login for Business samples omit it for the JS SDK popup flow. Whether ES ever needs it is
  **unconfirmed**.
  - https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow

### 4.2 Token type and lifetime
- The exchange yields a **business integration system user (BISU) access token**. "Access is
  explicitly delegated at the time of authorization." It is tied to the client's business
  portfolio, and only Tech Providers use it.
- Expiry: "Defaults to **never expire** for the common offline server-to-server communication."
  The page also describes an option for a token that "expires in 60 days" when generated through
  the management API.
- Source: https://developers.facebook.com/docs/facebook-login/facebook-login-for-business
- Each BISU is scoped to one onboarded customer. It suits automated actions "that don't need
  app-user input or future re-authentication". Treat tokens as opaque, variable-length strings.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens
- No refresh mechanism is documented. Re-run ES if a token becomes invalid (**unconfirmed** as an
  official recommendation).
- To get the client's business ID:
  `GET /v27.0/me?fields=client_business_id&access_token=<BISU>`
  - https://developers.facebook.com/docs/facebook-login/facebook-login-for-business

### 4.3 Inspecting tokens: debug_token
- Request: `GET /v27.0/debug_token?input_token={token}`, authenticated with an **app access token**
  or an app developer's user token.
- Response fields under `data`:
  - `app_id`, `application`
  - `expires_at`, `data_access_expires_at`, `issued_at`
  - `is_valid`
  - `scopes`
  - `granular_scopes[]`, each with `scope` and `target_ids`. Use these to check which WABA IDs the
    token covers.
  - `user_id`, `profile_id`, `metadata`
  - `error`
- What `expires_at: 0` means is **unconfirmed** on this page. It commonly indicates a non-expiring
  token, but the page does not say so.
- Source: https://developers.facebook.com/docs/graph-api/reference/debug_token/

### 4.4 Revocation and deauthorization
- A client revokes a BISU from Business Settings: Integrations, then Connected apps, then remove the
  app.
  - https://developers.facebook.com/docs/facebook-login/facebook-login-for-business
- **Webhook signal:** the `account_update` field with `event: "PARTNER_APP_UNINSTALLED"`. It fires
  when "A business customer deauthenticated or uninstalled the app". The payload is
  `waba_info.waba_id`, `owner_business_id` and `partner_app_id`. Related events:
  - `PARTNER_APP_INSTALLED`
  - `PARTNER_REMOVED`, which includes `disconnection_info` for coexistence
  - `ACCOUNT_DELETED`, `ACCOUNT_OFFBOARDED`, `ACCOUNT_RECONNECTED`
  - `DISABLED_UPDATE`, `ACCOUNT_RESTRICTION`, `ACCOUNT_VIOLATION`
  - `PARTNER_CLIENT_CERTIFICATION_STATUS_UPDATE`
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/account_update
- Facebook Login also offers a **Deauthorize Callback URL**: an HTTP POST carrying a
  `signed_request` (HMAC-SHA256 with the app secret) when a user de-authorizes the app.
  - https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow
  - https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/
- Whether that callback fires for **BISU** revocation in Business Settings is **unconfirmed**. Rely
  on `PARTNER_APP_UNINSTALLED` and on token errors, and treat the deauthorize callback as
  best-effort.

## 5. Post-signup steps LeaseGuard must call

Source unless noted:
https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider

1. **Exchange the code** (section 4.1) within 30 seconds.
2. **Subscribe the app to the client's WABA webhooks.**
   `POST https://graph.facebook.com/v27.0/<WABA_ID>/subscribed_apps` with
   `Authorization: Bearer <BISU>` returns `{"success": true}`. You "must individually subscribe to
   every Messaging account". Also available:
   - `GET .../subscribed_apps` to list subscriptions
   - `DELETE .../subscribed_apps` to unsubscribe
   - https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/manage-webhooks

   Optional per-WABA override: include `override_callback_uri` (max 200 characters) and
   `verify_token` in the same POST body. Per-phone overrides use `POST /<PHONE_NUMBER_ID>` with
   `webhook_configuration`. Precedence is phone, then WABA, then the app default. "Template and
   account-level webhooks don't support overrides and always go to the app's default callback URL."
   - https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override
3. **Register the phone number.**
   `POST https://graph.facebook.com/v27.0/<PHONE_NUMBER_ID>/register` with body
   `{"messaging_product":"whatsapp","pin":"<6 digits>"}`. Optionally add
   `data_localization_region` (an ISO 3166 two-letter code).
   - The PIN becomes the number's two-step verification PIN.
   - Rate limit: "10 requests per business number in a 72-hour moving window". Exceeding it returns
     error `133016` and locks registration for 72 hours. Do not retry blindly.
   - https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration
   - Change the PIN with `POST /v27.0/<PHONE_NUMBER_ID>` and `{"pin":"<6 digits>"}`. "There is no
     endpoint to disable two-step verification." The PIN is being deprecated gradually for eligible
     Cloud API numbers.
   - https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/two-step-verification
   - Numbers already on the WhatsApp Business app need the coexistence flow (on by default in v5).
     - https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview
4. **Optional test message**, sent with `POST /<PHONE_NUMBER_ID>/messages` and type `text`. It works
   only inside an open CSW, so message the client's number from your own WhatsApp first.
5. **Instruct the client to add a payment method** in WhatsApp Manager
   (https://business.facebook.com/wa/manage/home/ then "Add payment method"), or point them to
   https://www.facebook.com/business/help/488291839463771. "Once your customer adds a payment
   method, they are fully onboarded".
   - Since October 1, 2026, Meta stops delivering service messages for accounts without a payment
     method.
     - https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages
6. **Read phone number status, quality and name.** Source:
   https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers
   - `GET /<WABA_ID>/phone_numbers` returns `id`, `display_phone_number`, `verified_name` and
     `quality_rating` (for example `GREEN`), sortable by `last_onboarded_time`.
   - `GET /<PHONE_NUMBER_ID>` also returns `code_verification_status`.
   - `?fields=status` returns values such as `"CONNECTED"`.
   - `?fields=name_status` (beta) returns values such as `AVAILABLE_WITHOUT_REVIEW`.
   - `?fields=throughput` returns the throughput level.
   - Messaging limits are set per **business portfolio** and shared across its numbers. New
     portfolios start at 250. `messaging_limit_tier` is deprecated, so use
     `whatsapp_business_manager_messaging_limit`.
     - https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits
7. **Fetch message templates.** `GET /v27.0/<WABA_ID>/message_templates` supports `fields`, a
   status filter and `limit`, with cursor `paging`. Statuses include `APPROVED`, `PENDING`,
   `REJECTED`, `PAUSED`, `DISABLED` and `PENDING_DELETION`. Names are lowercase, digits and
   underscores, up to 512 characters, and unique per language.
   - The request body for creating a template is in the Message Templates API reference
     (**not researched here**).
   - Remember the account model: templates belong to LeaseGuard's own Messaging account for that
     client and are "not shared across" Messaging accounts.
   - https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-management
   - https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution
8. **Credit lines:** Solution Partners only (section 1). LeaseGuard skips this.
9. **Calling is not enabled by default.** It is irrelevant to LeaseGuard.

## 6. Webhooks

### 6.1 Verification handshake
- Meta sends `GET <callback>?hub.mode=subscribe&hub.challenge=...&hub.verify_token=...`. Compare
  `hub.verify_token` to your stored string. If it matches, respond `200` with the `hub.challenge`
  value. Otherwise respond with any non-200 status.
- Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint

### 6.2 Signature
- The `X-Hub-Signature-256: sha256=<hash>` header holds an HMAC-SHA256 of the payload, keyed with
  the **app secret**. "Compare your generated hash to the hash assigned to the
  `X-Hub-Signature-256` header (everything after `sha256=`)."
- The docs say "JSON payload". Computing the hash over the **raw request bytes** before JSON
  parsing is the standard reading, but the exact wording is **unconfirmed**. Use a constant-time
  compare.
- Self-signed certificates are not supported, and mTLS is optional and set per app.
- Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint

### 6.3 Delivery, retries and duplicates
- Failed deliveries are "retried immediately, then a few more times with decreasing frequency over
  the next 7 days". "Unacknowledged responses will be dropped after 7 days."
- Retries "can result in duplicate webhook notifications". Deduplicate, for example on
  `messages[].id` or `statuses[].id` plus `status`.
- POSTs may batch up to 1,000 updates, though batching is not guaranteed. Payloads can be up to
  3 MB.
- No response-time SLA and no ordering guarantee are documented (**unconfirmed**). Acknowledge
  fast with 200 and process asynchronously.
- Meta's IPs change periodically, and Meta recommends mTLS over IP allowlists.
- Sources:
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview

### 6.4 Payload shape
Common envelope: `{ object: "whatsapp_business_account", entry: [{ id: <WABA_ID>, changes: [{ field, value }] }] }`.

Incoming message (`field: "messages"`), from
https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages:
- `value.messaging_product`
- `value.metadata.display_phone_number` and `value.metadata.phone_number_id`. Route to the
  LeaseGuard company by `phone_number_id`.
- `value.contacts[].profile.name`, `value.contacts[].wa_id`, `value.contacts[].user_id` (BSUID,
  for example `US.1349...`) and `contacts[].profile.username` when the user has one
- `value.messages[].from`, `.from_user_id`, `.id` (a `wamid....` value), `.timestamp`, `.type` and
  `.text.body`
- **BSUID:** "An integration that relies only on phone number fields will not be able to process
  messages from these users." `wa_id` and `from` are omitted when the user has a username and the
  phone number is not available. You can send to a BSUID through the `recipient` field. The
  rollout date is **unconfirmed**.

Status (`field: "messages"`, `value.statuses[]`), from
https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status:
- `id`, `status` (`sent`, `delivered`, `read` or `failed`), `timestamp`, `recipient_id` and
  `recipient_user_id`
- `pricing` with `billable`, `pricing_model: "PMP"`, `type` and `category`. `pricing` appears in
  either the sent webhook or the delivered/read webhook, not both.
- `conversation`, which on v24.0 and later is omitted unless the message is in a free entry point
- `errors[]` on `failed`, with `code` (for example `131049`), `title`, `message`,
  `error_data.details` and `href`
- A "delivered" webhook may be skipped if the message was read immediately.

### 6.5 Account-level fields relevant to onboarding status
The full field list:
- `account_alerts`, `account_review_update`, `account_update`
- `automatic_events`, `business_capability_update`, `calls`, `history`
- `message_template_components_update`, `message_template_quality_update`,
  `message_template_status_update`, `messages`
- `partner_solutions`, `payment_configuration_update`
- `phone_number_name_update`, `phone_number_quality_update`
- `security`, `smb_app_state_sync`, `smb_message_echoes`, `template_category_update`,
  `user_preferences`

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview

The fields LeaseGuard should handle:
- **account_update:** `PARTNER_APP_INSTALLED`, `PARTNER_APP_UNINSTALLED`, `PARTNER_ADDED` and
  `PARTNER_REMOVED`, plus `ACCOUNT_DELETED`, `DISABLED_UPDATE`, `ACCOUNT_RESTRICTION`,
  `ACCOUNT_VIOLATION` and `PARTNER_CLIENT_CERTIFICATION_STATUS_UPDATE`.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/account_update
- **message_template_status_update:** carries `event`, `message_template_id`,
  `message_template_name`, `message_template_language`, `reason` and
  `message_template_category`. `event` is one of `APPROVED`, `PENDING`, `REJECTED`, `PAUSED`,
  `DISABLED`, `FLAGGED`, `LOCKED`, `IN_APPEAL`, `LIMIT_EXCEEDED`, `REINSTATED`, `ARCHIVED`,
  `UNARCHIVED`, `DELETED` or `PENDING_DELETION`.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/message_template_status_update
- **phone_number_quality_update:** `event` is `ONBOARDING` or `THROUGHPUT_UPGRADE`, with
  `display_phone_number` and `max_daily_conversations_per_business` (tier values from `TIER_50` to
  `TIER_UNLIMITED`). `current_limit` and `old_limit` were scheduled for removal in February 2026.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/phone_number_quality_update
- **phone_number_name_update**, **business_capability_update**, **payment_configuration_update**
  and **template_category_update** are listed but were not researched in detail.
- Account and template webhooks always go to the app's default callback URL; they cannot be
  overridden.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override

## 7. Messaging rules

### 7.1 Customer service window (CSW)
- A 24-hour window opens when a user messages or calls the business. Non-template messages "can
  only be sent in an open 24-hour customer service window". Outside it, only templates can be sent.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages
- The free entry point (FEP) window from Click to WhatsApp ads "may remain open for up to 7 days".
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing

### 7.2 Template categories
Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization

- **Utility:** non-promotional ("not containing any promotional or persuasive intent"), and either
  specific to or requested by the user, or essential to them. Meta's examples include a payment
  reminder ("Your monthly payment for {{service}} will be billed on {{date}}...") and an account
  balance update. This is the right category for LeaseGuard's statement, payment reminder and
  arrangement instalment messages, provided they carry no upsell or renewal language. Meta's
  Account Alerts guidance says templates "should not ... attempt to secure renewals", which aligns
  with CLAUDE.md's ban on renewal messages to tenants.
- **Marketing:** flexible and promotional.
- **Authentication:** OTPs only ("Only authentication templates can be used to send a one-time
  passcode").
- **Automatic recategorization:** a utility template can be moved to marketing with 1 day's notice,
  or instantly for accounts with a misuse warning (since April 16, 2025). Appeals are possible
  within 60 days.

### 7.3 Pricing (as documented on 2026-11-10)
Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing

- **Per-message pricing** since July 1, 2025. Only **delivered** messages are charged.
  User-to-business messages are free. Webhooks report `pricing_model: "PMP"`, and `CBP` appears only
  before July 1, 2025.
- Template rates vary by category and recipient country code. Volume tiers apply to utility and
  authentication only, are counted per portfolio, and reset monthly.
- **From October 1, 2026:**
  - Each number gets 1,000 free service messages a month, and service messages are charged from the
    1,001st.
  - **Utility templates inside an open CSW are charged** again (they were free from July 2025).
  - Service rates equal the utility and authentication rates.
  - Government and eligible non-profits keep free service messages beyond the tier until
    December 31, 2027.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages
- Meta Business Agent messages cost USD 2.00 per million tokens, charged from August 1, 2026.
- Billing currency options are USD, EUR, GBP and others. **ZAR is not in the list of 16
  currencies**, and the currency "cannot be changed" once selected. South African rate amounts are
  in the linked rate cards and were not extracted (**unconfirmed**). South Africa's utility and
  authentication rates increased on October 1, 2026.

### 7.4 Opt-in
Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in

- Under the November 2024 Business Messaging Policy update, businesses need opt-in before messaging.
  The opt-in can be general rather than WhatsApp-specific.
- The opt-in must "clearly state that a person is opting in to receive communication from the
  business" and must state "the business's name". The business must comply with applicable law
  (for LeaseGuard, POPIA in South Africa; that is outside Meta's docs).
- The opt-in method is the business's choice: SMS, web, IVR or signed paper forms.
- Provide clear opt-out instructions per message category and honour opt-outs promptly. Best
  practice is a separate opt-in per category.

### 7.5 AI chatbots policy
- **Meta Terms for WhatsApp Business Platform**, "Last Modified: September 23, 2026"
  (https://www.facebook.com/legal/Meta-Terms-for-WhatsApp-Business-Platform; the old URL
  https://www.whatsapp.com/legal/business-solution-terms/ redirects there):
  - §4.7 defines AI Providers as "Providers and developers of artificial intelligence or machine
    learning technologies".
  - They "are strictly prohibited from accessing or using the WhatsApp Business Platform, whether
    directly or indirectly", "when such technologies are the primary (rather than incidental or
    ancillary) functionality being made available for use".
  - "you may retain an AI Provider as your Solution Provider".
  - WhatsApp Business Platform Data may not be used "to create, develop, train, or improve any
    machine learning or artificial intelligence systems", except to "fine-tune an AI Model that is
    for your exclusive use".
  - §1.3 says separate Meta Business Agents terms apply to Business Agents.
- **AI Providers pricing page:** AI Providers "are only permitted to offer general-purpose AI
  assistants on the WhatsApp Business Platform" in markets where Meta is legally required to allow
  it (for example Brazil, and certain EU markets during defined windows). There they are charged per
  service message. The page cites the January 15, 2026 Terms update.
  - https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers
- **For LeaseGuard:** a lease-monitoring product that might use AI incidentally (drafting reminders,
  classifying replies) is not an "AI Provider" whose primary function is AI. But a general-purpose
  AI assistant exposed to tenants over WhatsApp would breach §4.7 in South Africa. Do not use
  WhatsApp message data to train models. The legal interpretation is **unconfirmed** and needs
  review by counsel.
- The `ai-enabled-numbers` page listed in Meta's docs index returned "Page Not Found"
  (**unconfirmed**).

## What can be built before Meta approval

- [ ] Frontend "Connect WhatsApp" button: load the JS SDK, call `FB.login` with
  `config_id`/`response_type: 'code'`/`override_default_response_type: true`/`extras.version`, and
  add a `message` listener with an origin check. Mock the SDK in tests.
- [ ] Session-info parser types for both v4 payloads (`waba_id`) and v5 payloads
  (`messaging_account_ids[]`, `is_on_biz_app`), with all FINISH variants, CANCEL `current_step` and
  ERROR fields. Validate with Zod.
- [ ] Handle FINISH without a code (popup closed on the last screen).
- [ ] Backend endpoint that receives the code and exchanges it immediately (30-second TTL), with
  the Graph API version pinned in config (v27.0).
- [ ] Encrypted token storage per company (opaque, variable-length), plus a `debug_token` health
  check using `granular_scopes[].target_ids`.
- [ ] Onboarding state machine: code exchanged, then subscribed_apps, then register (respecting the
  10 per 72 hours limit and error 133016), then awaiting payment method, then active. Include
  failure and revoked states.
- [ ] Webhook endpoint: GET handshake, raw-body HMAC-SHA256 verification with constant-time compare,
  fast 200, async processing, idempotent dedup on message and status IDs, and tolerance for 7 days
  of retries and batches of up to 1,000.
- [ ] Routing by `metadata.phone_number_id` to `companyId`. Identify users by BSUID (`user_id`),
  with phone as an optional attribute.
- [ ] Handlers for `account_update` (`PARTNER_APP_INSTALLED`, `PARTNER_APP_UNINSTALLED`, removal,
  restrictions), `message_template_status_update` and `phone_number_quality_update`.
- [ ] CSW tracker per tenant conversation, so free-form replies are allowed only within 24 hours of
  the last inbound message and templates are used otherwise.
- [ ] Template catalogue model (utility category, statement and reminder templates, no renewal or
  escalation content), consistent with CLAUDE.md tenant-message rules.
- [ ] Opt-in capture and opt-out records per tenant and category, naming the property-management
  business.
- [ ] Settings UI for connection status: phone number, verified name, quality rating, name status,
  messaging limit, and a "payment method required" banner.
- [ ] End-to-end testing with your own business, users with app roles, and 30-day sandbox accounts
  under Standard Access.

## What needs Meta approval or external configuration

- [ ] Meta Business Verification of Nexus Solution's business portfolio.
- [ ] Meta app (Business type) with the WhatsApp use case, icon, privacy policy and category.
- [ ] Facebook Login for Business configuration (Embedded Signup variation, Cloud API product),
  giving the configuration ID.
- [ ] Client OAuth settings: allowed domains and valid OAuth redirect URIs for every HTTPS
  environment, with the required toggles on.
- [ ] App Review with Advanced Access for `whatsapp_business_management` and
  `whatsapp_business_messaging` (one screen recording plus description per permission).
- [ ] Access Verification (requirements **unconfirmed**) to raise onboarding from 10 to 200 per
  rolling 7 days.
- [ ] Webhook callback URL and verify token in App Dashboard > WhatsApp > Configuration, with
  fields subscribed, a valid public TLS certificate and optional mTLS.
- [ ] App secret and app ID held server-side only.
- [ ] Each client adds a payment method in WhatsApp Manager. Service messages stop without one
  (since October 1, 2026), and the client chooses its billing currency (no ZAR option).
- [ ] Template approval by Meta for each client's Messaging account.
- [ ] Optional: Deauthorize Callback URL and Data Deletion callback in the App Dashboard.
- [ ] Legal review of the AI-provider clause (§4.7) and POPIA opt-in wording.
- [ ] Planning for Phase 2 (H1 2027) and Phase 3 (H1 2028) of the account model: WAAC IDs and
  `messaging_account_id`.
