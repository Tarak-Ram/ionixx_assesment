import { Inject, Injectable } from '@nestjs/common';
import { OrderNotFoundError } from '../../../common/errors/domain.errors';
import { Principal } from '../../auth/auth-strategy.interface';
import { Order } from '../domain/order.entity';
import { ORDER_REPOSITORY, OrderRepository, Page } from '../domain/order.repository';

@Injectable()
export class GetOrderHistoryUseCase {
  constructor(@Inject(ORDER_REPOSITORY) private readonly repository: OrderRepository) {}

  list(principal: Principal, options: { limit: number; offset: number }): Promise<Page<Order>> {
    return this.repository.findAll(principal.partnerId, options);
  }

  async getById(id: string, principal: Principal): Promise<Order> {
    const order = await this.repository.findById(id, principal.partnerId);
    if (!order) throw new OrderNotFoundError(id);
    return order;
  }
}
