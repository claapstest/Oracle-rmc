export interface ConversationTurn {
  id: string;
  timestamp: string;
  userQuery: string;
  resolvedQuery?: string;
  targetEntity?: string;
  activeFilters: Record<string, any>;
  lastResultIds: string[];
  lastSqlUsed?: string;
}

export class ConversationContextService {
  private sessions = new Map<string, ConversationTurn[]>();
  private readonly MAX_TURNS_PER_SESSION = 15;

  /**
   * Resolves follow-up queries by replacing relative pronouns and inheriting active filters.
   */
  public resolveContextualQuery(sessionId: string, currentQuery: string): {
    resolvedQuery: string;
    inheritedContext: Record<string, any>;
    historySummary: string;
  } {
    const turns = this.sessions.get(sessionId) || [];
    if (turns.length === 0) {
      return {
        resolvedQuery: currentQuery,
        inheritedContext: {},
        historySummary: ''
      };
    }

    const lastTurn = turns[turns.length - 1];
    let resolved = currentQuery;
    const cleanCurrent = currentQuery.toLowerCase().trim();

    // 1. Resolve relative pronouns pointing to last entity or result set
    if (lastTurn.targetEntity) {
      // "these", "those", "them" -> refer to prior entity collection
      if (/\b(these|those|them)\b/i.test(resolved)) {
        resolved = resolved.replace(/\b(these|those|them)\b/gi, `the previously listed ${lastTurn.targetEntity}`);
      }
      // "it", "this one", "that" -> refer to last specific entity
      if (/\b(it|this one|that)\b/i.test(resolved) && lastTurn.lastResultIds.length > 0) {
        resolved = resolved.replace(/\b(it|this one|that)\b/gi, `${lastTurn.targetEntity} "${lastTurn.lastResultIds[0]}"`);
      }
    }

    // 2. Inherit contextual filters if user supplies incremental refinements
    // e.g. "and only active ones", "filter by department Finance"
    const inherited: Record<string, any> = { ...lastTurn.activeFilters };

    if (cleanCurrent.includes('only active') || cleanCurrent.includes('status active')) {
      inherited.status = 'Active';
    }
    if (cleanCurrent.includes('inactive')) {
      inherited.status = 'Inactive';
    }

    const historySummary = turns
      .slice(-3)
      .map(t => `Q: "${t.userQuery}" -> (Entity: ${t.targetEntity || 'None'}, Filters: ${JSON.stringify(t.activeFilters)})`)
      .join('\n');

    return {
      resolvedQuery: resolved,
      inheritedContext: inherited,
      historySummary
    };
  }

  /**
   * Records a completed turn into conversational memory.
   */
  public recordTurn(sessionId: string, turn: ConversationTurn): void {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, []);
    }
    const list = this.sessions.get(sessionId)!;
    list.push(turn);
    if (list.length > this.MAX_TURNS_PER_SESSION) {
      list.shift();
    }
  }

  /**
   * Clears session history.
   */
  public clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

export const conversationContextService = new ConversationContextService();
