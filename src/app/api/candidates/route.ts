import { NextRequest, NextResponse } from 'next/server';
import { getCandidateListView } from '../../../../packages/signals/src';

function parseSortBy(value: string | null) {
  switch (value) {
    case 'symbol':
    case 'currentPrice':
    case 'triggerPrice':
    case 'stopDistancePercent':
    case 'setupStatus':
    case 'rankScore':
      return value;
    default:
      return 'rankScore';
  }
}

function parseDirection(value: string | null) {
  return value === 'asc' ? 'asc' : 'desc';
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sortBy = parseSortBy(searchParams.get('sortBy'));
    const direction = parseDirection(searchParams.get('direction'));
    const result = await getCandidateListView(sortBy, direction);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load candidates.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}