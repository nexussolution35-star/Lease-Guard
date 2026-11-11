import { Module } from '@nestjs/common'

import { AddressSuggestionsController } from './address-suggestions.controller'
import { AddressSuggestionsService } from './address-suggestions.service'
import { GooglePlacesClient } from './google-places.client'

/** Address suggestions through LeaseGuard's server (Google Places API (New)); the rate limiter is global. */
@Module({ controllers: [AddressSuggestionsController], providers: [AddressSuggestionsService, GooglePlacesClient] })
export class AddressSuggestionsModule {}
