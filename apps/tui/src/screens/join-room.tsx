import type { ParticipantAuthHeaders } from "@gambi/core/types";
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
  instructions: z.string(),
  maxTokens: z
    .string()
    .refine((value) => !(value.trim() && Number.isNaN(Number(value))), {
      message: "Max tokens must be a number",
    }),
  shareSpecs: z.boolean(),
  temperature: z
    .string()
    .refine((value) => !(value.trim() && Number.isNaN(Number(value))), {
      message: "Temperature must be a number",
    }),
});

type JoinRoomFormData = z.infer<typeof joinRoomSchema>;

interface AuthHeaderEnvEntry {
  envVar: string;
  name: string;
}

function resolveAuthHeadersFromEnv(entries: AuthHeaderEnvEntry[]): {
  authHeaders: ParticipantAuthHeaders;
  error: string | null;
} {
  const authHeaders: ParticipantAuthHeaders = {};

  for (const entry of entries) {
    const name = entry.name.trim();
    const envVar = entry.envVar.trim();

    if (!(name && envVar)) {
      return {
        authHeaders: {},
        error: "Header name and env var are required for each auth header.",
      };
    }

    const value = process.env[envVar];
    if (!value) {
      return {
        authHeaders: {},
        error: `Environment variable '${envVar}' is not set.`,
      };
    }

    authHeaders[name] = value;
  }

  return {
    authHeaders,
    error: null,
  };
}

