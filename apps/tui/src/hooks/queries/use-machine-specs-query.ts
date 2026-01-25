import { cpus, platform, totalmem } from "node:os";
import { useQuery } from "@tanstack/react-query";
import { $ } from "bun";

// ============================================================================
// Types
// ============================================================================

export interface MachineSpecs {
  cpu: string;
  ram: number;
  gpu?: string;
  vram?: number;
}

interface GPUInfo {
  gpu?: string;
  vram?: number;
}

// ============================================================================
// GPU Detection
// ============================================================================

const LSPCI_GPU_REGEX = /: (.+)$/m;
const MACOS_CHIP_REGEX = /Chip(?:set)? Model: (.+)/;
const MACOS_VRAM_REGEX = /VRAM.*?: (\d+)/;

async function detectLinuxGPU(): Promise<GPUInfo> {
  try {
    const result =
      await $`nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits`
        .text()
        .catch(() => null);

    if (result) {
      const parts = result.trim().split(", ");
      const name = parts[0];
      const vramMB = parts[1];
      if (name && vramMB) {
        return {
          gpu: name,
          vram: Math.round(Number.parseInt(vramMB, 10) / 1024),
        };
      }
    }
  } catch {
    // nvidia-smi not available
  }

  const lspci = await $`lspci 2>/dev/null | grep -i 'vga\\|3d\\|display'`
    .text()
    .catch(() => null);

  if (lspci) {
    const match = lspci.match(LSPCI_GPU_REGEX);
    if (match?.[1]) {
      return { gpu: match[1].trim() };
    }
  }

  return {};
}

async function detectMacOSGPU(): Promise<GPUInfo> {
  const result = await $`system_profiler SPDisplaysDataType 2>/dev/null`
    .text()
    .catch(() => null);

  if (result) {
    const chipMatch = result.match(MACOS_CHIP_REGEX);
    const vramMatch = result.match(MACOS_VRAM_REGEX);
    const vramValue = vramMatch?.[1];

    return {
      gpu: chipMatch?.[1]?.trim(),
      vram: vramValue
        ? Math.round(Number.parseInt(vramValue, 10) / 1024)
        : undefined,
    };
  }

  return {};
}

async function detectWindowsGPU(): Promise<GPUInfo> {
  const result =
    await $`wmic path win32_VideoController get name,adapterram /format:csv`
      .text()
      .catch(() => null);

  if (result) {
    const lines = result.trim().split("\n").filter(Boolean);
    const dataLine = lines[1];
    if (dataLine) {
      const parts = dataLine.split(",");
      const adapterRam = parts[1];
      const name = parts[2];
      return {
        gpu: name?.trim(),
        vram: adapterRam
          ? Math.round(Number.parseInt(adapterRam, 10) / 1024 / 1024 / 1024)
          : undefined,
      };
    }
  }

  return {};
}

async function detectGPU(): Promise<GPUInfo> {
  const os = platform();

  try {
    if (os === "linux") {
      return await detectLinuxGPU();
    }
    if (os === "darwin") {
      return await detectMacOSGPU();
    }
    if (os === "win32") {
      return await detectWindowsGPU();
    }
  } catch {
    // GPU detection failed
  }

  return {};
}

async function detectSpecs(): Promise<MachineSpecs> {
  const cpuInfo = cpus();
  const cpu = cpuInfo[0]?.model ?? "Unknown";
  const ram = Math.round(totalmem() / 1024 / 1024 / 1024);

  const gpuInfo = await detectGPU();

  return {
    cpu,
    ram,
    ...gpuInfo,
  };
}

// ============================================================================
// Query Hook
// ============================================================================

export function useMachineSpecsQuery() {
  return useQuery({
    queryKey: ["machine-specs"],
    queryFn: detectSpecs,
    staleTime: Number.POSITIVE_INFINITY, // Never becomes stale
    gcTime: Number.POSITIVE_INFINITY, // Never garbage collected
  });
}

// ============================================================================
// Utilities
// ============================================================================

export function formatSpecs(specs: MachineSpecs): string {
  const parts = [`CPU: ${specs.cpu}`, `RAM: ${specs.ram}GB`];

  if (specs.gpu) {
    parts.push(`GPU: ${specs.gpu}`);
  }
  if (specs.vram) {
    parts.push(`VRAM: ${specs.vram}GB`);
  }

  return parts.join(" | ");
}
