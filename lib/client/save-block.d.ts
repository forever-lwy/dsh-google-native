import type { ComposerBlocks } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
/** Keep Send inert until the Host acknowledges options, preserving other owners' blocks. */
export declare function blockWhileSaving(blocks: ComposerBlocks, sessionId: SessionId, reason: string): () => void;
