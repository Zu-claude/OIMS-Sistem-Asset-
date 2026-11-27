import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg shadow-xl overflow-hidden">
        <div className="flex items-start justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className={`w-5 h-5 shrink-0 ${danger ? 'text-[#C8102E] dark:text-red-400' : 'text-neutral-800 dark:text-neutral-200'}`} />
            <h3 className="font-display font-semibold text-base text-[#141619] dark:text-neutral-100">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 p-1 rounded transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">{description}</div>
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 bg-neutral-50 dark:bg-[#1E222A] border-t border-neutral-200 dark:border-neutral-800">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="px-4 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-[#171A20] border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors whitespace-nowrap shrink-0"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={`px-4 py-2 text-xs font-medium text-white rounded-md transition-colors whitespace-nowrap shrink-0 ${
              danger ? 'bg-[#C8102E] hover:bg-[#A10D24]' : 'bg-[#141619] dark:bg-neutral-700 hover:bg-neutral-800 dark:hover:bg-neutral-600'
            } disabled:opacity-50`}
          >
            {loading ? '...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
