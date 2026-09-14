import type { ConversationInput, ConversationLineage, MessageInput } from "./types.js";

/**
 * Building the conversation that results from continuing a handoff.
 *
 * There are two ways to continue, and they produce different lineage. Getting
 * that difference wrong is not a visible failure: the conversation saves, the
 * response looks right, and the chain only breaks later when someone tries to
 * walk it. That has happened twice in this repository already, both times
 * because lineage was assembled inline at a call site where nothing checked it.
 * So it is assembled here, once, and tested.
 *
 * The rule that matters: an id is only meaningful on the instance that issued
 * it. parentId names a row. When the parent is in this database, pointing at it
 * is correct and useful. When the parent is on someone else's machine, copying
 * its id produces lineage aimed at a row this instance has never seen, which is
 * worse than no lineage because it reads as though it resolves.
 *
 * rootId is the exception, and the reason the whole thing works. It identifies
 * the chain rather than a row, so every copy on every instance carries the same
 * one, and any instance holding the original can still find it after the
 * conversation has been round-tripped through machines it does not know about.
 */

/**
 * The parent, at the level both paths need it.
 *
 * Deliberately not `Conversation`: the local path passes a stored conversation
 * and the remote path passes what came off the wire, which has no local id yet.
 * Asking for only the fields carried forward lets both through without a cast,
 * and stops this module from depending on whether the parent exists here.
 */
interface ContinuationParent {
  title: string;
  summary?: string;
  participants?: string[];
  tags?: string[];
  messages: MessageInput[];
  lineage?: ConversationLineage;
}

/** What the two paths share: the same conversation, carried forward. */
interface ContinuationBase {
  parent: ContinuationParent;
  provider: string;
  app?: string;
  title?: string;
  messages: MessageInput[];
}

export interface LocalContinuation extends ContinuationBase {
  /** The parent row in this database. */
  parentId: string;
  /** The handoff redeemed to get here, also from this database. */
  handoffId: string;
}

export interface RemoteContinuation extends ContinuationBase {
  origin: { instance: string; handoffId?: string; conversationId?: string };
  importedAt?: string;
}

/**
 * Continuing a handoff minted by this instance. The parent row is local, so the
 * continuation points straight at it and the root falls back to the parent when
 * the parent is itself the start of the chain.
 */
export function localContinuation(options: LocalContinuation): ConversationInput {
  return {
    ...shared(options),
    lineage: {
      parentId: options.parentId,
      rootId: options.parent.lineage?.rootId ?? options.parentId,
      handoffId: options.handoffId,
      continuedBy: options.provider,
    },
  };
}

/**
 * Continuing someone else's link. No parentId: see the note above. The origin
 * fields are what name the parent here, and they only mean anything together,
 * since a conversation id without the instance that issued it is not an address.
 */
export function remoteContinuation(options: RemoteContinuation): ConversationInput {
  return {
    ...shared(options),
    lineage: {
      rootId: options.parent.lineage?.rootId ?? options.origin.conversationId,
      originInstance: options.origin.instance,
      originConversationId: options.origin.conversationId,
      handoffId: options.origin.handoffId,
      importedAt: options.importedAt ?? new Date().toISOString(),
      continuedBy: options.provider,
    },
  };
}

function shared(options: ContinuationBase): Omit<ConversationInput, "lineage"> {
  return {
    title: options.title || `${options.parent.title} (continued in ${options.provider})`,
    summary: options.parent.summary,
    source: { provider: options.provider, app: options.app },
    participants: options.parent.participants,
    // A Set rather than a push, because continuing a continuation would
    // otherwise accumulate the tag once per hop.
    tags: [...new Set([...(options.parent.tags ?? []), "continuation"])],
    // Parent messages first, then the new ones. The whole point of a handoff is
    // that the recipient reads what came before, so the continuation carries the
    // transcript rather than referring to it.
    messages: [...options.parent.messages, ...options.messages],
  };
}
