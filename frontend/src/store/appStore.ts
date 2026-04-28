import { create } from 'zustand'
import { persist, devtools } from 'zustand/middleware'
import type { Group, Member, Transaction } from '../types'

// ─── Notification type (lightweight, distinct from NotificationItem) ──────────
export interface AppNotification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  read: boolean
  timestamp: number
}

// ─── User type ────────────────────────────────────────────────────────────────
export interface AppUser {
  id: string
  address: string
  displayName?: string
  avatarUrl?: string
}

// ─── State shape ──────────────────────────────────────────────────────────────
interface AppState {
  user: AppUser | null
  groups: Group[]
  notifications: AppNotification[]
  // Optimistic update tracking
  pendingGroupIds: string[]
}

// ─── Actions ──────────────────────────────────────────────────────────────────
interface AppActions {
  setUser: (user: AppUser | null) => void

  addGroup: (group: Group) => void
  updateGroup: (id: string, patch: Partial<Group>) => void
  removeGroup: (id: string) => void

  /** Optimistic add: immediately shows group, rolls back on failure */
  addGroupOptimistic: (group: Group) => () => void

  markNotificationRead: (id: string) => void
  addNotification: (notification: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => void
  clearNotifications: () => void
}

// ─── Store ────────────────────────────────────────────────────────────────────
export const useAppStore = create<AppState & AppActions>()(
  devtools(
    persist(
      (set, get) => ({
        // ── Initial state ──────────────────────────────────────────────────
        user: null,
        groups: [],
        notifications: [],
        pendingGroupIds: [],

        // ── User ───────────────────────────────────────────────────────────
        setUser: (user) => set({ user }, false, 'setUser'),

        // ── Groups ─────────────────────────────────────────────────────────
        addGroup: (group) =>
          set(
            (state) => ({ groups: [...state.groups, group] }),
            false,
            'addGroup'
          ),

        updateGroup: (id, patch) =>
          set(
            (state) => ({
              groups: state.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
            }),
            false,
            'updateGroup'
          ),

        removeGroup: (id) =>
          set(
            (state) => ({ groups: state.groups.filter((g) => g.id !== id) }),
            false,
            'removeGroup'
          ),

        addGroupOptimistic: (group) => {
          set(
            (state) => ({
              groups: [...state.groups, group],
              pendingGroupIds: [...state.pendingGroupIds, group.id],
            }),
            false,
            'addGroupOptimistic'
          )

          // Return rollback function
          return () =>
            set(
              (state) => ({
                groups: state.groups.filter((g) => g.id !== group.id),
                pendingGroupIds: state.pendingGroupIds.filter((id) => id !== group.id),
              }),
              false,
              'addGroupOptimistic/rollback'
            )
        },

        // ── Notifications ──────────────────────────────────────────────────
        addNotification: (notification) =>
          set(
            (state) => ({
              notifications: [
                {
                  ...notification,
                  id: Math.random().toString(36).slice(2, 9),
                  timestamp: Date.now(),
                  read: false,
                },
                ...state.notifications,
              ].slice(0, 50),
            }),
            false,
            'addNotification'
          ),

        markNotificationRead: (id) =>
          set(
            (state) => ({
              notifications: state.notifications.map((n) =>
                n.id === id ? { ...n, read: true } : n
              ),
            }),
            false,
            'markNotificationRead'
          ),

        clearNotifications: () => set({ notifications: [] }, false, 'clearNotifications'),
      }),
      { name: 'ajo-app-storage' }
    ),
    { name: 'AjoAppStore' }
  )
)
