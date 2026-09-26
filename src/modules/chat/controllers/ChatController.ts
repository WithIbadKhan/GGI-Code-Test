import type { Request, Response } from 'express';
import { currentActor } from '../../../shared/http/middleware/authenticate.js';
import { requestIdOf } from '../../../shared/http/requestId.js';
import { parseInput } from '../../../shared/http/validation.js';
import type { ChatService } from '../domain/services/ChatService.js';
import { presentMessage, presentUsage } from './chat.presenter.js';
import {
  askQuestionSchema,
  listMessagesQuerySchema,
  messageIdParamsSchema,
  usageQuerySchema,
} from './chat.schemas.js';

/**
 * Thin HTTP adapter: validate input, call the use case, shape the response.
 * No business rules live here.
 */
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /** POST /api/v1/chat/messages */
  ask = async (req: Request, res: Response): Promise<void> => {
    const actor = currentActor(req);
    const body = parseInput(askQuestionSchema, req.body);

    const message = await this.chatService.ask(actor, {
      question: body.question,
      requestId: requestIdOf(req),
    });

    res.status(201).location(`/api/v1/chat/messages/${message.id}`).json(presentMessage(message));
  };

  /** GET /api/v1/chat/messages */
  list = async (req: Request, res: Response): Promise<void> => {
    const actor = currentActor(req);
    const query = parseInput(listMessagesQuerySchema, req.query);

    const messages = await this.chatService.listMessages(actor, query);

    res.json({
      data: messages.map(presentMessage),
      pagination: { limit: query.limit, offset: query.offset, count: messages.length },
    });
  };

  /** GET /api/v1/chat/messages/:id */
  getById = async (req: Request, res: Response): Promise<void> => {
    const actor = currentActor(req);
    const { id } = parseInput(messageIdParamsSchema, req.params);

    const message = await this.chatService.getMessage(actor, id);

    res.json(presentMessage(message));
  };

  /** GET /api/v1/chat/usage */
  usage = async (req: Request, res: Response): Promise<void> => {
    const actor = currentActor(req);
    const query = parseInput(usageQuerySchema, req.query);

    const summary = await this.chatService.getUsage(actor, query.userId);

    res.json(presentUsage(summary));
  };
}
