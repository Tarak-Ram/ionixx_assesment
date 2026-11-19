import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Documents the single error body every failure returns (see AllExceptionsFilter). */
export class ErrorResponse {
  @ApiProperty({ example: 422 }) statusCode!: number;
  @ApiProperty({ example: 'Unprocessable Entity' }) error!: string;
  @ApiProperty({ example: 'INVALID_WEIGHT_TOTAL', description: 'Stable, machine-readable code' })
  code!: string;
  @ApiProperty({ example: 'Portfolio weights must add up to 100 (received 90)' }) message!: string;
  @ApiPropertyOptional({ description: 'Extra context, e.g. the list of validation problems' })
  details?: unknown;
  @ApiPropertyOptional({ example: '3b0c8f1e-5a2d-4c7e-9b61-0f2d7e8a1c44' }) correlationId?: string;
  @ApiProperty({ example: '2026-11-16T10:00:00.000Z' }) timestamp!: string;
  @ApiProperty({ example: '/api/v1/orders/split' }) path!: string;
}
