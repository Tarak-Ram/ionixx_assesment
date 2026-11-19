import { Module } from '@nestjs/common';
import { DefaultPricingProvider } from './default-pricing.provider';
import { PRICING_PROVIDER } from './pricing-provider.interface';

@Module({
  providers: [{ provide: PRICING_PROVIDER, useClass: DefaultPricingProvider }],
  exports: [PRICING_PROVIDER],
})
export class PricingModule {}
