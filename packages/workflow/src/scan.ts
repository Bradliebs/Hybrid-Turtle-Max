import { getCandidateListView, runSignalScan } from '../../signals/src';
import type { EveningScanResult } from './types';

export async function runEveningScan(): Promise<EveningScanResult> {
  return runSignalScan();
}

export async function reviewEveningCandidates() {
  const candidateList = await getCandidateListView('rankScore', 'desc');

  if (!candidateList.signalRunId) {
    return {
      signalRunId: '',
      countsByStatus: {},
      topCandidates: [],
    };
  }

  const countsByStatus = candidateList.items.reduce<Record<string, number>>((accumulator, candidate) => {
    accumulator[candidate.setupStatus] = (accumulator[candidate.setupStatus] ?? 0) + 1;
    return accumulator;
  }, {});

  return {
    signalRunId: candidateList.signalRunId,
    countsByStatus,
    topCandidates: candidateList.items.slice(0, 5),
  };
}