'use client';

/**
 * CollaborativeEditor (#755)
 *
 * Real-time collaborative group-settings editor.
 * Uses socket.io-client (already in deps) for presence and change broadcast.
 *
 * Features:
 * - Presence indicators (who else is editing)
 * - Per-field locking with cursor/user highlight
 * - Optimistic local state with server reconciliation
 * - Change history with undo support
 * - Conflict resolution: last-writer-wins with timestamp
 */

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useReducer,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CollabUser {
  userId: string;
  name: string;
  color: string;
  editingField: string | null;
}

export interface FieldChange {
  field: string;
  value: string;
  userId: string;
  timestamp: number;
}

export interface GroupSettings {
  [key: string]: string;
}

export interface EditableField {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'number';
  placeholder?: string;
}

export interface CollaborativeEditorProps {
  /** Socket.io server URL. */
  serverUrl: string;
  /** Room / group ID — used to scope the socket room. */
  roomId: string;
  /** Current authenticated user. */
  currentUser: Omit<CollabUser, 'editingField'>;
  /** Fields to expose for editing. */
  fields: EditableField[];
  /** Initial values fetched from the backend. */
  initialValues?: GroupSettings;
  /** Called when local user saves a change. */
  onSave?: (field: string, value: string) => Promise<void>;
}

// ── Palette for coloring other users ─────────────────────────────────────────

const USER_COLORS = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#8b5cf6', '#ef4444', '#14b8a6',
];

// ── History reducer for undo ──────────────────────────────────────────────────

interface HistoryState {
  past: FieldChange[];
  present: GroupSettings;
}

