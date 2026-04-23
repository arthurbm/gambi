import { cancel, isCancel } from "@clack/prompts";

export function handleCancel(value: unknown): void {
  if (isCancel(value)) {
    cancel("Operation cancelled.");
    process.exit(0);
  }
}
