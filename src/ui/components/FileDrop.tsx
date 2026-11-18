import { Camera, FileUp } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { buttonClasses } from './buttonStyles';

export interface FileDropProps {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  /** Adds a "Take a photo" button that opens the rear camera on phones. */
  allowCamera?: boolean;
  title?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  /** Name of the file already chosen, shown as the selected state. */
  selectedName?: string | null;
  className?: string;
}

export function FileDrop({
  onFiles,
  accept = 'image/*,application/pdf',
  multiple = false,
  allowCamera = false,
  title = 'Drop a file here',
  hint,
  disabled = false,
  selectedName,
  className,
}: FileDropProps) {
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const hintId = useId();

  const emit = (list: FileList | null) => {
    if (!list || list.length === 0 || disabled) return;
    onFiles(multiple ? [...list] : [list[0]]);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    emit(e.dataTransfer.files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cx(
        'flex flex-col items-center gap-4 rounded-card-sm border-2 border-dashed px-5 py-8 text-center transition-colors',
        dragging ? 'border-teal bg-teal-tint' : 'border-line-strong/70 bg-surface-muted',
        disabled && 'opacity-60',
        className,
      )}
    >
      <FileUp aria-hidden className="size-8 text-teal" />
      <div>
        <p className="font-semibold text-ink">{dragging ? 'Release to add the file' : title}</p>
        {hint && (
          <p id={hintId} className="mt-1 text-secondary text-ink-3">
            {hint}
          </p>
        )}
        {selectedName && (
          <p className="mt-2 text-secondary font-medium text-teal-ink">
            Selected: <span className="break-all">{selectedName}</span>
          </p>
        )}
      </div>
      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
        {allowCamera && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => cameraInput.current?.click()}
            className={buttonClasses({ variant: 'primary', disabled })}
          >
            <Camera aria-hidden className="size-5" />
            Take a photo
          </button>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
          aria-describedby={hint ? hintId : undefined}
          className={buttonClasses({ variant: allowCamera ? 'secondary' : 'primary', disabled })}
        >
          Choose a file
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="file-input"
        onChange={(e) => {
          emit(e.target.files);
          e.target.value = '';
        }}
      />
      {allowCamera && (
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            emit(e.target.files);
            e.target.value = '';
          }}
        />
      )}
    </div>
  );
}
