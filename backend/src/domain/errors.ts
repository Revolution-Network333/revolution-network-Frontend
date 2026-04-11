// src/domain/errors.ts

export class DomainError extends Error {
  constructor(public message: string, public statusCode: number = 400) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message: string = 'Accès non autorisé') {
    super(message, 401);
  }
}

export class JobNotFoundError extends DomainError {
  constructor(jobId: string) {
    super(`Job ${jobId} non trouvé`, 404);
  }
}

export class IllegalStateTransitionError extends DomainError {
  constructor(message: string) {
    super(message, 500); // 500 car critique
  }
}

export class UnknownJobTypeError extends DomainError {
  constructor(public type: string) {
    super(`Type de job inconnu : ${type}`, 400);
  }
}

export class InsufficientCreditsError extends DomainError {
  constructor(public balance: number, public required: number) {
    super(`Crédits insuffisants (Solde: ${balance}, Requis: ${required})`, 402);
  }
}

export class MeteringError extends DomainError {
  constructor(message: string) {
    super(message, 500);
  }
}

export class JobNotSettlableError extends DomainError {
  constructor(jobId: string) {
    super(`Le job ${jobId} ne peut pas être réglé (status invalide)`, 400);
  }
}

export class QueueFullError extends DomainError {
  constructor(nodeType: string) {
    super(`La file d'attente pour ${nodeType} est pleine`, 503);
  }
}

export class AccessDeniedError extends DomainError {
  constructor() {
    super('Accès refusé', 403);
  }
}

export class NoAvailableNodeError extends DomainError {
  constructor(nodeType: string) {
    super(`Aucun node disponible pour le type: ${nodeType}`, 503);
  }
}

export class ValidationError extends DomainError {
  constructor(public details: unknown) {
    super('Erreur de validation', 400);
  }
}
