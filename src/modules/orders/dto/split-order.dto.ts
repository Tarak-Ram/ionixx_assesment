import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import {
  IsIanaTimeZone,
  IsPositiveDecimal,
  IsPriceMap,
  SYMBOL_PATTERN,
} from '../../../common/validators/decimal.validators';
import { OrderType } from '../domain/order.entity';

export class PortfolioItemDto {
  @ApiProperty({
    example: 'AAPL',
    description: 'Stock symbol (case-insensitive, unique per portfolio)',
  })
  @IsString()
  @Matches(SYMBOL_PATTERN, { message: 'symbol must be 1-10 letters (A-Z, "." or "-" allowed)' })
  symbol!: string;

  @ApiProperty({
    example: 60,
    description: 'Weight as a percentage (60 = 60%). Must be > 0; all weights sum to 100.',
  })
  @IsPositiveDecimal({ maxDecimals: 4, max: 100 })
  weight!: number | string;
}

export class SplitOrderDto {
  @ApiProperty({ enum: OrderType, example: OrderType.BUY })
  @IsEnum(OrderType, { message: 'type must be one of: BUY, SELL' })
  type!: OrderType;

  @ApiProperty({
    example: 100,
    description: 'Total USD amount to buy or sell (max 2 decimal places)',
  })
  @IsPositiveDecimal({ maxDecimals: 2 })
  totalAmount!: number | string;

  @ApiProperty({ type: [PortfolioItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PortfolioItemDto)
  portfolio!: PortfolioItemDto[];

  @ApiPropertyOptional({
    example: { AAPL: 187.5 },
    description: 'Optional market prices; take priority over the default price for those symbols',
  })
  @IsOptional()
  @IsPriceMap()
  marketPrices?: Record<string, number | string>;

  @ApiPropertyOptional({
    example: 'America/New_York',
    description: 'IANA timezone used to decide the market weekday (defaults to MARKET_TIMEZONE)',
  })
  @IsOptional()
  @IsIanaTimeZone()
  timezone?: string;
}
