import { ApiProperty } from '@nestjs/swagger';
import { Order, OrderType } from '../domain/order.entity';

/**
 * Public response contract. Kept separate from the domain `Order` so internal changes (new
 * fields, storage details) never leak into the API unless `toOrderResponse` opts them in.
 */
export class MarketScheduleResponse {
  @ApiProperty({ example: '2026-11-16', description: 'Execution date (YYYY-MM-DD in `timezone`)' })
  executionDate!: string;
  @ApiProperty({ enum: ['SAME_DAY', 'NEXT_MARKET_DAY'] })
  status!: 'SAME_DAY' | 'NEXT_MARKET_DAY';
  @ApiProperty({ example: 'UTC' })
  timezone!: string;
  @ApiProperty({ example: '2026-11-16T10:00:00.000Z' })
  requestedAt!: string;
}

export class AllocationResponse {
  @ApiProperty({ example: 'AAPL' }) symbol!: string;
  @ApiProperty({ example: '60' }) weightPercent!: string;
  @ApiProperty({ example: '100' }) price!: string;
  @ApiProperty({ enum: ['PARTNER', 'DEFAULT'] }) priceSource!: 'PARTNER' | 'DEFAULT';
  @ApiProperty({ example: '60.00' }) allocatedAmount!: string;
  @ApiProperty({ example: '0.600' }) quantity!: string;
  @ApiProperty({ example: '60.00' }) executableAmount!: string;
}

export class OrderSummaryResponse {
  @ApiProperty({ example: '100.00' }) totalExecutableAmount!: string;
  @ApiProperty({ example: '0.00' }) unusedAmount!: string;
}

export class RoundingResponse {
  @ApiProperty({ example: 3 }) quantityPrecision!: number;
  @ApiProperty({ enum: ['ROUND_DOWN'] }) mode!: 'ROUND_DOWN';
  @ApiProperty() note!: string;
}

export class OrderResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'partner-a' }) partnerId!: string;
  @ApiProperty({ enum: OrderType }) type!: OrderType;
  @ApiProperty({ enum: ['USD'] }) currency!: 'USD';
  @ApiProperty({ example: '100.00' }) totalAmount!: string;
  @ApiProperty({ type: [AllocationResponse] }) allocations!: AllocationResponse[];
  @ApiProperty({ type: OrderSummaryResponse }) summary!: OrderSummaryResponse;
  @ApiProperty({ type: RoundingResponse }) rounding!: RoundingResponse;
  @ApiProperty({ type: MarketScheduleResponse }) schedule!: MarketScheduleResponse;
  @ApiProperty({ enum: ['CALCULATED'] }) status!: 'CALCULATED';
  @ApiProperty({ example: '2026-11-16T10:00:00.000Z' }) createdAt!: string;
  @ApiProperty() notice!: string;
}

export class OrderListResponse {
  @ApiProperty({ type: [OrderResponse] }) data!: OrderResponse[];
  @ApiProperty({ example: 120, description: 'Total orders for this partner' }) total!: number;
  @ApiProperty({ example: 50 }) limit!: number;
  @ApiProperty({ example: 0 }) offset!: number;
}

export function toOrderResponse(order: Order): OrderResponse {
  return {
    id: order.id,
    partnerId: order.partnerId,
    type: order.type,
    currency: order.currency,
    totalAmount: order.totalAmount,
    allocations: order.allocations.map((a) => ({ ...a })),
    summary: { ...order.summary },
    rounding: { ...order.rounding },
    schedule: { ...order.schedule },
    status: order.status,
    createdAt: order.createdAt,
    notice: order.notice,
  };
}
