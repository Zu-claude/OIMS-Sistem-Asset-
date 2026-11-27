import React from 'react';
import { CheckCircle2, AlertCircle, XCircle, Wrench, Clock } from 'lucide-react';

export const ConditionLabel: React.FC<{ condition: string; label?: string }> = ({ condition, label }) => {
  const text = label || condition;
  if (condition === 'Good') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>{text}</span>
      </span>
    );
  }
  if (condition === 'Minor Damage') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        <span>{text}</span>
      </span>
    );
  }
  if (condition === 'Major Damage') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-700 dark:text-orange-400 whitespace-nowrap">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        <span>{text}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#C8102E] dark:text-red-400 whitespace-nowrap">
      <XCircle className="w-3.5 h-3.5 shrink-0" />
      <span>{text}</span>
    </span>
  );
};

export const StatusLabel: React.FC<{ status: string }> = ({ status }) => {
  if (status === 'Active' || status === 'Completed' || status === 'Approved' || status === 'Verified') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>{status}</span>
      </span>
    );
  }
  if (status === 'In Maintenance' || status === 'In Progress') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
        <Wrench className="w-3.5 h-3.5 shrink-0" />
        <span>{status}</span>
      </span>
    );
  }
  if (status === 'Pending Approval' || status === 'Waiting Approval' || status === 'Scheduled' || status === 'Reported') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 whitespace-nowrap">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span>{status}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#C8102E] dark:text-red-400 whitespace-nowrap">
      <XCircle className="w-3.5 h-3.5 shrink-0" />
      <span>{status}</span>
    </span>
  );
};
