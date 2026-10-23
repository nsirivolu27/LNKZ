export type ToolKind = 'read' | 'write';

export type Tool = {
  name: string;
  description: string;
  kind: ToolKind;
  context?: string;
};

export type ToolGroup = {
  slug: string;
  index: string;
  label: string;
  tools: Tool[];
};

export const toolGroups: ToolGroup[] = [
  {
    slug: 'saving-importing',
    index: 'A',
    label: 'SAVING & IMPORTING',
    tools: [
      { name: 'save_conversation', description: 'Save a conversation to your relay.', kind: 'write' },
      { name: 'save_message', description: 'Append one message to a saved conversation.', kind: 'write' },
      { name: 'import_from_url', description: 'Import a handoff from a link and retain its origin.', kind: 'write', context: 'takes a copy and records the origin' },
      { name: 'import_transcript', description: 'Bring a transcript into a new relay conversation.', kind: 'write' },
      { name: 'get_conversation', description: 'Read a conversation by its identifier.', kind: 'read' },
    ],
  },
  {
    slug: 'finding',
    index: 'B',
    label: 'FINDING',
    tools: [
      { name: 'list_conversations', description: 'List conversations available on your relay.', kind: 'read' },
      { name: 'search_conversations', description: 'Find saved conversations by text or metadata.', kind: 'read' },
      { name: 'get_message', description: 'Read one message from a conversation.', kind: 'read' },
      { name: 'get_handoff', description: 'Inspect a handoff and its boundary settings.', kind: 'read' },
      { name: 'preview_handoff', description: 'Check a handoff before using it.', kind: 'read', context: 'costs nothing, spends no use, never returns the transcript' },
    ],
  },
  {
    slug: 'packaging',
    index: 'C',
    label: 'PACKAGING',
    tools: [
      { name: 'create_context_packet', description: 'Create a bounded packet from selected context.', kind: 'write' },
      { name: 'add_to_context_packet', description: 'Add a conversation or message to a packet.', kind: 'write' },
      { name: 'remove_from_context_packet', description: 'Remove an item from a context packet.', kind: 'write' },
      { name: 'preview_context_packet', description: 'Inspect packet shape without publishing it.', kind: 'read' },
      { name: 'export_context_packet', description: 'Export a packet for use in another client.', kind: 'write' },
    ],
  },
  {
    slug: 'moving',
    index: 'D',
    label: 'MOVING BETWEEN PEOPLE',
    tools: [
      { name: 'create_handoff', description: 'Create a bounded handoff from your conversation.', kind: 'write' },
      { name: 'import_handoff', description: 'Accept a handoff into your relay.', kind: 'write' },
      { name: 'continue_from_link', description: 'Continue someone else’s conversation as a new one.', kind: 'write', context: 'continues someone else’s conversation as a new one' },
      { name: 'continue_handoff', description: 'Continue a link minted by your own relay.', kind: 'write', context: 'does the same for a link your own relay minted' },
      { name: 'revoke_handoff', description: 'Stop accepting a handoff you previously minted.', kind: 'write' },
    ],
  },
  {
    slug: 'publishing',
    index: 'E',
    label: 'PUBLISHING',
    tools: [
      { name: 'publish_handoff', description: 'Mint a shareable link with explicit limits.', kind: 'write' },
      { name: 'get_public_link', description: 'Read the current link for a published handoff.', kind: 'read' },
      { name: 'update_handoff_limits', description: 'Change expiry or use limits on your handoff.', kind: 'write' },
      { name: 'delete_handoff', description: 'Delete a handoff from your relay.', kind: 'write' },
    ],
  },
  {
    slug: 'workspace',
    index: 'F',
    label: 'WORKSPACE',
    tools: [
      { name: 'get_workspace', description: 'Read the identity and defaults of your relay.', kind: 'read' },
      { name: 'list_members', description: 'List members who can use this workspace.', kind: 'read' },
      { name: 'invite_member', description: 'Invite a person to a workspace you control.', kind: 'write' },
      { name: 'remove_member', description: 'Remove a member from your workspace.', kind: 'write' },
      { name: 'get_workspace_settings', description: 'Read workspace sharing and scope settings.', kind: 'read' },
    ],
  },
];