import React, { useEffect, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { exportRowsToExcel } from '../lib/exportUtils';
import type { Lang, MasterData } from '../types/oims';

interface ReportingCenterModuleProps {
  lang: Lang;
  master: MasterData;
}

const REPORT_TYPES = [
  { id: 'master_register', label: '01. Master Asset Register' },
  { id: 'by_category', label: '02. Asset by Category' },
  { id: 'by_location', label: '03. Asset by Location' },
  { id: 'by_division', label: '04. Asset by Division' },
  { id: 'by_pic', label: '05. Asset by PIC' },
  { id: 'condition_report', label: '06. Asset Condition Report' },
  { id: 'movement_report', label: '07. Asset Movement Report' },
  { id: 'maintenance_report', label: '08. Maintenance Report' },
  { id: 'opname_report', label: '09. Stock Opname Report' },
  { id: 'missing_asset_report', label: '10. Missing / Flagged Asset Report' },
  { id: 'replacement_plan', label: '11. Asset Replacement Plan' },
  { id: 'acquisition_report', label: '12. Asset Acquisition Report' },
];

export const ReportingCenterModule: React.FC<ReportingCenterModuleProps> = ({
  lang,
  master,
}) => {
  const isId = lang === 'id';
  const [selectedReport, setSelectedReport] = useState(REPORT_TYPES[0].id);
  const [categoryId, setCategoryId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(false);

  const loadReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (categoryId) params.set('category_id', categoryId);
      if (divisionId) params.set('division_id', divisionId);
      if (locationId) params.set('location_id', locationId);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      const res = await apiFetch<{ rows: Record<string, any>[] }>(`/api/reports/${selectedReport}?${params.toString()}`);
      setRows(res.rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [selectedReport, categoryId, divisionId, locationId, dateFrom, dateTo]);

  const currentLabel = REPORT_TYPES.find((r) => r.id === selectedReport)?.label || 'OIMS Report';
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  const selectClass =
    'w-full px-2.5 py-2 bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E]';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tracking-tight">
            {isId ? 'Pusat Laporan Inventaris' : 'Inventory Reporting Center'}
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {isId
              ? '12 laporan standar korporat terisolasi per perusahaan, divisi, dan lokasi dengan ekspor Excel dan Cetak / PDF'
              : '12 corporate reports scoped by company, division, and location with Excel and Print / PDF export'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={rows.length === 0}
            onClick={() => exportRowsToExcel(rows, `KIDECO_${selectedReport}.xlsx`)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isId ? 'Ekspor Excel' : 'Export Excel'}</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] hover:bg-neutral-800 dark:hover:bg-[#A10D24] rounded-md whitespace-nowrap shrink-0"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{isId ? 'Cetak / PDF' : 'Print / PDF'}</span>
          </button>
        </div>
      </div>

      {/* Report Selector & Context Filters */}
      <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 text-xs no-print">
        <div className="lg:col-span-2">
          <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
            {isId ? 'Jenis Laporan' : 'Report Type'}
          </label>
          <select
            value={selectedReport}
            onChange={(e) => setSelectedReport(e.target.value)}
            className={`${selectClass} font-medium`}
          >
            {REPORT_TYPES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
            {isId ? 'Divisi' : 'Division'}
          </label>
          <select value={divisionId} onChange={(e) => setDivisionId(e.target.value)} className={selectClass}>
            <option value="">{isId ? 'Semua Divisi' : 'All Divisions'}</option>
            {master.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
            {isId ? 'Kategori' : 'Category'}
          </label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={selectClass}>
            <option value="">{isId ? 'Semua Kategori' : 'All Categories'}</option>
            {master.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
            {isId ? 'Lokasi' : 'Location'}
          </label>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={selectClass}>
            <option value="">{isId ? 'Semua Lokasi' : 'All Locations'}</option>
            {master.locations.map((l) => <option key={l.id} value={l.id}>{l.specific_location}</option>)}
          </select>
        </div>
        <div>
          <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
            {isId ? 'Dari Tanggal' : 'From Date'}
          </label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`${selectClass} font-mono`} />
        </div>
        <div>
          <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
            {isId ? 'Sampai Tanggal' : 'To Date'}
          </label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`${selectClass} font-mono`} />
        </div>
      </div>

      {/* Report Output */}
      <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-mono text-[#C8102E] dark:text-red-400 uppercase">
              KIDECO · Office Inventory Management System
            </div>
            <h2 className="font-display text-base font-bold text-[#141619] dark:text-neutral-100">{currentLabel}</h2>
          </div>
          <span className="text-xs font-mono text-neutral-500 dark:text-neutral-400 tabular-nums">{rows.length} rows</span>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center text-xs text-neutral-500 dark:text-neutral-400">
              {isId ? 'Menghasilkan laporan...' : 'Generating report...'}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-xs text-neutral-500 dark:text-neutral-400">
              {isId ? 'Tidak ada data yang cocok dengan filter.' : 'No data matches selected filters.'}
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400">
                <tr>
                  {columns.map((col) => (
                    <th key={col} className="px-4 py-2.5 font-semibold whitespace-nowrap capitalize">
                      {col.replace(/_/g, ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-neutral-50 dark:hover:bg-[#1E222A]/70">
                    {columns.map((col) => (
                      <td key={col} className="px-4 py-2.5 text-neutral-800 dark:text-neutral-200 whitespace-nowrap tabular-nums">
                        {r[col] === null || r[col] === undefined ? '-' : String(r[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
