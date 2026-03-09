/**
 * DEPENDENCIES
 * Consumed by: Navbar bell, /notifications page, LiveNCSTracker (POST)
 * Consumes: prisma.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-07
 * Notes: GET returns notifications (unread first, most recent first).
 *        POST creates a new notification (used by client-side alert triggers).
 *        Query param ?unreadOnly=true filters to unread only.
 *        Query param ?limit=N limits count (default 50).
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { parseJsonBody } from '@/lib/request-validation';

// Allowed notification types from client-side triggers
const ALLOWED_CLIENT_TYPES = new Set(['NCS_DEGRADING', 'TDA_DIVERGENCE']);

const createNotificationSchema = z.object({
  type: z.string().trim().min(1),
  title: z.string().trim().min(1),
  message: z.string().trim().min(1),
  priority: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get('unreadOnly') === 'true';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

    const where = unreadOnly ? { readAt: null } : {};

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: [
          { readAt: 'asc' },      // unread (null) first — SQLite sorts nulls first in asc
          { createdAt: 'desc' },  // most recent first within each group
        ],
        take: limit,
      }),
      prisma.notification.count({ where: { readAt: null } }),
    ]);

    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    console.error('[GET /api/notifications] Error:', (error as Error).message);
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }
}

/**
 * POST /api/notifications — Create a notification from client-side trigger.
 * Only allows specific notification types to prevent abuse.
 * Implements 1-hour cooldown per type to prevent spam.
 */
export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody(request, createNotificationSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const { type, title, message, priority } = parsed.data;

    // Validate type is allowed from client-side
    if (!type || !ALLOWED_CLIENT_TYPES.has(type)) {
      return NextResponse.json({ error: 'Invalid notification type' }, { status: 400 });
    }
    if (!title || !message) {
      return NextResponse.json({ error: 'Title and message required' }, { status: 400 });
    }

    // 1-hour cooldown per type
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentAlert = await prisma.notification.findFirst({
      where: { type, createdAt: { gte: oneHourAgo } },
    });
    if (recentAlert) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'cooldown' });
    }

    await prisma.notification.create({
      data: {
        type,
        title: String(title).slice(0, 200),
        message: String(message).slice(0, 500),
        priority: priority === 'WARNING' ? 'WARNING' : priority === 'CRITICAL' ? 'CRITICAL' : 'INFO',
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[POST /api/notifications] Error:', (error as Error).message);
    return NextResponse.json({ error: 'Failed to create notification' }, { status: 500 });
  }
}
