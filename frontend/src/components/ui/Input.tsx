"use client";

import { forwardRef, useId } from "react";
import type {
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  SelectHTMLAttributes,
  ReactNode,
} from "react";
import { cn } from "@/lib/cn";

const fieldBase =
  "w-full bg-elevated border border-border rounded-md px-3 py-2 text-sm text-text placeholder:text-text-subtle transition-colors duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60 disabled:cursor-not-allowed";

interface FieldShellProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, error, htmlFor, children, className }: FieldShellProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="text-xs font-medium text-text-muted tracking-wide"
        >
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <span className="text-xs text-critical">{error}</span>
      ) : hint ? (
        <span className="text-xs text-text-subtle">{hint}</span>
      ) : null}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, className, containerClassName, id, ...rest }, ref) => {
    const generated = useId();
    const fieldId = id ?? generated;
    const input = (
      <input
        ref={ref}
        id={fieldId}
        className={cn(fieldBase, error && "border-critical focus:border-critical focus:ring-critical/30", className)}
        {...rest}
      />
    );
    if (!label && !hint && !error) return input;
    return (
      <Field label={label} hint={hint} error={error} htmlFor={fieldId} className={containerClassName}>
        {input}
      </Field>
    );
  },
);
Input.displayName = "Input";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  containerClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, hint, error, className, containerClassName, id, ...rest }, ref) => {
    const generated = useId();
    const fieldId = id ?? generated;
    const ta = (
      <textarea
        ref={ref}
        id={fieldId}
        className={cn(fieldBase, "min-h-[80px] resize-y", error && "border-critical focus:border-critical focus:ring-critical/30", className)}
        {...rest}
      />
    );
    if (!label && !hint && !error) return ta;
    return (
      <Field label={label} hint={hint} error={error} htmlFor={fieldId} className={containerClassName}>
        {ta}
      </Field>
    );
  },
);
Textarea.displayName = "Textarea";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  containerClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, hint, error, className, containerClassName, children, id, ...rest }, ref) => {
    const generated = useId();
    const fieldId = id ?? generated;
    const select = (
      <select
        ref={ref}
        id={fieldId}
        className={cn(
          fieldBase,
          "appearance-none bg-[image:var(--chevron)] bg-[length:14px] bg-no-repeat bg-[right_0.75rem_center] pr-9 cursor-pointer",
          error && "border-critical focus:border-critical focus:ring-critical/30",
          className,
        )}
        style={{
          ["--chevron" as string]: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'><path stroke='%238b6f47' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/></svg>")`,
        }}
        {...rest}
      >
        {children}
      </select>
    );
    if (!label && !hint && !error) return select;
    return (
      <Field label={label} hint={hint} error={error} htmlFor={fieldId} className={containerClassName}>
        {select}
      </Field>
    );
  },
);
Select.displayName = "Select";