function buildRuntimeConfigFromForm(formValues: JoinRoomFormData) {
  const config: {
    instructions?: string;
    max_tokens?: number;
    temperature?: number;
  } = {};

  const instructions = formValues.instructions.trim();
  if (instructions) {
    config.instructions = instructions;
  }

  const temperature = formValues.temperature.trim();
  if (temperature) {
    config.temperature = Number(temperature);
  }

  const maxTokens = formValues.maxTokens.trim();
  if (maxTokens) {
    config.max_tokens = Number(maxTokens);
  }

  return config;
}

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
  authHeaderEntries,
  authHeaderEnvVar,
  authHeaderName,
  focusedField,
  formValues,
  maxTokensError,
  setValue,
  setAuthHeaderEnvVar,
  setAuthHeaderName,
  shareSpecs,
  specs,
  specsLoading,
  temperatureError,
}: {
  authHeaderEntries: AuthHeaderEnvEntry[];
  authHeaderEnvVar: string;
  authHeaderName: string;
  focusedField: number;
  formValues: JoinRoomFormData;
  maxTokensError?: string;
  setValue: (
    field: keyof JoinRoomFormData,
    value: string | boolean,
    options?: { shouldValidate?: boolean }
  ) => void;
  setAuthHeaderEnvVar: (value: string) => void;
  setAuthHeaderName: (value: string) => void;
  shareSpecs: boolean;
  specs: MachineSpecs | undefined;
  specsLoading: boolean;
  temperatureError?: string;
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

      <FormField
        focused={focusedField === 5}
        label="Instructions / system prompt"
        onChange={(v) => setValue("instructions", v)}
        placeholder="Optional participant default instructions"
        value={formValues.instructions}
        width={60}
      />

      <FormField
        error={temperatureError}
        focused={focusedField === 6}
        label="Temperature"
        onChange={(v) => setValue("temperature", v, { shouldValidate: true })}
        placeholder="Optional"
        value={formValues.temperature}
        width={16}
      />

      <FormField
        error={maxTokensError}
        focused={focusedField === 7}
        label="Max tokens"
        onChange={(v) => setValue("maxTokens", v, { shouldValidate: true })}
        placeholder="Optional"
        value={formValues.maxTokens}
        width={16}
      />

      <FormField
        focused={focusedField === 8}
        label="Auth header name"
        onChange={setAuthHeaderName}
        placeholder="Authorization"
        value={authHeaderName}
        width={24}
      />

      <FormField
        focused={focusedField === 9}
        label="Auth header env var"
        onChange={setAuthHeaderEnvVar}
        placeholder="OPENROUTER_API_KEY"
        value={authHeaderEnvVar}
        width={24}
      >
        <box paddingLeft={1}>
          <text fg={colors.muted}>Press + to add, d to remove last</text>
        </box>
      </FormField>

      {authHeaderEntries.length > 0 && (
        <box flexDirection="column" paddingLeft={1}>
          <text fg={colors.muted}>Auth headers from env:</text>
          {authHeaderEntries.map((entry) => (
            <text fg={colors.muted} key={`${entry.name}:${entry.envVar}`}>
              {entry.name} ← ${entry.envVar}
            </text>
          ))}
        </box>
      )}

      <box>
        <text>
          <span fg={focusedField === 10 ? colors.primary : colors.muted}>
            [{shareSpecs ? "x" : " "}] Share machine specs
          </span>
          {focusedField === 10 && (
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

      <box paddingTop={1}>
        <text fg={colors.muted}>
          {authHeaderEntries.length > 0
            ? `${authHeaderEntries.length} auth header(s) configured`
            : "No auth headers configured"}
        </text>
      </box>

      <box flexDirection="row" gap={2} paddingTop={1}>
        <text fg={colors.muted}>+</text>
        <text fg={colors.muted}>add header</text>
        <text fg={colors.muted}>d</text>
        <text fg={colors.muted}>remove last</text>
      </box>
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
  const participantId = useAppStore((s) => s.participantId);

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
      instructions: "",
      maxTokens: "",
      shareSpecs: true,
      temperature: "",
    },
  });

  // Watch all form values
  const formValues = watch();

  // UI state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [focusedField, setFocusedField] = useState(initialRoomCode ? 1 : 0);
  const [authHeaderName, setAuthHeaderName] = useState("");
  const [authHeaderEnvVar, setAuthHeaderEnvVar] = useState("");
  const [authHeaderEntries, setAuthHeaderEntries] = useState<
    AuthHeaderEnvEntry[]
  >([]);
  const authHeaderResolution = resolveAuthHeadersFromEnv(authHeaderEntries);

  // Endpoint test query (with built-in debounce via staleTime)
  const endpointQuery = useEndpointTestQuery(
    formValues.endpoint,
    authHeaderResolution.authHeaders,
    authHeaderResolution.error === null
  );
  const availableModels = endpointQuery.data?.models ?? [];

  // Field configuration
  const essentialFields = 3;
  const totalFields = showAdvanced ? 11 : essentialFields;

  // Form submission
  const handleJoin = useCallback(async () => {
    if (session.status === "joining") {
      return;
    }

    if (session.status === "joined") {
      return;
    }

    if (authHeaderResolution.error) {
      return;
    }

    const valid = await trigger();
    if (!valid) {
      return;
    }

    const endpointTrimmed = formValues.endpoint.trim();
    const success = await session.join(formValues.roomCode.trim(), {
      id: participantId,
      nickname: formValues.nickname.trim() || generateNickname(),
      model: formValues.model.trim(),
      endpoint: endpointTrimmed,
      password: formValues.password || undefined,
      specs: formValues.shareSpecs && specs ? specs : undefined,
      config: buildRuntimeConfigFromForm(formValues),
      capabilities: endpointQuery.data?.capabilities,
      authHeaders: authHeaderResolution.authHeaders,
    });

    if (success) {
      // Persist the endpoint for next time
      setLastLlmEndpoint(endpointTrimmed);
      onNavigate("monitor", { roomCodes: [formValues.roomCode] });
    }
  }, [
    endpointQuery.data?.capabilities,
    authHeaderResolution.authHeaders,
    authHeaderResolution.error,
    formValues,
    participantId,
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

  const addAuthHeaderEntry = useCallback(() => {
    const name = authHeaderName.trim();
    const envVar = authHeaderEnvVar.trim();
    if (!(name && envVar)) {
      return;
    }

    setAuthHeaderEntries((entries) => {
      const nextEntries = entries.filter((entry) => entry.name !== name);
      nextEntries.push({ name, envVar });
      return nextEntries;
    });
    setAuthHeaderName("");
    setAuthHeaderEnvVar("");
  }, [authHeaderEnvVar, authHeaderName]);

  const removeLastAuthHeaderEntry = useCallback(() => {
    setAuthHeaderEntries((entries) => entries.slice(0, -1));
  }, []);

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
          if (focusedField === 10 && showAdvanced) {
            setValue("shareSpecs", !formValues.shareSpecs);
          }
          break;
        case "+":
          if (showAdvanced) {
            addAuthHeaderEntry();
          }
          break;
        case "d":
          if (showAdvanced && authHeaderEntries.length > 0) {
            removeLastAuthHeaderEntry();
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
      addAuthHeaderEntry,
      authHeaderEntries.length,
      focusedField,
      showAdvanced,
      handleModelSelection,
      setValue,
      formValues.shareSpecs,
      removeLastAuthHeaderEntry,
    ]
  );

  useKeyboard(
    (key) => {
      if (session.status === "joined") {
        handleJoinedKey(key.name ?? "");
        return;
      }
      if (session.status === "joining") {
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
            authHeaderEntries={authHeaderEntries}
            authHeaderEnvVar={authHeaderEnvVar}
            authHeaderName={authHeaderName}
            focusedField={focusedField}
            formValues={formValues}
            maxTokensError={errors.maxTokens?.message}
            setAuthHeaderEnvVar={setAuthHeaderEnvVar}
            setAuthHeaderName={setAuthHeaderName}
            setValue={setValue}
            shareSpecs={formValues.shareSpecs}
            specs={specs}
            specsLoading={specsLoading}
            temperatureError={errors.temperature?.message}
          />
        )}

        {authHeaderResolution.error && (
          <text fg={colors.error}>Error: {authHeaderResolution.error}</text>
        )}
        {session.error && <text fg={colors.error}>Error: {session.error}</text>}
        {session.status === "joining" && (
          <text fg={colors.muted}>Joining room and opening tunnel...</text>
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
          ...(showAdvanced
            ? [
                { key: "+", description: "Add auth header" },
                { key: "d", description: "Remove last header" },
              ]
            : []),
          {
            key: "Enter",
            description: session.status === "joining" ? "Joining..." : "Join",
          },
        ]}
      />
    </box>
  );
}
