import { useRef, type ChangeEvent } from "react";

import type { ApplicationError } from "../types/application-error";

export interface AudioFilePickerProps {
  readonly onFileSelected: (file: File) => void;
  readonly isAccepting?: boolean;
  readonly error?: ApplicationError;
}

const acceptedAudioTypes = "audio/*,.wav,.mp3,.m4a,.ogg,.flac,audio/webm,.webm";
const helpId = "audio-file-picker-help";
const errorId = "audio-file-picker-error";

export function AudioFilePicker({
  onFileSelected,
  isAccepting = false,
  error,
}: AudioFilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const describedBy = error === undefined ? helpId : `${helpId} ${errorId}`;

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.item(0);

    // Clear the native control before notifying the owner so a user can choose
    // the same file again after validation, rejection, or replacement.
    event.currentTarget.value = "";

    if (file !== null && file !== undefined) {
      onFileSelected(file);
    }
  }

  return (
    <fieldset aria-busy={isAccepting} className="audio-file-picker" disabled={isAccepting}>
      <legend>Choose audio</legend>
      <label htmlFor="audio-file">Audio file</label>
      <input
        ref={inputRef}
        accept={acceptedAudioTypes}
        aria-describedby={describedBy}
        id="audio-file"
        onChange={handleChange}
        type="file"
      />
      <p id={helpId}>
        Choose an audio file such as WAV, MP3, M4A, OGG, WebM, and FLAC.
      </p>
      {isAccepting ? <p role="status">Validating selected audio.</p> : null}
      {error === undefined ? null : (
        <div>
          <p id={errorId} role="alert">
            {error.message}
          </p>
          <button
            type="button"
            onClick={() => {
              inputRef.current?.focus();
            }}
          >
            Choose another file
          </button>
        </div>
      )}
    </fieldset>
  );
}
