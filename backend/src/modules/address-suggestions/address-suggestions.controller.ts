import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiResponse, ApiServiceUnavailableResponse, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger'

import { Authenticated } from '../../common/decorators/company-scoped.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { ApiErrorDto } from '../../common/http/api-error.dto'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { AuthenticatedUser } from '../../common/request-context'
import { addressResolveBodySchema, addressSearchBodySchema } from './address-suggestions.schemas'
import { AddressSuggestionsService } from './address-suggestions.service'
import {
  AddressResolveDto,
  AddressSearchDto,
  AddressSuggestionListDto,
  AddressSuggestionsStatusDto,
  SuggestedAddressDto,
} from './dto/address-suggestion.dto'

/**
 * Address suggestions (South Africa) for signed-in users. LeaseGuard calls Google Places with a server-only key; the
 * browser never sees it. Searches use POST so typed addresses stay out of URLs and access logs.
 */
@ApiTags('address-suggestions')
@Controller('address-suggestions')
export class AddressSuggestionsController {
  constructor(private readonly suggestions: AddressSuggestionsService) {}

  @Get('status')
  @Authenticated()
  @ApiOperation({ operationId: 'getAddressSuggestionsStatus', summary: 'Whether address suggestions are available' })
  @ApiOkResponse({ type: AddressSuggestionsStatusDto })
  status(): AddressSuggestionsStatusDto {
    return this.suggestions.status()
  }

  @Post()
  @Authenticated()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'searchAddresses',
    summary: 'Suggest South African addresses for the text typed so far',
    description: 'Per user: 30 a minute and 600 a day; refusals are 429 with Retry-After.',
  })
  @ApiOkResponse({ type: AddressSuggestionListDto })
  @ApiTooManyRequestsResponse({ type: ApiErrorDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Not set up, Google unavailable, or the limits cannot be checked' })
  async search(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(addressSearchBodySchema)) body: AddressSearchDto,
  ): Promise<AddressSuggestionListDto> {
    return { suggestions: await this.suggestions.search(user.userId, body) }
  }

  @Post('resolve')
  @Authenticated()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'resolveAddress',
    summary: 'The address of a chosen suggestion',
    description: 'Ends the lookup session. Per user: 10 a minute and 150 a day; refusals are 429 with Retry-After.',
  })
  @ApiOkResponse({ type: SuggestedAddressDto })
  @ApiResponse({ status: 429, type: ApiErrorDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto })
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(addressResolveBodySchema)) body: AddressResolveDto,
  ): Promise<SuggestedAddressDto> {
    return this.suggestions.resolve(user.userId, body)
  }
}
