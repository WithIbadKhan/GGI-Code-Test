export interface ClientSessionProps {
  id: string;
  userId: string;
  /** SHA-256 of the access token the session is bound to. */
  tokenFingerprint: string;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * A short-lived session that binds one access token to a request-signing key.
 * It never outlives the token it was created with.
 */
export class ClientSession {
  private constructor(private readonly props: ClientSessionProps) {}

  static start(input: {
    id: string;
    userId: string;
    tokenFingerprint: string;
    now: Date;
    expiresAt: Date;
  }): ClientSession {
    return new ClientSession({
      id: input.id,
      userId: input.userId,
      tokenFingerprint: input.tokenFingerprint,
      createdAt: input.now,
      expiresAt: input.expiresAt,
    });
  }

  static restore(props: ClientSessionProps): ClientSession {
    return new ClientSession({ ...props });
  }

  /** A session is only usable by the same user presenting the same access token, before it expires. */
  isUsableBy(userId: string, tokenFingerprint: string, now: Date): boolean {
    return (
      now < this.props.expiresAt &&
      this.props.userId === userId &&
      this.props.tokenFingerprint === tokenFingerprint
    );
  }

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get tokenFingerprint(): string {
    return this.props.tokenFingerprint;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get expiresAt(): Date {
    return this.props.expiresAt;
  }
}
