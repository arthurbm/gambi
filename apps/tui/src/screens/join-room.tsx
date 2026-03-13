import { zodResolver } from "@hookform/resolvers/zod";
import { useKeyboard } from "@opentui/react";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Footer } from "../components/footer";
import {
  formatSpecs,
  type MachineSpecs,
  useEndpointTestQuery,
  useMachineSpecsQuery,
} from "../hooks/queries";
import type { Screen } from "../hooks/use-navigation";
import { useParticipantSession } from "../hooks/use-participant-session";
import { useAppStore } from "../store/app-store";
import { colors } from "../types";
import { generateNickname } from "../utils/nickname-generator";

// Zod schema for form validation
const joinRoomSchema = z.object({
  roomCode: z.string().min(4, "Room code must be at least 4 characters"),
  endpoint: z.string().url("Must be a valid URL"),
  model: z.string().min(1, "Model is required"),
  nickname: z.string(),
  password: z.string(),
  shareSpecs: z.boolean(),
});

type JoinRoomFormData = z.infer<typeof joinRoomSchema>;

// Reusable form field component
function FormField({
  label,
  required,
  focused,
  value,
  onChange,
  placeholder,
  width,
  error,
  statusIndicator,
  children,
}: {
  label: string;
  required?: boolean;
  focused: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  width: number;
  error?: string;
  statusIndicator?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1}>
        <text>
          <span fg={colors.text}>{label}</span>
          {required && <span fg={colors.error}> *</span>}
        </text>
        {statusIndicator}
      </box>
      <input
        backgroundColor={focused ? colors.surface : undefined}
        focused={focused}
        onChange={onChange}
        placeholder={placeholder}
        value={value}
        width={width}
      />
      {error && <text fg={colors.error}>{error}</text>}
      {children}
    </box>
  );
}

// Endpoint status indicator
function EndpointStatusIndicator({
  isLoading,
  isError,
  isSuccess,
}: {
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
}) {
  if (isLoading) {
    return <text fg={colors.muted}>...</text>;
  }
  if (isSuccess) {
    return <text fg={colors.success}>✓</text>;
  }
  if (isError) {
    return <text fg={colors.error}>✗ unreachable</text>;
  }
  return null;
}

// Model suggestions
function ModelSuggestions({ models }: { models: string[] }) {
  return (
    <box flexDirection="column" paddingLeft={1}>
      <text fg={colors.muted}>Press 1-5 to select:</text>
      {models.slice(0, 5).map((m, i) => (
        <text key={m}>
          <span fg={colors.primary}>{i + 1}</span>
          <span fg={colors.muted}> {m}</span>
        </text>
      ))}
    </box>
  );
}

// Advanced fields component
function AdvancedFields({
  focusedField,
  formValues,
  setValue,
  shareSpecs,
  specs,
  specsLoading,
}: {
  focusedField: number;
  formValues: JoinRoomFormData;
  setValue: (field: keyof JoinRoomFormData, value: string | boolean) => void;
  shareSpecs: boolean;
  specs: MachineSpecs | undefined;
  specsLoading: boolean;
}) {
  return (
    <>
      <FormField
        focused={focusedField === 3}
        label="Nickname"
        onChange={(v) => setValue("nickname", v)}
        placeholder={generateNickname()}
        value={formValues.nickname}
        width={20}
      />

      <FormField
        focused={focusedField === 4}
        label="Password (if required)"
        onChange={(v) => setValue("password", v)}
        placeholder="Leave empty if no password"
        value={formValues.password}
        width={30}
      />

      <box>
        <text>
          <span fg={focusedField === 5 ? colors.primary : colors.muted}>
            [{shareSpecs ? "x" : " "}] Share machine specs
          </span>
          {focusedField === 5 && (
            <span fg={colors.muted}> (press space to toggle)</span>
          )}
        </text>
      </box>

      {shareSpecs && specs && (
        <box paddingLeft={2}>
          <text fg={colors.muted}>{formatSpecs(specs)}</text>
        </box>
      )}
      {shareSpecs && specsLoading && (
        <box paddingLeft={2}>
          <text fg={colors.muted}>Detecting specs...</text>
        </box>
      )}
    </>
  );
}

