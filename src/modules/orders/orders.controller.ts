import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiCreatedResponse,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { API_PREFIX } from '../../common/http/api-prefix';
import { IdempotencyKey } from '../../common/http/idempotency-key.decorator';
import { uuidParamPipe } from '../../common/http/uuid-param.pipe';
import { Principal } from '../auth/auth-strategy.interface';
import { CurrentPartner, RequireScopes } from '../auth/auth.decorators';
import { GetOrderHistoryUseCase } from './application/get-order-history.use-case';
import { SplitOrderUseCase } from './application/split-order.use-case';
import { ListOrdersQuery } from './dto/list-orders.query';
import { OrderListResponse, OrderResponse, toOrderResponse } from './dto/order.response';
import { SplitOrderDto } from './dto/split-order.dto';

@ApiTags('orders')
@ApiSecurity('api-key')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly splitOrder: SplitOrderUseCase,
    private readonly history: GetOrderHistoryUseCase,
  ) {}

  @Post('split')
  @RequireScopes('orders:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Split a BUY/SELL amount across a model portfolio and schedule it' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Makes retries safe: repeating the same key and body returns the original order ' +
      '(header `Idempotent-Replayed: true`) instead of creating a duplicate.',
  })
  @ApiCreatedResponse({
    type: OrderResponse,
    description: 'Order calculated and stored in history',
  })
  @ApiResponse({ status: 400, description: 'Malformed request body' })
  @ApiResponse({
    status: 422,
    description:
      'Business rule violated (e.g. weights do not sum to 100) or Idempotency-Key reused with a different body',
  })
  async split(
    @Body() dto: SplitOrderDto,
    @CurrentPartner() principal: Principal,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderResponse> {
    const { order, replayed } = await this.splitOrder.submit(dto, principal, idempotencyKey);
    res.location(`/${API_PREFIX}/orders/${order.id}`);
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return toOrderResponse(order);
  }

  @Get()
  @RequireScopes('orders:read')
  @ApiOperation({ summary: 'List historic orders (newest first)' })
  @ApiOkResponse({ type: OrderListResponse })
  async list(
    @Query() query: ListOrdersQuery,
    @CurrentPartner() principal: Principal,
  ): Promise<OrderListResponse> {
    const { items, total } = await this.history.list(principal, query);
    return { data: items.map(toOrderResponse), total, limit: query.limit, offset: query.offset };
  }

  @Get(':id')
  @RequireScopes('orders:read')
  @ApiOperation({ summary: 'Get one historic order' })
  @ApiOkResponse({ type: OrderResponse })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async get(
    @Param('id', uuidParamPipe('id')) id: string,
    @CurrentPartner() principal: Principal,
  ): Promise<OrderResponse> {
    return toOrderResponse(await this.history.getById(id, principal));
  }
}
