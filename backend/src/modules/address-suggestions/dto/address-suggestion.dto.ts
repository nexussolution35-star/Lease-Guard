import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { SA_PROVINCES, type SAProvince } from '@leaseguard/domain'
import type { z } from 'zod'

import { assertSchemaMatchesDto } from '../../../common/pipes/zod-validation.pipe'
import type { addressResolveBodySchema, addressSearchBodySchema } from '../address-suggestions.schemas'
import type { SuggestedAddress } from '../google-address'
import type { AddressSuggestion } from '../google-places.client'

export class AddressSuggestionsStatusDto {
  @ApiProperty({ description: 'False when the deployment has no Google Maps key: address fields are plain inputs' }) available!: boolean
}

export class AddressSearchDto {
  @ApiProperty({ minLength: 3, maxLength: 200, description: 'The address text typed so far' }) input!: string
  @ApiProperty({ pattern: '^[A-Za-z0-9_-]{16,64}$', description: 'One per lookup (a UUID); the same token for the searches and the resolve' })
  sessionToken!: string
}

export class AddressResolveDto {
  @ApiProperty({ description: 'The placeId of a suggestion' }) placeId!: string
  @ApiProperty({ pattern: '^[A-Za-z0-9_-]{16,64}$' }) sessionToken!: string
}

export class AddressSuggestionDto implements AddressSuggestion {
  @ApiProperty() placeId!: string
  @ApiProperty({ description: 'The place, e.g. "Sandton City"' }) primary!: string
  @ApiPropertyOptional({ description: 'Where it is, e.g. "Rivonia Road, Sandhurst, Sandton"' }) secondary?: string
}

export class AddressSuggestionListDto {
  @ApiProperty({ type: [AddressSuggestionDto] }) suggestions!: AddressSuggestionDto[]
}

/** The address of a chosen suggestion; parts Google does not know are absent. */
export class SuggestedAddressDto implements SuggestedAddress {
  @ApiProperty({ description: 'Street number and name, or the place name' }) line1!: string
  @ApiPropertyOptional() suburb?: string
  @ApiPropertyOptional() city?: string
  @ApiPropertyOptional({ enum: SA_PROVINCES, enumName: 'SAProvince' }) province?: SAProvince
  @ApiPropertyOptional({ pattern: '^[0-9]{4}$' }) postalCode?: string
}

assertSchemaMatchesDto<z.infer<typeof addressSearchBodySchema>, AddressSearchDto>(true)
assertSchemaMatchesDto<z.infer<typeof addressResolveBodySchema>, AddressResolveDto>(true)
