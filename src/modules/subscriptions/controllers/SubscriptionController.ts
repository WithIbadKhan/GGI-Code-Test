import type { Request, Response } from 'express';
import { currentActor } from '../../../shared/http/middleware/authenticate.js';
import { parseInput } from '../../../shared/http/validation.js';
import type { SubscriptionService } from '../domain/services/SubscriptionService.js';
import { presentSubscription } from './subscription.presenter.js';
import {
  emptyBodySchema,
  listSubscriptionsQuerySchema,
  purchaseSchema,
  subscriptionIdParamsSchema,
  updateSubscriptionSchema,
} from './subscription.schemas.js';

/** Thin HTTP adapter: validate input, call the use case, shape the response. */
export class SubscriptionController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  /** POST /api/v1/subscriptions */
  purchase = async (req: Request, res: Response): Promise<void> => {
    const actor = currentActor(req);
    const body = parseInput(purchaseSchema, req.body);

    const subscription = await this.subscriptions.purchase(actor, body);

    res
      .status(201)
      .location(`/api/v1/subscriptions/${subscription.id}`)
      .json(presentSubscription(subscription, new Date()));
  };

  /** GET /api/v1/subscriptions */
  list = async (req: Request, res: Response): Promise<void> => {
    const actor = currentActor(req);
    const query = parseInput(listSubscriptionsQuerySchema, req.query);

    const subscriptions = await this.subscriptions.list(actor, query);

    const now = new Date();
    res.json({
      data: subscriptions.map((s) => presentSubscription(s, now)),
      pagination: { limit: query.limit, offset: query.offset, count: subscriptions.length },
    });
  };

  /** GET /api/v1/subscriptions/:id */
  getById = async (req: Request, res: Response): Promise<void> => {
    const actor = currentActor(req);
    const { id } = parseInput(subscriptionIdParamsSchema, req.params);

    const subscription = await this.subscriptions.get(actor, id);

    res.json(presentSubscription(subscription, new Date()));
  };

  /** PATCH /api/v1/subscriptions/:id */
  update = async (req: Request, res: Response): Promise<void> => {
    const actor = currentActor(req);
    const { id } = parseInput(subscriptionIdParamsSchema, req.params);
    const body = parseInput(updateSubscriptionSchema, req.body);

    const subscription = await this.subscriptions.setAutoRenew(actor, id, body.autoRenew);

    res.json(presentSubscription(subscription, new Date()));
  };

  /** POST /api/v1/subscriptions/:id/cancel */
  cancel = async (req: Request, res: Response): Promise<void> => {
    const actor = currentActor(req);
    const { id } = parseInput(subscriptionIdParamsSchema, req.params);
    parseInput(emptyBodySchema, req.body ?? {});

    const subscription = await this.subscriptions.cancel(actor, id);

    res.json(presentSubscription(subscription, new Date()));
  };
}
