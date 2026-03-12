'use client';

/**
 * Gate Blocker Breakdown — advisory / display-only.
 * Shows per-stage breakdown of which gates blocked the most candidates.
 * No execution effect whatsoever.
 */

import { useEffect, useState, useCallback } from 'react';
import { Shield, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/api-client';

interface BlockerCount {
  rule: string;
  count: number;
}

interface StageBreakdown {
  stage: string;
  entering: number;
  exiting: number;
  blockers: BlockerCount[];
}

interface BlockerData {
  ok: boolean;
  available: boolean;
  message?: string;
  scanId?: string;
  scanDate?: string;
  regime?: string;
  totalCandidates?: number;
  stages?: StageBreakdown[];
  mostRestrictive?: BlockerCount | null;
}

export default function GateBlockerBreakdown() {
  const [data, setData] = useState<BlockerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const result = await apiRequest<BlockerData>('/api/scan/blockers');
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary-400" />
          Gate Blocker Breakdown
        </h3>
        <div className="text-xs text-muted-foreground animate-pulse mt-2">Loading...</div>
      </div>
    );
  }

  if (!data || !data.available) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary-400" />
          Gate Blocker Breakdown
        </h3>
        <div className="text-xs text-muted-foreground mt-2">
          {data?.message || 'Run a new scan to see breakdown'}
        </div>
      </div>
    );
  }

  const { stages, mostRestrictive, totalCandidates, scanDate, regime } = data;
  const HIGH_THRESHOLD = 5;

  return (
    <div className="card-surface p-4">
      {/* Header — click to expand/collapse */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary-400" />
          Gate Blocker Breakdown
        </h3>
        <div className="flex items-center gap-2">
          {mostRestrictive && (
            <span className="text-[10px] text-muted-foreground hidden sm:inline">
              Most restrictive: <span className="text-foreground font-medium">{mostRestrictive.rule}</span>
              {' '}({mostRestrictive.count})
            </span>
          )}
          {expanded
            ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
            : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="mt-3 space-y-4">
          {/* Most Restrictive Gate — summary line */}
          {mostRestrictive && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <div className="text-xs">
                <span className="text-red-300 font-semibold">Most Restrictive Gate:</span>{' '}
                <span className="text-foreground">{mostRestrictive.rule}</span>{' '}
                <span className="text-muted-foreground">— blocked {mostRestrictive.count} of {totalCandidates} candidates</span>
              </div>
            </div>
          )}

          {/* Context */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>{totalCandidates} candidates scanned</span>
            <span>Regime: {regime}</span>
            {scanDate && (
              <span>Scan: {new Date(scanDate).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</span>
            )}
          </div>

          {/* Stage sections */}
          {(stages || []).map((stage) => (
            <StageSection key={stage.stage} stage={stage} threshold={HIGH_THRESHOLD} />
          ))}
        </div>
      )}
    </div>
  );
}

function StageSection({ stage, threshold }: { stage: StageBreakdown; threshold: number }) {
  const dropped = stage.entering - stage.exiting;
  const isClassification = stage.stage.includes('Classification');

  return (
    <div className="rounded-lg bg-navy-800/50 p-3 border border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-foreground">{stage.stage}</span>
        <span className="text-[10px] text-muted-foreground">
          {stage.entering} → {stage.exiting}
          {!isClassification && dropped > 0 && (
            <span className="text-loss ml-1">({dropped} blocked)</span>
          )}
        </span>
      </div>

      {stage.blockers.length === 0 ? (
        <div className="text-[10px] text-muted-foreground">No blockers at this stage</div>
      ) : (
        <div className="space-y-1">
          {stage.blockers.map((blocker) => (
            <div
              key={blocker.rule}
              className="flex items-center justify-between text-xs"
            >
              <span className={cn(
                'truncate pr-2',
                !isClassification && blocker.count >= threshold ? 'text-red-400 font-medium' : 'text-muted-foreground'
              )}>
                {blocker.rule}
              </span>
              <span className={cn(
                'font-mono flex-shrink-0',
                !isClassification && blocker.count >= threshold ? 'text-red-400 font-bold' : 'text-foreground'
              )}>
                {blocker.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
