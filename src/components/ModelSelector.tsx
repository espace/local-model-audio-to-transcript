import type { ModelOption } from "../types/domain";

export interface ModelSelectorProps {
  readonly models: readonly ModelOption[];
  readonly selectedModelName?: string;
  readonly removedSelectedModelName?: string;
  readonly malformedEntries?: readonly { readonly index: number; readonly reason: string }[];
  readonly isLoading?: boolean;
  readonly onSelect: (modelName: string | undefined) => void;
  readonly onRefresh: () => void;
}

function compatibilityLabel(model: ModelOption): string {
  switch (model.compatibility.status) {
    case "compatible":
      return "Audio compatible";
    case "unknown":
      return "Compatibility unknown";
    case "incompatible":
      return "Not audio compatible";
  }
}

export function ModelSelector({
  models,
  selectedModelName,
  removedSelectedModelName,
  malformedEntries = [],
  isLoading = false,
  onSelect,
  onRefresh,
}: ModelSelectorProps) {
  const selectedModel = models.find((model) => model.name === selectedModelName);
  const isEmpty = models.length === 0;

  return (
    <fieldset className="model-selector" disabled={isLoading}>
      <legend>Choose a local model</legend>
      <label htmlFor="local-model">Local model</label>
      <select
        aria-describedby="model-selector-help"
        disabled={isEmpty}
        id="local-model"
        onChange={(event) => {
          onSelect(event.target.value || undefined);
        }}
        value={selectedModelName ?? ""}
      >
        <option value="">Choose a model</option>
        {models.map((model) => (
          <option
            disabled={model.compatibility.status === "incompatible"}
            key={model.name}
            value={model.name}
          >
            {`${model.name} — ${compatibilityLabel(model)}`}
          </option>
        ))}
      </select>
      <p id="model-selector-help">
        {isLoading
          ? "Loading local models."
          : "Models marked not audio compatible cannot be selected for transcription."}
      </p>
      <button onClick={onRefresh} type="button">
        Refresh models
      </button>

      {isEmpty && !isLoading ? (
        <p data-status="warning" role="status">
          Ollama is connected, but no local models were found. Install an audio-capable model and refresh the list.
        </p>
      ) : null}
      {malformedEntries.length > 0 ? (
        <div data-status="warning" role="status">
          <p>Some model entries could not be read, but the valid models remain available.</p>
          <ul>
            {malformedEntries.map((entry) => (
              <li key={entry.index}>
                Entry {entry.index + 1}: {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {removedSelectedModelName === undefined ? null : (
        <p data-status="warning" role="status">
          {`${removedSelectedModelName} is no longer available. Choose another model.`}
        </p>
      )}
      {models.map((model) => (
        <div className="model-option-details" key={`${model.name}-details`}>
          <p>
            <strong>{model.name}</strong>: {compatibilityLabel(model)}. {" "}
            <span>{model.compatibility.reason}</span>
          </p>
          {model.detailsError === undefined ? null : (
            <p data-status="warning" role="status">
              {model.detailsError.message}
            </p>
          )}
        </div>
      ))}
      {selectedModel?.compatibility.status === "unknown" ? (
        <p data-status="warning" role="status">
          Audio support could not be confirmed for this model. Transcription may fail.
        </p>
      ) : null}
    </fieldset>
  );
}
