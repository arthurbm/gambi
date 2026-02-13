import { useCallback, useState } from "react";

export type ConfirmAction = "quit" | "leave" | null;

interface UseConfirmReturn {
  pendingConfirm: ConfirmAction;
  requestConfirm: (action: ConfirmAction) => void;
  confirm: () => void;
  cancel: () => void;
}

export function useConfirm(
  onConfirm: (action: ConfirmAction) => void
): UseConfirmReturn {
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmAction>(null);

  const requestConfirm = useCallback((action: ConfirmAction) => {
    setPendingConfirm(action);
  }, []);

  const confirm = useCallback(() => {
    if (pendingConfirm) {
      onConfirm(pendingConfirm);
    }
    setPendingConfirm(null);
  }, [pendingConfirm, onConfirm]);

  const cancel = useCallback(() => {
    setPendingConfirm(null);
  }, []);

  return {
    pendingConfirm,
    requestConfirm,
    confirm,
    cancel,
  };
}
