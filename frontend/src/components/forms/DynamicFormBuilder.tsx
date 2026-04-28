'use client';

/**
 * DynamicFormBuilder (#754)
 *
 * Renders forms from a field schema with:
 * - Conditional field display (field.condition)
 * - Multi-step navigation
 * - Real-time Zod validation (onChange mode)
 * - Auto-save drafts to localStorage
 * - react-hook-form + @hookform/resolvers/zod
 */

import React, { useEffect, useCallback } from 'react';
import {
  useForm,
  Controller,
  type FieldValues,
  type DefaultValues,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { type ZodSchema } from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type FieldType =
  | 'text'
  | 'email'
  | 'number'
  | 'password'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio';

export interface FieldDefinition<T extends FieldValues = FieldValues> {
  name: keyof T & string;
  label: string;
  type: FieldType;
  placeholder?: string;
  options?: { label: string; value: string }[]; // for select/radio
  required?: boolean;
  /** When this returns true the field is shown; undefined means always shown. */
  condition?: (values: Partial<T>) => boolean;
  helperText?: string;
  step?: number; // which step this field belongs to (multi-step)
}

export interface FormStep {
  title: string;
  description?: string;
}

export interface DynamicFormBuilderProps<T extends FieldValues> {
  /** Schema used for validation. */
  schema: ZodSchema<T>;
  /** Field definitions. */
  fields: FieldDefinition<T>[];
  /** For multi-step forms, define steps here. */
  steps?: FormStep[];
  /** Called with valid form data on final submit. */
  onSubmit: (data: T) => Promise<void> | void;
  /** Default values. */
  defaultValues?: DefaultValues<T>;
  /** localStorage key for auto-save. Pass undefined to disable. */
  draftKey?: string;
  submitLabel?: string;
  className?: string;
}

// ── Input components ──────────────────────────────────────────────────────────

function FieldInput({
  fieldDef,
  value,
  onChange,
  error,
}: {
  fieldDef: FieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
}) {
  const base =
    'w-full rounded-lg border px-3 py-2 text-sm bg-white dark:bg-gray-800 ' +
    'text-gray-900 dark:text-gray-100 outline-none transition ' +
    'focus:ring-2 focus:ring-indigo-500';
  const errorCls = error
    ? 'border-red-400 focus:ring-red-500'
    : 'border-gray-300 dark:border-gray-600';

  switch (fieldDef.type) {
    case 'textarea':
      return (
        <textarea
          className={clsx(base, errorCls, 'resize-none min-h-[80px]')}
          placeholder={fieldDef.placeholder}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
        />
      );
    case 'select':
      return (
        <select
          className={clsx(base, errorCls)}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select…</option>
          {fieldDef.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'checkbox':
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 text-indigo-600 rounded"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">{fieldDef.label}</span>
        </label>
      );
    case 'radio':
      return (
        <div className="space-y-2">
          {fieldDef.options?.map((o) => (
            <label key={o.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                className="w-4 h-4 text-indigo-600"
                checked={value === o.value}
                onChange={() => onChange(o.value)}
              />
              <span className="text-sm">{o.label}</span>
            </label>
          ))}
        </div>
      );
    default:
      return (
        <input
          type={fieldDef.type}
          className={clsx(base, errorCls)}
          placeholder={fieldDef.placeholder}
          value={String(value ?? '')}
          onChange={(e) =>
            onChange(fieldDef.type === 'number' ? Number(e.target.value) : e.target.value)
          }
        />
      );
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export function DynamicFormBuilder<T extends FieldValues>({
  schema,
  fields,
  steps,
  onSubmit,
  defaultValues,
  draftKey,
  submitLabel = 'Submit',
  className,
}: DynamicFormBuilderProps<T>) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { control, handleSubmit, watch, formState, reset } = useForm<T>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: 'onChange',
  });

  const watchedValues = watch() as Partial<T>;

  // Auto-save draft
  useEffect(() => {
    if (!draftKey) return;
    const sub = watch((values) => {
      try {
        localStorage.setItem(draftKey, JSON.stringify(values));
      } catch {
        // quota exceeded etc.
      }
    });
    return () => sub.unsubscribe();
  }, [watch, draftKey]);

  // Restore draft on mount
  useEffect(() => {
    if (!draftKey) return;
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) reset(JSON.parse(saved) as T);
    } catch {
      // ignore
    }
  }, [draftKey, reset]);

  const clearDraft = useCallback(() => {
    if (draftKey) {
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    }
  }, [draftKey]);

  const onValidSubmit = useCallback(
    async (data: T) => {
      setIsSubmitting(true);
      try {
        await onSubmit(data);
        clearDraft();
      } finally {
        setIsSubmitting(false);
      }
    },
    [onSubmit, clearDraft]
  );

  // Determine total steps
  const totalSteps = steps ? steps.length : 1;
  const isMultiStep = totalSteps > 1;
  const isLastStep = currentStep === totalSteps - 1;

  // Filter fields for current step and visible conditions
  const visibleFields = fields.filter((f) => {
    const stepMatch = isMultiStep ? (f.step ?? 0) === currentStep : true;
    const conditionMatch = f.condition ? f.condition(watchedValues) : true;
    return stepMatch && conditionMatch;
  });

  return (
    <div className={clsx('w-full', className)}>
      {/* Step indicator */}
      {isMultiStep && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            {steps!.map((step, i) => (
              <React.Fragment key={i}>
                <div
                  className={clsx(
                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
                    i < currentStep
                      ? 'bg-indigo-600 text-white'
                      : i === currentStep
                      ? 'bg-indigo-100 text-indigo-700 border-2 border-indigo-500'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-400'
                  )}
                >
                  {i < currentStep ? '✓' : i + 1}
                </div>
                {i < totalSteps - 1 && (
                  <div
                    className={clsx(
                      'flex-1 h-0.5 rounded transition-colors',
                      i < currentStep ? 'bg-indigo-500' : 'bg-gray-200 dark:bg-gray-700'
                    )}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            {steps![currentStep].title}
          </h3>
          {steps![currentStep].description && (
            <p className="text-sm text-gray-500 mt-0.5">{steps![currentStep].description}</p>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit(onValidSubmit)} noValidate>
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {visibleFields.map((fieldDef) => (
              <Controller
                key={fieldDef.name}
                name={fieldDef.name as Parameters<typeof control.register>[0]}
                control={control}
                render={({ field: { onChange, value }, fieldState }) => (
                  <div>
                    {fieldDef.type !== 'checkbox' && (
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {fieldDef.label}
                        {fieldDef.required && (
                          <span className="text-red-500 ml-1" aria-hidden>*</span>
                        )}
                      </label>
                    )}
                    <FieldInput
                      fieldDef={fieldDef}
                      value={value}
                      onChange={onChange}
                      error={fieldState.error?.message}
                    />
                    {fieldState.error && (
                      <p className="mt-1 text-xs text-red-600">{fieldState.error.message}</p>
                    )}
                    {fieldDef.helperText && !fieldState.error && (
                      <p className="mt-1 text-xs text-gray-500">{fieldDef.helperText}</p>
                    )}
                  </div>
                )}
              />
            ))}
          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
        <div className={clsx('mt-6 flex gap-3', isMultiStep ? 'justify-between' : 'justify-end')}>
          {isMultiStep && currentStep > 0 && (
            <button
              type="button"
              onClick={() => setCurrentStep((s) => s - 1)}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Back
            </button>
          )}

          {isMultiStep && !isLastStep ? (
            <button
              type="button"
              onClick={() => setCurrentStep((s) => s + 1)}
              className="ml-auto px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              Next
            </button>
          ) : (
            <button
              type="submit"
              disabled={isSubmitting || !formState.isValid}
              className={clsx(
                'px-5 py-2 text-sm font-semibold rounded-lg transition-colors',
                formState.isValid && !isSubmitting
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                  : 'bg-indigo-300 text-white cursor-not-allowed'
              )}
            >
              {isSubmitting ? 'Submitting…' : submitLabel}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
