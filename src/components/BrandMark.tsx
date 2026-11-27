import React from 'react';

export const DEFAULT_COMPANY_LOGO_URL = '/assets/aistudio/logo_795e174b.png';

interface BrandMarkProps {
  logoUrl?: string;
  compact?: boolean;
  darkSurface?: boolean;
}

export const BrandMark: React.FC<BrandMarkProps> = ({ logoUrl, compact = false, darkSurface = true }) => {
  const effectiveLogoUrl = logoUrl && logoUrl.trim() ? logoUrl : DEFAULT_COMPANY_LOGO_URL;

  return (
    <div className="flex items-center gap-2.5 select-none min-w-0">
      <div
        className={`rounded-md flex items-center justify-center shrink-0 overflow-hidden ${
          darkSurface
            ? 'bg-white px-2 py-1 border border-neutral-200/80'
            : 'bg-white px-2 py-1 border border-neutral-200 dark:border-neutral-700'
        }`}
      >
        <img
          src={effectiveLogoUrl}
          alt="KIDECO – Member of Indika Energy Group"
          referrerPolicy="no-referrer"
          className={compact ? 'h-6 w-auto max-w-[110px] object-contain' : 'h-7 w-auto max-w-[144px] object-contain'}
        />
      </div>
      {!compact && (
        <div className="min-w-0">
          <div className="font-display font-bold text-xs tracking-wider uppercase leading-tight whitespace-nowrap text-[#C8102E] dark:text-red-400">
            OIMS
          </div>
          <div className={`text-[10px] truncate ${darkSurface ? 'text-neutral-400' : 'text-neutral-500 dark:text-neutral-400'}`}>
            Asset System
          </div>
        </div>
      )}
    </div>
  );
};