// Success screen component
function JoinSuccessScreen({
  roomCode,
  nickname,
  model,
  canGoBack,
}: {
  roomCode: string;
  nickname: string;
  model: string;
  canGoBack: boolean;
}) {
  return (
    <box flexDirection="column" flexGrow={1}>
      <box
        alignItems="center"
        flexDirection="column"
        flexGrow={1}
        gap={2}
        justifyContent="center"
      >
        <text fg={colors.success}>✓ Joined room successfully!</text>
        <box alignItems="center" flexDirection="column" gap={1}>
          <text>
            <span fg={colors.muted}>Room: </span>
            <span fg={colors.primary}>{roomCode}</span>
          </text>
          <text>
            <span fg={colors.muted}>As: </span>
            <span fg={colors.text}>{nickname}</span>
          </text>
          <text>
            <span fg={colors.muted}>Model: </span>
            <span fg={colors.accent}>{model}</span>
          </text>
        </box>
        <text fg={colors.muted}>Health checks running in background</text>
      </box>
      <Footer
        canGoBack={canGoBack}
        shortcuts={[
          { key: "m", description: "Go to Monitor" },
          { key: "l", description: "Leave room" },
        ]}
      />
    </box>
  );
}

interface JoinRoomProps {
  roomCode?: string;
  onNavigate: (screen: Screen, params: Record<string, unknown>) => void;
  onBack: () => void;
  canGoBack: boolean;
}

