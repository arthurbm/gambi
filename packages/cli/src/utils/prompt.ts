import { cancel, isCancel } from "@clack/prompts";

export function isInteractive(): boolean {
  return !!process.stdin.isTTY && !!process.stdout.isTTY;
}

export function handleCancel(value: unknown): void {
  if (isCancel(value)) {
    cancel("Operation cancelled.");
    process.exit(0);
  }
}

export function hasExplicitFlags(): boolean {
  const args = process.argv.slice(2);
  // First arg is the command name, check if there are more args after it
  return args.length > 1;
}

export const LLM_PROVIDERS = [
  { name: "Ollama", port: 11_434 },
  { name: "LM Studio", port: 1234 },
  { name: "vLLM", port: 8000 },
] as const;