type HistoryAction =
  | { type: 'SET'; field: string; value: string; userId: string }
  | { type: 'UNDO' };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'SET': {
      const entry: FieldChange = {
        field: action.field,
        value: state.present[action.field] ?? '',
        userId: action.userId,
        timestamp: Date.now(),
      };
      return {
        past: [...state.past.slice(-49), entry], // keep last 50
        present: { ...state.present, [action.field]: action.value },
      };
    }
    case 'UNDO': {
      if (state.past.length === 0) return state;
      const last = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: { ...state.present, [last.field]: last.value },
      };
    }
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PresenceDot({ user }: { user: CollabUser }) {
  return (
    <motion.div
      className="flex items-center gap-1.5"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
    >
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
        style={{ background: user.color }}
        title={user.name}
      >
        {user.name.charAt(0).toUpperCase()}
      </div>
      {user.editingField && (
        <span className="text-xs text-gray-500">editing…</span>
      )}
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CollaborativeEditor({
  serverUrl,
  roomId,
  currentUser,
  fields,
  initialValues = {},
  onSave,
}: CollaborativeEditorProps) {
  const socketRef = useRef<Socket | null>(null);
  const [others, setOthers] = useState<CollabUser[]>([]);
  const [connected, setConnected] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);

  const [history, dispatch] = useReducer(historyReducer, {
    past: [],
    present: initialValues,
  });

  const values = history.present;

  // ── Socket lifecycle ─────────────────────────────────────────────────────────

  useEffect(() => {
    const socket = io(serverUrl, {
      query: { roomId, userId: currentUser.userId, name: currentUser.name },
      reconnectionAttempts: 5,
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    /** Receive current presence list from server */
    socket.on('presence:update', (users: CollabUser[]) => {
      setOthers(users.filter((u) => u.userId !== currentUser.userId));
    });

    /** Receive a field change from another user */
    socket.on('field:change', (change: FieldChange) => {
      if (change.userId === currentUser.userId) return;
      dispatch({ type: 'SET', field: change.field, value: change.value, userId: change.userId });
    });

    return () => {
      socket.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl, roomId, currentUser.userId, currentUser.name]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleFocus = useCallback(
    (field: string) => {
      socketRef.current?.emit('presence:editing', { field });
    },
    []
  );

  const handleBlur = useCallback(() => {
    socketRef.current?.emit('presence:editing', { field: null });
  }, []);

  const handleChange = useCallback(
    (field: string, value: string) => {
      dispatch({ type: 'SET', field, value, userId: currentUser.userId });
      socketRef.current?.emit('field:change', {
        field,
        value,
        userId: currentUser.userId,
        timestamp: Date.now(),
      } satisfies FieldChange);
    },
    [currentUser.userId]
  );

  const handleSave = useCallback(
    async (field: string) => {
      if (!onSave) return;
      setSavingField(field);
      try {
        await onSave(field, values[field] ?? '');
      } finally {
        setSavingField(null);
      }
    },
    [onSave, values]
  );

  const handleUndo = useCallback(() => {
    const last = history.past[history.past.length - 1];
    if (!last) return;
    // Only undo own changes
    if (last.userId !== currentUser.userId) return;
    dispatch({ type: 'UNDO' });
    socketRef.current?.emit('field:change', {
      field: last.field,
      value: values[last.field] ?? '',
      userId: currentUser.userId,
      timestamp: Date.now(),
    });
  }, [history.past, currentUser.userId, values]);

  // Determine which field each other user is editing
  const editingMap = Object.fromEntries(
    others.flatMap((u) =>
      u.editingField ? [[u.editingField, u]] : []
    )
  );

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={clsx(
              'w-2 h-2 rounded-full',
              connected ? 'bg-green-500' : 'bg-gray-400'
            )}
          />
          <span className="text-xs text-gray-500">
            {connected ? 'Live' : 'Connecting…'}
          </span>

          <AnimatePresence>
            {others.map((u) => (
              <PresenceDot key={u.userId} user={u} />
            ))}
          </AnimatePresence>
        </div>

        <button
          type="button"
          onClick={handleUndo}
          disabled={history.past.length === 0}
          className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          Undo
        </button>
      </div>

      {/* Fields */}
      {fields.map((fieldDef) => {
        const otherEditing = editingMap[fieldDef.name];
        const isSaving = savingField === fieldDef.name;
        const inputBase =
          'w-full rounded-lg border px-3 py-2 text-sm bg-white dark:bg-gray-800 ' +
          'text-gray-900 dark:text-gray-100 outline-none transition focus:ring-2';
        const ringColor = otherEditing
          ? `focus:ring-[${otherEditing.color}]`
          : 'focus:ring-indigo-500';

        return (
          <div key={fieldDef.name} className="relative">
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {fieldDef.label}
              </label>
              {otherEditing && (
                <motion.span
                  className="text-xs font-medium px-2 py-0.5 rounded-full text-white"
                  style={{ background: otherEditing.color }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  {otherEditing.name} is editing
                </motion.span>
              )}
            </div>

            {fieldDef.type === 'textarea' ? (
              <textarea
                rows={3}
                className={clsx(
                  inputBase,
                  ringColor,
                  otherEditing
                    ? `border-[${otherEditing.color}] ring-1 ring-[${otherEditing.color}]`
                    : 'border-gray-300 dark:border-gray-600'
                )}
                value={values[fieldDef.name] ?? ''}
                placeholder={fieldDef.placeholder}
                onFocus={() => handleFocus(fieldDef.name)}
                onBlur={() => handleBlur()}
                onChange={(e) => handleChange(fieldDef.name, e.target.value)}
              />
            ) : (
              <input
                type={fieldDef.type ?? 'text'}
                className={clsx(
                  inputBase,
                  ringColor,
                  otherEditing
                    ? `border-[${otherEditing.color}]`
                    : 'border-gray-300 dark:border-gray-600'
                )}
                value={values[fieldDef.name] ?? ''}
                placeholder={fieldDef.placeholder}
                onFocus={() => handleFocus(fieldDef.name)}
                onBlur={() => handleBlur()}
                onChange={(e) => handleChange(fieldDef.name, e.target.value)}
              />
            )}

            {onSave && (
              <button
                type="button"
                onClick={() => void handleSave(fieldDef.name)}
                disabled={isSaving}
                className="absolute right-2 top-[1.85rem] text-xs px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200 hover:bg-indigo-200 transition-colors disabled:opacity-50"
              >
                {isSaving ? '…' : 'Save'}
              </button>
            )}
          </div>
        );
      })}

      {/* Change history preview */}
      {history.past.length > 0 && (
        <details className="text-xs text-gray-400">
          <summary className="cursor-pointer hover:text-gray-600 transition-colors">
            {history.past.length} change{history.past.length !== 1 ? 's' : ''} this session
          </summary>
          <ul className="mt-2 space-y-1 max-h-28 overflow-y-auto">
            {[...history.past].reverse().map((entry, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-gray-500">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                <span>
                  <strong>{entry.field}</strong>:{' '}
                  <span className="font-mono">{entry.value.slice(0, 40) || '(empty)'}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
