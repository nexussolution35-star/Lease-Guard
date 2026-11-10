import { describe, expect, it } from 'vitest'

import { Authenticated, CompanyScoped, WRITER_ROLES } from './company-scoped.decorator'

class Routes {
  @Authenticated()
  me(): void {}

  @CompanyScoped()
  list(): void {}

  @CompanyScoped({ roles: WRITER_ROLES })
  approve(): void {}
}

@CompanyScoped()
class ScopedController {
  list(): void {}
}

/** @nestjs/swagger's metadata key for `ApiSecurity`/`ApiBearerAuth` (DECORATORS.API_SECURITY; not exported). */
const API_SECURITY = 'swagger/apiSecurity'

function securityOf(target: object): unknown {
  return Reflect.getMetadata(API_SECURITY, target)
}

describe('OpenAPI security of the access decorators', () => {
  it('documents a signed-in route with the bearer token only', () => {
    expect(securityOf(Routes.prototype.me)).toEqual([{ bearer: [] }])
  })

  it('documents a company-scoped route as ONE requirement needing both the token and the company header', () => {
    expect(securityOf(Routes.prototype.list)).toEqual([{ bearer: [], company: [] }])
    expect(securityOf(Routes.prototype.approve)).toEqual([{ bearer: [], company: [] }])
    expect(securityOf(ScopedController)).toEqual([{ bearer: [], company: [] }])
  })
})
