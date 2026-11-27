import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { formatIDR } from '../lib/exportUtils';
import type { Lang } from '../types/oims';

export interface LifecycleTrendPoint {
  month: string;
  label: string;
  acquisitions: number;
  retirements: number;
  acquisitionValue: number;
  retirementValue: number;
  netChange: number;
}

interface D3LifecycleLineChartProps {
  data: LifecycleTrendPoint[];
  lang: Lang;
  theme?: 'light' | 'dark';
}

export const D3LifecycleLineChart: React.FC<D3LifecycleLineChartProps> = ({ data, lang, theme = 'light' }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [width, setWidth] = useState(720);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const isId = lang === 'id';
  const isDark = theme === 'dark';

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateWidth = () => {
      const nextW = Math.max(320, Math.floor(el.getBoundingClientRect().width));
      setWidth(nextW);
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totals = useMemo(() => {
    return data.reduce(
      (acc, d) => ({
        acq: acc.acq + d.acquisitions,
        ret: acc.ret + d.retirements,
        acqVal: acc.acqVal + d.acquisitionValue,
        retVal: acc.retVal + d.retirementValue,
      }),
      { acq: 0, ret: 0, acqVal: 0, retVal: 0 }
    );
  }, [data]);

  const height = 270;
  const margin = { top: 20, right: 24, bottom: 34, left: 42 };
  const innerWidth = Math.max(120, width - margin.left - margin.right);
  const innerHeight = height - margin.top - margin.bottom;

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || data.length === 0) return;

    const acqStroke = isDark ? '#E5E7EB' : '#141619';
    const retStroke = isDark ? '#F87171' : '#C8102E';
    const gridColor = isDark ? '#272B35' : '#E5E7EB';
    const axisDomainColor = isDark ? '#374151' : '#D1D5DB';
    const tickColor = isDark ? '#9CA3AF' : '#525866';
    const dotOutline = isDark ? '#171A20' : '#FFFFFF';

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    const acqGrad = defs
      .append('linearGradient')
      .attr('id', 'd3-acq-grad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    acqGrad.append('stop').attr('offset', '0%').attr('stop-color', acqStroke).attr('stop-opacity', isDark ? 0.18 : 0.14);
    acqGrad.append('stop').attr('offset', '100%').attr('stop-color', acqStroke).attr('stop-opacity', 0.0);

    const retGrad = defs
      .append('linearGradient')
      .attr('id', 'd3-ret-grad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    retGrad.append('stop').attr('offset', '0%').attr('stop-color', retStroke).attr('stop-opacity', isDark ? 0.16 : 0.12);
    retGrad.append('stop').attr('offset', '100%').attr('stop-color', retStroke).attr('stop-opacity', 0.0);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scalePoint<string>()
      .domain(data.map((d) => d.month))
      .range([0, innerWidth])
      .padding(0.25);

    const maxVal = d3.max(data, (d) => Math.max(d.acquisitions, d.retirements)) ?? 0;
    const yMax = Math.max(4, Math.ceil(maxVal * 1.25));
    const yScale = d3.scaleLinear().domain([0, yMax]).nice().range([innerHeight, 0]);

    const yTickValues = yScale.ticks(5).filter((v) => Number.isInteger(v));

    // Horizontal grid lines
    g.append('g')
      .attr('class', 'grid-lines')
      .selectAll('line')
      .data(yTickValues)
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', gridColor)
      .attr('stroke-dasharray', '3 3');

    // X Axis
    const labelMap = new Map(data.map((d) => [d.month, d.label]));
    const xAxis = d3
      .axisBottom(xScale)
      .tickFormat((m) => labelMap.get(m) || m)
      .tickSizeOuter(0);

    const xAxisG = g
      .append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis);

    xAxisG.select('.domain').attr('stroke', axisDomainColor);
    xAxisG
      .selectAll('text')
      .attr('fill', tickColor)
      .attr('font-size', width < 540 ? '9.5px' : '11px')
      .attr('font-family', 'JetBrains Mono, ui-monospace, monospace');

    // Y Axis
    const yAxis = d3
      .axisLeft(yScale)
      .tickValues(yTickValues)
      .tickFormat((d) => String(d))
      .tickSize(0);

    const yAxisG = g.append('g').call(yAxis);
    yAxisG.select('.domain').remove();
    yAxisG
      .selectAll('text')
      .attr('fill', tickColor)
      .attr('font-size', '11px')
      .attr('font-family', 'JetBrains Mono, ui-monospace, monospace')
      .attr('dx', '-6');

    // Area generators
    const acqArea = d3
      .area<LifecycleTrendPoint>()
      .x((d) => xScale(d.month) ?? 0)
      .y0(innerHeight)
      .y1((d) => yScale(d.acquisitions))
      .curve(d3.curveMonotoneX);

    const retArea = d3
      .area<LifecycleTrendPoint>()
      .x((d) => xScale(d.month) ?? 0)
      .y0(innerHeight)
      .y1((d) => yScale(d.retirements))
      .curve(d3.curveMonotoneX);

    g.append('path').datum(data).attr('fill', 'url(#d3-acq-grad)').attr('d', acqArea);
    g.append('path').datum(data).attr('fill', 'url(#d3-ret-grad)').attr('d', retArea);

    // Line generators
    const acqLine = d3
      .line<LifecycleTrendPoint>()
      .x((d) => xScale(d.month) ?? 0)
      .y((d) => yScale(d.acquisitions))
      .curve(d3.curveMonotoneX);

    const retLine = d3
      .line<LifecycleTrendPoint>()
      .x((d) => xScale(d.month) ?? 0)
      .y((d) => yScale(d.retirements))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', acqStroke)
      .attr('stroke-width', 2.5)
      .attr('stroke-linecap', 'round')
      .attr('d', acqLine);

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', retStroke)
      .attr('stroke-width', 2.5)
      .attr('stroke-dasharray', '6 3')
      .attr('stroke-linecap', 'round')
      .attr('d', retLine);

    // Crosshair line (updated separately on hover without rebuilding SVG)
    g.append('line')
      .attr('class', 'hover-crosshair')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', isDark ? '#6B7280' : '#9CA3AF')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3 3')
      .attr('opacity', 0);

    // Acquisition nodes
    g.selectAll('.acq-dot')
      .data(data)
      .join('circle')
      .attr('class', 'acq-dot')
      .attr('cx', (d) => xScale(d.month) ?? 0)
      .attr('cy', (d) => yScale(d.acquisitions))
      .attr('r', 3.5)
      .attr('fill', acqStroke)
      .attr('stroke', dotOutline)
      .attr('stroke-width', 1.5);

    // Retirement nodes (hollow crimson ring for clear shape + color differentiation)
    g.selectAll('.ret-dot')
      .data(data)
      .join('circle')
      .attr('class', 'ret-dot')
      .attr('cx', (d) => xScale(d.month) ?? 0)
      .attr('cy', (d) => yScale(d.retirements))
      .attr('r', 3.5)
      .attr('fill', dotOutline)
      .attr('stroke', retStroke)
      .attr('stroke-width', 2);

    // Interactive pointer capture overlay
    const xPositions = data.map((d) => xScale(d.month) ?? 0);
    g.append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mousemove touchmove', function (event: MouseEvent | TouchEvent) {
        const source =
          'touches' in event && event.touches?.length
            ? event.touches[0]
            : 'changedTouches' in event && event.changedTouches?.length
              ? event.changedTouches[0]
              : (event as MouseEvent);
        if (!source || !Number.isFinite(source.clientX)) return;
        const rect = this.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;
        const mx = ((source.clientX - rect.left) * innerWidth) / rect.width;
        if (!Number.isFinite(mx)) return;

        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < xPositions.length; i++) {
          const dist = Math.abs(xPositions[i] - mx);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }
        setHoveredIdx(bestIdx);
      })
      .on('mouseleave touchend touchcancel', () => setHoveredIdx(null));
  }, [data, width, innerWidth, innerHeight, margin.left, margin.top, isDark]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || data.length === 0) return;

    const svg = d3.select(svgEl);
    const xScale = d3
      .scalePoint<string>()
      .domain(data.map((d) => d.month))
      .range([0, innerWidth])
      .padding(0.25);

    const crosshair = svg.select<SVGLineElement>('.hover-crosshair');
    if (hoveredIdx !== null && data[hoveredIdx]) {
      const hx = xScale(data[hoveredIdx].month) ?? 0;
      crosshair.attr('x1', hx).attr('x2', hx).attr('opacity', 1);
    } else {
      crosshair.attr('opacity', 0);
    }

    svg.selectAll<SVGCircleElement, LifecycleTrendPoint>('.acq-dot').attr('r', (_d, i) => (hoveredIdx === i ? 5.5 : 3.5));
    svg.selectAll<SVGCircleElement, LifecycleTrendPoint>('.ret-dot').attr('r', (_d, i) => (hoveredIdx === i ? 5.5 : 3.5));
  }, [hoveredIdx, data, innerWidth, isDark]);

  const activePoint = hoveredIdx !== null ? data[hoveredIdx] : null;
  const net12Mo = totals.acq - totals.ret;

  return (
    <div className="space-y-4">
      {/* Inline Legend & 12-Month Summary Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex items-center gap-2">
            <span className="inline-block w-5 h-0.5 bg-[#141619] dark:bg-neutral-200" />
            <span className="w-2 h-2 rounded-full bg-[#141619] dark:bg-neutral-200 -ml-3.5" />
            <span className="font-medium text-[#141619] dark:text-neutral-200">
              {isId ? 'Perolehan Aset Baru' : 'Asset Acquisitions'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-5 border-t-2 border-dashed border-[#C8102E] dark:border-red-400" />
            <span className="w-2 h-2 rounded-full border-2 border-[#C8102E] dark:border-red-400 bg-white dark:bg-[#171A20] -ml-3.5" />
            <span className="font-medium text-[#C8102E] dark:text-red-400">
              {isId ? 'Penghentian / Tidak Layak' : 'Asset Retirements'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
          <span>
            {isId ? 'Perolehan 12 Bln:' : '12M Acquisitions:'}{' '}
            <strong className="text-[#141619] dark:text-neutral-100">{totals.acq}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {isId ? 'Penghentian 12 Bln:' : '12M Retirements:'}{' '}
            <strong className="text-[#C8102E] dark:text-red-400">{totals.ret}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {isId ? 'Selisih Bersih:' : 'Net Delta:'}{' '}
            <strong className={net12Mo >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-[#C8102E] dark:text-red-400'}>
              {net12Mo > 0 ? `+${net12Mo}` : net12Mo}
            </strong>
          </span>
        </div>
      </div>

      {/* D3 SVG Canvas + Interactive Hover Readout */}
      <div ref={containerRef} className="relative w-full">
        <svg
          ref={svgRef}
          width={width}
          height={height}
          role="img"
          aria-label={
            isId
              ? 'Grafik garis D3 tren perolehan dan penghentian aset 12 bulan terakhir'
              : 'D3 line chart of asset acquisition and retirement trends over the last 12 months'
          }
          className="block w-full overflow-visible select-none"
        />

        {activePoint && (
          <div
            className={`pointer-events-none absolute top-2 z-10 w-60 bg-[#141619] dark:bg-[#0F1115] text-white rounded-md p-3 shadow-lg border border-neutral-800 dark:border-neutral-700 text-xs ${
              hoveredIdx !== null && hoveredIdx >= Math.floor(data.length / 2) ? 'left-3' : 'right-3'
            }`}
          >
            <div className="font-mono font-semibold text-neutral-200 border-b border-neutral-700 pb-1.5 mb-2 flex items-center justify-between">
              <span>{activePoint.label}</span>
              <span className="text-[10px] text-neutral-400">{activePoint.month}</span>
            </div>
            <div className="space-y-1.5 font-mono text-[11px] tabular-nums">
              <div className="flex items-center justify-between gap-2">
                <span className="text-neutral-300">{isId ? 'Perolehan:' : 'Acquisitions:'}</span>
                <span className="font-semibold text-white">
                  {activePoint.acquisitions} ({formatIDR(activePoint.acquisitionValue)})
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-red-300">{isId ? 'Penghentian:' : 'Retirements:'}</span>
                <span className="font-semibold text-red-400">
                  {activePoint.retirements} ({formatIDR(activePoint.retirementValue)})
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-neutral-800">
                <span className="text-neutral-400">{isId ? 'Perubahan Bersih:' : 'Net Change:'}</span>
                <span
                  className={`font-semibold ${
                    activePoint.netChange >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {activePoint.netChange > 0 ? `+${activePoint.netChange}` : activePoint.netChange}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
