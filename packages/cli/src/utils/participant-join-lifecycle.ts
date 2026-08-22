import { password as passwordPrompt, text } from "@clack/prompts";
import { nanoid } from "nanoid";

import { handleCancel } from "./prompt.ts";

export interface JoinScope {
  participantId?: string;
  room?: string;
}

export interface JoinIdentity {
  nickname?: string;
  password?: string;
}

interface JoinSessionCloseEvent {
  error?: Error;
  reason: string;
}

interface JoinSession {
  close: () => Promise<unknown>;
  waitUntilClosed: () => Promise<JoinSessionCloseEvent>;
}

export async function resolveJoinScope(input: {
  interactive: boolean;
  participantId?: string;
  room?: string;
}): Promise<JoinScope> {
  let { participantId, room } = input;
  if (!input.interactive) {
    return { participantId, room };
  }
  if (!room) {
    const result = await text({ message: "Room code:" });
    handleCancel(result);
    room = String(result).trim();
  }
  if (!participantId) {
    const result = await text({
      message: "Participant ID:",
      placeholder: nanoid(8),
    });
    handleCancel(result);
    participantId = String(result).trim();
  }
  return { participantId, room };
}

export async function resolveJoinIdentity(input: {
  interactive: boolean;
  nickname?: string;
  nicknameLabel: string;
  nicknamePlaceholder: string;
  password?: string;
}): Promise<JoinIdentity> {
  let { nickname, password } = input;
  if (!input.interactive) {
    return { nickname, password };
  }
  if (nickname === undefined) {
    const result = await text({
      message: input.nicknameLabel,
      placeholder: input.nicknamePlaceholder,
    });
    handleCancel(result);
    const value = String(result).trim();
    if (value) {
      nickname = value;
    }
  }
  if (password === undefined) {
    const result = await passwordPrompt({
      message: "Room password (leave empty if none):",
    });
    handleCancel(result);
    const value = String(result).trim();
    if (value) {
      password = value;
    }
  }
  return { nickname, password };
}

export function waitForJoinSession(input: {
  onFailure: (result: JoinSessionCloseEvent) => void;
  onInternalError: (error: unknown) => void;
  onLeaving: (signal: "SIGINT" | "SIGTERM") => void;
  onSuccess: () => void;
  session: JoinSession;
}): Promise<number> {
  return new Promise<number>((resolve) => {
    const signalProcess = process as unknown as {
      off: (signal: "SIGINT" | "SIGTERM", listener: () => void) => void;
      once: (signal: "SIGINT" | "SIGTERM", listener: () => void) => void;
    };
    let closing = false;
    const cleanup = () => {
      signalProcess.off("SIGINT", onSigint);
      signalProcess.off("SIGTERM", onSigterm);
    };
    const shutdown = (signal: "SIGINT" | "SIGTERM") => {
      if (closing) {
        return;
      }
      closing = true;
      input.onLeaving(signal);
      input.session.close().catch(() => undefined);
    };
    const onSigint = () => shutdown("SIGINT");
    const onSigterm = () => shutdown("SIGTERM");
    signalProcess.once("SIGINT", onSigint);
    signalProcess.once("SIGTERM", onSigterm);

    input.session.waitUntilClosed().then(
      (result) => {
        cleanup();
        if (result.reason === "closed") {
          input.onSuccess();
          resolve(0);
          return;
        }
        input.onFailure(result);
        resolve(3);
      },
      (error) => {
        cleanup();
        input.onInternalError(error);
        resolve(1);
      }
    );
  });
}