export function JoinRoom({
  roomCode: initialRoomCode,
  onNavigate,
  onBack,
  canGoBack,
}: JoinRoomProps) {
  const { data: specs, isLoading: specsLoading } = useMachineSpecsQuery();
  const session = useParticipantSession();

  // Get persisted endpoint from store
  const lastLlmEndpoint = useAppStore((s) => s.lastLlmEndpoint);
  const setLastLlmEndpoint = useAppStore((s) => s.setLastLlmEndpoint);

  // React Hook Form with Zod validation
  const {
    watch,
    setValue,
    trigger,
    formState: { errors },
  } = useForm<JoinRoomFormData>({
    resolver: zodResolver(joinRoomSchema),
    mode: "onChange",
    defaultValues: {
      roomCode: initialRoomCode ?? "",
      endpoint: lastLlmEndpoint,
      model: "",
      nickname: generateNickname(),
      password: "",
      shareSpecs: true,
    },
  });

  // Watch all form values
  const formValues = watch();

  // Endpoint test query (with built-in debounce via staleTime)
  const endpointQuery = useEndpointTestQuery(formValues.endpoint);
  const availableModels = endpointQuery.data?.models ?? [];

  // UI state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [focusedField, setFocusedField] = useState(initialRoomCode ? 1 : 0);

  // Field configuration
  const essentialFields = 3;
  const totalFields = showAdvanced ? 6 : essentialFields;

  // Form submission
  const handleJoin = useCallback(async () => {
    const valid = await trigger();
    if (!valid) {
      return;
    }

    const endpointTrimmed = formValues.endpoint.trim();
    const success = await session.join(formValues.roomCode.trim(), {
      id: crypto.randomUUID(),
      nickname: formValues.nickname.trim() || generateNickname(),
      model: formValues.model.trim(),
      endpoint: endpointTrimmed,
      password: formValues.password || undefined,
      specs: formValues.shareSpecs && specs ? specs : undefined,
      capabilities: endpointQuery.data?.capabilities,
    });

    if (success) {
      // Persist the endpoint for next time
      setLastLlmEndpoint(endpointTrimmed);
      onNavigate("monitor", { roomCodes: [formValues.roomCode] });
    }
  }, [
    endpointQuery.data?.capabilities,
    formValues,
    specs,
    session,
    onNavigate,
    trigger,
    setLastLlmEndpoint,
  ]);

  // Keyboard handlers
  const handleJoinedKey = useCallback(
    (keyName: string) => {
      if (keyName === "m") {
        onNavigate("monitor", { roomCodes: [formValues.roomCode] });
      } else if (keyName === "l") {
        session.leave();
      }
    },
    [onNavigate, formValues.roomCode, session]
  );

  const handleModelSelection = useCallback(
    (sequence: string | undefined) => {
      if (focusedField !== 2 || availableModels.length === 0) {
        return;
      }
      if (["1", "2", "3", "4", "5"].includes(sequence ?? "")) {
        const index = Number.parseInt(sequence ?? "1", 10) - 1;
        if (index < availableModels.length) {
          setValue("model", availableModels[index] ?? "", {
            shouldValidate: true,
          });
        }
      }
    },
    [focusedField, availableModels, setValue]
  );

  const handleFormKey = useCallback(
    (keyName: string, sequence: string | undefined) => {
      switch (keyName) {
        case "tab":
          setFocusedField((i) => (i + 1) % totalFields);
          break;
        case "return":
          handleJoin();
          break;
        case "a":
          setShowAdvanced((v) => !v);
          break;
        case "space":
          if (focusedField === 5 && showAdvanced) {
            setValue("shareSpecs", !formValues.shareSpecs);
          }
          break;
        default:
          handleModelSelection(sequence);
          break;
      }
    },
    [
      totalFields,
      handleJoin,
      focusedField,
      showAdvanced,
      handleModelSelection,
      setValue,
      formValues.shareSpecs,
    ]
  );

  useKeyboard(
    (key) => {
      if (session.status === "joined") {
        handleJoinedKey(key.name ?? "");
        return;
      }
      if (key.name === "escape") {
        onBack();
        return;
      }
      handleFormKey(key.name ?? "", key.sequence);
    },
    { release: false }
  );

  // Success screen
  if (session.status === "joined") {
    return (
      <JoinSuccessScreen
        canGoBack={canGoBack}
        model={formValues.model}
        nickname={formValues.nickname}
        roomCode={formValues.roomCode}
      />
    );
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <box padding={1}>
        <text fg={colors.primary}>Join Room as LLM Participant</text>
      </box>

      <box flexDirection="column" flexGrow={1} gap={1} padding={2}>
        <FormField
          error={errors.roomCode?.message}
          focused={focusedField === 0}
          label="Room Code"
          onChange={(v) => setValue("roomCode", v, { shouldValidate: true })}
          placeholder="ABC123"
          required
          value={formValues.roomCode}
          width={10}
        />

        <FormField
          error={errors.endpoint?.message}
          focused={focusedField === 1}
          label="LLM Endpoint"
          onChange={(v) => setValue("endpoint", v, { shouldValidate: true })}
          placeholder="http://localhost:11434"
          statusIndicator={
            <EndpointStatusIndicator
              isError={
                endpointQuery.isError ||
                (endpointQuery.isSuccess && !endpointQuery.data?.success)
              }
              isLoading={endpointQuery.isLoading || endpointQuery.isFetching}
              isSuccess={
                endpointQuery.isSuccess && endpointQuery.data?.success === true
              }
            />
          }
          value={formValues.endpoint}
          width={40}
        />

        <FormField
          error={errors.model?.message}
          focused={focusedField === 2}
          label="Model"
          onChange={(v) => setValue("model", v, { shouldValidate: true })}
          placeholder={availableModels[0] ?? "llama3, gpt-4, etc."}
          required
          statusIndicator={
            availableModels.length > 0 ? (
              <text fg={colors.muted}>
                ({availableModels.length} available)
              </text>
            ) : undefined
          }
          value={formValues.model}
          width={30}
        >
          {focusedField === 2 && availableModels.length > 0 && (
            <ModelSuggestions models={availableModels} />
          )}
        </FormField>

        {/* Advanced toggle */}
        <box>
          <text>
            <span fg={colors.muted}>
              [{showAdvanced ? "▼" : "▶"}] Advanced options
            </span>
            <span fg={colors.muted}> (press 'a' to toggle)</span>
          </text>
        </box>

        {/* Advanced fields */}
        {showAdvanced && (
          <AdvancedFields
            focusedField={focusedField}
            formValues={formValues}
            setValue={setValue}
            shareSpecs={formValues.shareSpecs}
            specs={specs}
            specsLoading={specsLoading}
          />
        )}

        {session.error && <text fg={colors.error}>Error: {session.error}</text>}
        {session.status === "joining" && (
          <text fg={colors.muted}>Joining room...</text>
        )}
      </box>

      <Footer
        canGoBack={canGoBack}
        shortcuts={[
          { key: "Tab", description: "Next field" },
          {
            key: "a",
            description: showAdvanced ? "Hide advanced" : "Advanced",
          },
          { key: "Enter", description: "Join" },
        ]}
      />
    </box>
  );
}
