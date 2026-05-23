import { ipc } from "../ipc/bridge";
import type { SessionStore } from "../state/session-store";

export interface SlashContext {
  store: SessionStore;
  model: string;
  effort: string;
  setModel: (m: string) => void;
  setEffort: (e: string) => void;
}

/**
 * Dispatcher for slash commands that need client-side behavior.
 *
 * The claude CLI processes most slash commands itself when it receives them
 * as stream-json user messages (e.g. `/context`, `/cost`, `/help`, `/agents`).
 * Those should fall through to the normal send path — claude will emit a
 * synthetic assistant message with the real output.
 *
 * Only commands with UI semantics that claude can't perform (clearing the
 * CCShell message store) or that need to respawn the underlying child
 * (switching model mid-chat) are intercepted here.
 *
 * Returns true if the command was handled locally; false to pass through.
 */
export async function dispatchSlash(
  text: string,
  ctx: SlashContext,
): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return false;
  const body = trimmed.slice(1);
  const spaceIdx = body.search(/\s/);
  const name = spaceIdx === -1 ? body : body.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? "" : body.slice(spaceIdx + 1).trim();

  if (name === "clear") {
    ctx.store.reset();
    return true;
  }

  if (name === "model") {
    // `/model` with no arg → let claude show its model picker output
    if (!args) return false;
    ctx.store.appendUserMessage(trimmed);
    ctx.setModel(args);
    try {
      ctx.store.markRespawning();
      await ipc.switchModel(ctx.store.id, args);
      ctx.store.appendSyntheticAssistant(
        `Model switched to ${args}. Conversation history preserved via --resume.`,
      );
    } catch (err) {
      ctx.store.appendSyntheticAssistant(
        `Failed to switch model: ${String(err)}`,
      );
    }
    return true;
  }

  return false;
}
